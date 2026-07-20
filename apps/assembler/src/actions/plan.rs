//! `plan` action — collision-free disassembly motion planning. Async: the job
//! runs detached, the caller long-polls. On completion the plan.json is either
//! late-mint uploaded (a `planPath` was given) or returned inline in the result.

use crate::jobs::{opts_hash, Done, Output};
use crate::{config, http, AppState};
use planner::steps::PlanUnit;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Instant;

/// Everything a plan task needs from the request.
pub struct PlanReq {
    pub source_url: String,
    /// Storage path recorded in the completion pointer (what the app persists).
    /// The plan.json is PUT here later via a per-poll signed URL (late-mint).
    pub plan_path: Option<String>,
    /// Scopes the content-hash result cache; None disables caching for this job.
    pub model_upload_id: Option<String>,
    pub options: Value,
}

pub fn spawn(state: &AppState, job_id: &str, req: PlanReq) {
    let jobs = state.jobs.clone();
    let slots = Arc::clone(&state.slots);
    let job_id = job_id.to_string();
    tokio::spawn(async move {
        let _permit = slots.acquire().await;
        if jobs.is_canceled(&job_id).await {
            return;
        }
        jobs.set_status(&job_id, "running").await;
        eprintln!("[{job_id}] plan running");
        let started = Instant::now();

        let tmp = http::temp_path("step");
        let content_hash = match http::download_hashed(&req.source_url, &tmp, None).await {
            Ok(h) => h,
            Err(e) => {
                let msg = e.message;
                eprintln!("[{job_id}] plan failed: source download: {msg}");
                let _ = tokio::fs::remove_file(&tmp).await;
                jobs.set_error(&job_id, "READ_FAILED", msg).await;
                return;
            }
        };
        let opts_h = opts_hash(&req.options);

        // Content-hash result cache: same model + same bytes + same options +
        // same CODE_VERSION => reuse the prior plan's pointer, skip the compute.
        if let Some(model) = &req.model_upload_id {
            if let Some(done) = jobs.result_get(model, content_hash, opts_h).await {
                let _ = tokio::fs::remove_file(&tmp).await;
                eprintln!("[{job_id}] plan cache hit");
                jobs.set_done(&job_id, done).await;
                jobs.send_callback(&job_id).await;
                return;
            }
        }

        let tmp_str = tmp.to_string_lossy().to_string();
        let (lin, ang, clearance, path_samples, units, sequence, tolerance) =
            parse_options(&req.options);
        let mp = config::max_parts();

        let res = tokio::task::spawn_blocking(move || {
            planner::steps::plan_step(
                &tmp_str,
                lin,
                ang,
                clearance,
                path_samples,
                Some(mp),
                units,
                sequence,
                tolerance,
            )
        })
        .await;
        let _ = tokio::fs::remove_file(&tmp).await;

        match res {
            Ok(Ok(r)) => {
                let plan_ms = started.elapsed().as_millis() as i64;
                let stats = json!({
                    "planMs": plan_ms,
                    "tiers": r.tiers,
                    "warnings": r.warnings,
                    "verifiedCount": r.verified_count,
                    "componentCount": r.component_count,
                    "plannedCount": r.planned_count,
                });
                eprintln!(
                    "[{job_id}] plan computed: {} parts, {} planned, {plan_ms}ms",
                    r.component_count, r.planned_count
                );
                let cache = req
                    .model_upload_id
                    .as_ref()
                    .map(|m| (m.clone(), content_hash, opts_h));

                match &req.plan_path {
                    // Offload: late-mint upload the plan.json.
                    Some(path) => {
                        let bytes = match serde_json::to_vec(&r.plan) {
                            Ok(b) => b,
                            Err(e) => {
                                jobs.set_error(
                                    &job_id,
                                    "TESSELLATION_FAILED",
                                    format!("serialize plan: {e}"),
                                )
                                .await;
                                return;
                            }
                        };
                        let done = Done {
                            result: json!({
                                "planPath": path,
                                "componentCount": r.component_count,
                                "plannedCount": r.planned_count,
                            }),
                            stats,
                        };
                        let outputs = vec![Output {
                            name: "plan".into(),
                            content_type: "application/json".into(),
                            bytes,
                        }];
                        jobs.finish(&job_id, outputs, done, cache).await;
                    }
                    // Inline: return the plan in the result for the app to persist.
                    None => {
                        let done = Done {
                            result: json!({
                                "plan": r.plan,
                                "componentCount": r.component_count,
                                "plannedCount": r.planned_count,
                            }),
                            stats,
                        };
                        jobs.set_done(&job_id, done).await;
                jobs.send_callback(&job_id).await;
                    }
                }
            }
            Ok(Err(e)) => {
                eprintln!("[{job_id}] plan failed: {}", e.message);
                jobs.set_error(&job_id, "TESSELLATION_FAILED", e.message)
                    .await;
            }
            Err(e) => {
                let msg = format!("plan panicked: {e}");
                eprintln!("[{job_id}] {msg}");
                jobs.set_error(&job_id, "TESSELLATION_FAILED", msg).await;
            }
        }
    });
}

type Opts = (
    f64,
    f64,
    f64,
    usize,
    Option<Vec<PlanUnit>>,
    Option<Vec<Vec<String>>>,
    Option<f64>,
);

fn parse_options(options: &Value) -> Opts {
    let lin = options["linearDeflection"].as_f64().unwrap_or(0.1);
    let ang = options["angularDeflection"].as_f64().unwrap_or(0.5);
    let clearance = options["clearance"].as_f64().unwrap_or(0.5);
    let path_samples = options["pathSamples"].as_u64().unwrap_or(60) as usize;
    let tolerance = options["tolerance"].as_f64();

    let units = options["units"].as_array().map(|arr| {
        arr.iter()
            .map(|u| PlanUnit {
                id: u["id"].as_str().unwrap_or("").to_string(),
                name: u["name"].as_str().map(|s| s.to_string()),
                node_ids: u["nodeIds"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .collect()
    });
    let sequence = options["sequence"].as_array().map(|arr| {
        arr.iter()
            .map(|g| {
                g.as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default()
            })
            .collect()
    });
    (
        lin,
        ang,
        clearance,
        path_samples,
        units,
        sequence,
        tolerance,
    )
}
