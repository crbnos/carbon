// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! `plan` action — collision-free disassembly motion planning. Async: the job
//! runs detached, the caller long-polls. On completion the plan.json is
//! uploaded to its submit-time URL.

use crate::jobs::{opts_hash, Done, Output};
use crate::{admission, compute, config, http, telemetry, AppState};
use planner::steps::PlanUnit;
use serde_json::{json, Value};
use std::time::Instant;

/// Everything a plan task needs from the request.
pub struct PlanReq {
    pub source_url: String,
    /// Storage path recorded in the completion pointer (what the app persists).
    /// The plan.json is PUT to the submit-time signed URL, key `plan`.
    pub plan_path: String,
    /// Scopes the content-hash result cache; None disables caching for this job.
    pub model_upload_id: Option<String>,
    pub options: Value,
}

pub fn spawn(state: &AppState, job_id: &str, req: PlanReq) {
    let jobs = state.jobs.clone();
    let admission = state.admission.clone();
    let sources = state.sources.clone();
    let job_id = job_id.to_string();
    telemetry::spawn_job(&job_id.clone(), "plan", async move {
        if jobs.is_canceled(&job_id).await {
            return;
        }
        let started = Instant::now();

        let src = match sources.download(&req.source_url, "step", None).await {
            Ok(src) => src,
            Err(e) => {
                let msg = e.message;
                eprintln!("[{job_id}] plan failed: source download: {msg}");
                jobs.set_error(&job_id, "READ_FAILED", msg).await;
                return;
            }
        };
        let content_hash = src.hash;
        let opts_h = opts_hash(&req.options);

        // Content-hash result cache: same model + same bytes + same options +
        // same CODE_VERSION => reuse the prior plan's pointer, skip the compute.
        if let Some(model) = &req.model_upload_id {
            if let Some(done) = jobs.result_get(model, content_hash, opts_h).await {
                drop(src);
                eprintln!("[{job_id}] plan cache hit");
                jobs.set_done(&job_id, done).await;
                jobs.send_callback(&job_id).await;
                return;
            }
        }

        let tmp_str = src.path_string();
        let (lin, ang, clearance, path_samples, units, sequence, tolerance) =
            parse_options(&req.options);
        let mp = config::max_parts();

        // Sized by the source until the model is read, then by its part count:
        // the sweeps, not the read, are where a plan's memory goes.
        let source_bytes = http::file_len(src.path()).await;
        let grant = admission
            .acquire(admission::plan_estimate_mb(source_bytes, None))
            .await;
        // The wait may have been long: a job cancelled meanwhile is dropped
        // before it takes the memory it was granted.
        if jobs.is_canceled(&job_id).await {
            return;
        }
        // Running from here on: the wait for memory is queue time, not work.
        jobs.set_status(&job_id, "running").await;
        eprintln!("[{job_id}] plan running");
        let runtime = tokio::runtime::Handle::current();
        // The grant moves into the work (it is resized as parts are counted),
        // so it is released when the thread really ends.
        let res = compute::run(None, move || {
            let grant = std::sync::Mutex::new(grant);
            planner::steps::plan_step_observed(
                &tmp_str,
                lin,
                ang,
                clearance,
                path_samples,
                Some(mp),
                units,
                sequence,
                tolerance,
                &|parts| {
                    let estimate = admission::plan_estimate_mb(source_bytes, Some(parts));
                    let mut grant = grant.lock().unwrap_or_else(|e| e.into_inner());
                    runtime.block_on(grant.resize(estimate));
                },
            )
        })
        .await;
        drop(src);

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

                let (component_count, planned_count) = (r.component_count, r.planned_count);
                let bytes = serde_json::to_vec(&r.plan);
                // The serialized copy is all that is uploaded; free the plan.
                drop(r);
                let bytes = match bytes {
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
                        "planPath": req.plan_path,
                        "componentCount": component_count,
                        "plannedCount": planned_count,
                    }),
                    stats,
                };
                let outputs = vec![Output {
                    name: "plan".into(),
                    content_type: "application/json".into(),
                    bytes: bytes.into(),
                }];
                jobs.finish(&job_id, outputs, done, cache).await;
            }
            Ok(Err(e)) => {
                eprintln!("[{job_id}] plan failed: {}", e.message);
                jobs.set_error(&job_id, "TESSELLATION_FAILED", e.message)
                    .await;
            }
            Err(e) => {
                let msg = format!("plan {e}");
                eprintln!("[{job_id}] {msg}");
                jobs.set_error(&job_id, e.code("TESSELLATION_FAILED"), msg).await;
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
    let lin = options["linearDeflection"]
        .as_f64()
        .unwrap_or(config::TESSELLATION_LINEAR);
    let ang = options["angularDeflection"]
        .as_f64()
        .unwrap_or(config::TESSELLATION_ANGULAR);
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
