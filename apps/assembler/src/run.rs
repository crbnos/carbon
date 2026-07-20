//! One-shot `run-job` CLI: run ONE action to completion and exit — no HTTP
//! server. The ECS Fargate overflow entrypoint (and any non-HTTP invoke) for
//! jobs past Lambda's 15-min cap. It reuses the *exact* compute + finalize path
//! as the async HTTP mode (spawn the action, then drain it to terminal with the
//! caller's signed upload URLs), so there is no second code path to keep in sync.
//! The Lambda default still runs the HTTP server via the Lambda Web Adapter.
//!
//! Spec (JSON, from `argv[2]` or `$ASSEMBLER_JOB_SPEC`) — the same shape as the
//! HTTP body plus an `action` and an `upload_urls` map:
//! ```json
//! { "action": "optimize"|"convert"|"plan",
//!   "job_id": "…",                                  // optional
//!   "source": { "url": "<signed GET>", "format": "auto" },
//!   "output" | "outputs" | "options" | "quality": { … },   // per action, as HTTP
//!   "upload_urls": { "glb": "<signed PUT>", "graph": "…" } }
//! ```

use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::{actions, build_state, config, optimize_opts, AppState};

/// Overall wall-clock ceiling for a one-shot job. Generous: ECS has no 15-min
/// cap (that's exactly why the overflow path exists); Lambda's own timeout bounds
/// the sync-HTTP variant separately.
const RUN_JOB_MAX_SECS: u64 = 60 * 60;

pub async fn run_job_cli() -> ! {
    let spec = match load_spec() {
        Ok(s) => s,
        Err(m) => fail(&m),
    };
    let action = spec["action"].as_str().unwrap_or_default().to_string();
    let source_url = spec["source"]["url"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if source_url.is_empty() {
        fail("missing source.url");
    }
    if let Err(e) = config::validate_url(&source_url) {
        fail(&format!("invalid source.url: {}", e.message));
    }
    let job_id = spec["job_id"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("run-job-{action}"));
    let urls = upload_urls(&spec);

    let state = build_state().await;
    let callback = spec["callback_url"].as_str().map(str::to_string);
    state
        .jobs
        .set_pending(&job_id, &action, None, urls.clone(), callback)
        .await;

    if let Err(m) = spawn_from_spec(&state, &job_id, &action, &spec) {
        fail(&m);
    }

    let result = run_to_completion(&state, &job_id, &urls).await;
    // The CLI owns the process lifetime — (re)deliver the completion callback
    // before exiting (no-op if none / already delivered semantics are idempotent
    // for the receiver).
    state.jobs.send_callback(&job_id).await;
    println!("{result}");
    let ok = matches!(result["job"]["status"].as_str(), Some("succeeded"));
    std::process::exit(if ok { 0 } else { 1 });
}

/// Start the action described by a run-job spec (same field shapes as the HTTP
/// create bodies, plus `action`/`job_id` at the top level). Shared by the CLI
/// and the Lambda self-invoke worker (`POST /events`). The job must already be
/// `set_pending`; the caller decides how to drain it (CLI/worker:
/// `run_to_completion`; a poll from any replica also works via Redis).
pub fn spawn_from_spec(
    state: &AppState,
    job_id: &str,
    action: &str,
    spec: &Value,
) -> Result<(), String> {
    let source_url = spec["source"]["url"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    match action {
        "optimize" => actions::optimize::spawn(
            state,
            job_id,
            actions::optimize::OptimizeReq {
                source_url,
                format: spec["source"]["format"]
                    .as_str()
                    .unwrap_or("auto")
                    .to_string(),
                glb_path: spec["output"]["path"].as_str().map(str::to_string),
                opts: optimize_opts(&spec["output"], &spec["quality"]),
            },
        ),
        "convert" => actions::convert::spawn(
            state,
            job_id,
            actions::convert::ConvertReq {
                source_url,
                declared_hash: spec["source"]["contentHash"].as_str().map(str::to_string),
                glb_path: spec["outputs"]["glb"]["path"].as_str().map(str::to_string),
                graph_path: spec["outputs"]["graph"]["path"].as_str().map(str::to_string),
                lin: spec["options"]["linearDeflection"].as_f64().unwrap_or(0.1),
                ang: spec["options"]["angularDeflection"].as_f64().unwrap_or(0.5),
                optimize: spec["options"]["optimize"].as_bool().unwrap_or(true),
            },
        ),
        "plan" => actions::plan::spawn(
            state,
            job_id,
            actions::plan::PlanReq {
                source_url,
                plan_path: spec["output"]["path"]
                    .as_str()
                    .or_else(|| spec["meta"]["planPath"].as_str())
                    .map(str::to_string),
                model_upload_id: spec["model_upload_id"]
                    .as_str()
                    .or_else(|| spec["meta"]["modelUploadId"].as_str())
                    .map(str::to_string),
                options: spec["options"].clone(),
            },
        ),
        "compact" => {
            let mode = actions::compact::Mode::from_str(spec["mode"].as_str().unwrap_or("xbf"))
                .ok_or("mode must be 'xbf' or 'zstd'")?;
            actions::compact::spawn(
                state,
                job_id,
                actions::compact::CompactReq {
                    source_url,
                    mode,
                    raw_path: spec["output"]["path"].as_str().map(str::to_string),
                },
            )
        }
        other => return Err(format!("unsupported action: {other}")),
    }
    Ok(())
}

/// Drive a spawned job to a terminal state, uploading its outputs to the given
/// signed URLs via the same finalize path the HTTP poll uses. Shared by the CLI
/// here and the sync-HTTP path (`?sync`, the Lambda handler in `main::respond`).
pub async fn run_to_completion(
    state: &AppState,
    job_id: &str,
    urls: &HashMap<String, String>,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(RUN_JOB_MAX_SECS);
    let step = Duration::from_secs(30);
    loop {
        match state.jobs.poll(job_id, urls, Some(step)).await {
            None => {
                return json!({ "ok": false,
                    "error": { "code": "not_found", "message": "job vanished" } })
            }
            Some(v) => match v["job"]["status"].as_str() {
                Some("succeeded") | Some("failed") | Some("canceled") => return v,
                // still running / uploading — keep waiting until the ceiling
                _ if Instant::now() >= deadline => return v,
                _ => continue,
            },
        }
    }
}

pub fn upload_urls(spec: &Value) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Some(map) = spec["upload_urls"].as_object() {
        for (name, url) in map {
            if let Some(u) = url.as_str() {
                out.insert(name.clone(), u.to_string());
            }
        }
    }
    out
}

fn load_spec() -> Result<Value, String> {
    let raw = std::env::args()
        .nth(2)
        .or_else(|| std::env::var("ASSEMBLER_JOB_SPEC").ok())
        .ok_or("run-job: missing spec (argv[2] or $ASSEMBLER_JOB_SPEC)")?;
    serde_json::from_str(&raw).map_err(|e| format!("run-job: invalid spec JSON: {e}"))
}

fn fail(msg: &str) -> ! {
    eprintln!("run-job error: {msg}");
    println!(
        "{}",
        json!({ "ok": false, "error": { "code": "invalid_input", "message": msg } })
    );
    std::process::exit(1);
}
