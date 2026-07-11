//! In-process async plan jobs — port of `app/main.py`'s background plan store.
//! A job runs in a Tokio task (holding a concurrency slot); callers poll
//! GET /plan/{jobId}. Restart drops jobs; callers re-submit (same as Python).

use crate::{config, http, AppState};
use dashmap::DashMap;
use planner::steps::PlanUnit;
use serde_json::{json, Value};
use std::sync::Arc;

struct Job {
    status: String, // pending | running | done | error
    done: Option<Value>,
    error: Option<String>,
    /// Opaque caller context from the submit request, echoed back in the
    /// completion event and status responses so consumers stay self-contained.
    meta: Option<Value>,
}

/// Sharded-lock job map: status polls (GET /plan/{id}) and worker-task updates
/// touch different keys and never block each other, unlike one global Mutex.
#[derive(Clone, Default)]
pub struct JobStore {
    inner: Arc<DashMap<String, Job>>,
}

impl JobStore {
    pub fn existing_active(&self, id: &str) -> Option<String> {
        self.inner
            .get(id)
            .filter(|j| j.status == "pending" || j.status == "running")
            .map(|j| j.status.clone())
    }

    pub fn set_pending(&self, id: &str, meta: Option<Value>) {
        self.inner.insert(
            id.to_string(),
            Job {
                status: "pending".into(),
                done: None,
                error: None,
                meta,
            },
        );
    }

    fn set_status(&self, id: &str, status: &str) {
        if let Some(mut j) = self.inner.get_mut(id) {
            j.status = status.to_string();
        }
    }

    fn set_done(&self, id: &str, done: Value) {
        if let Some(mut j) = self.inner.get_mut(id) {
            j.status = "done".into();
            j.done = Some(done);
        }
    }

    fn set_error(&self, id: &str, error: String) {
        if let Some(mut j) = self.inner.get_mut(id) {
            j.status = "error".into();
            j.error = Some(error);
        }
    }

    pub fn status(&self, id: &str) -> Option<Value> {
        let job = self.inner.get(id)?;
        let mut out = match job.status.as_str() {
            "done" => job
                .done
                .clone()
                .unwrap_or_else(|| json!({"ok": true, "status": "done"})),
            "error" => json!({"ok": true, "status": "error", "error": job.error}),
            s => json!({"ok": true, "status": s}),
        };
        if let Some(meta) = &job.meta {
            out["meta"] = meta.clone();
        }
        Some(out)
    }

    pub fn spawn(&self, state: &AppState, job_id: &str, url: String, options: Value) {
        let jobs = self.clone();
        let slots = Arc::clone(&state.slots);
        let job_id = job_id.to_string();
        tokio::spawn(async move {
            let _permit = slots.acquire().await;
            jobs.set_status(&job_id, "running");
            eprintln!("[{job_id}] plan running");
            let started = std::time::Instant::now();

            let tmp = http::temp_path("step");
            if let Err(e) = http::download_hashed(&url, &tmp, None).await {
                let msg = e.message;
                eprintln!("[{job_id}] plan failed: source download: {msg}");
                jobs.set_error(&job_id, msg);
                return;
            }
            let tmp_str = tmp.to_string_lossy().to_string();
            let (lin, ang, clearance, path_samples, units, sequence, tolerance) =
                parse_options(&options);
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
                    // The plan stays resident at GET /plan/{id}; the app's
                    // assembly-plan worker polls for it and uploads plan.json
                    // itself with the service role (the assembler has no storage
                    // credentials, and a caller-minted upload URL would expire
                    // long before a multi-minute plan finishes).
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
                        "[{job_id}] plan done: {} parts, {} planned, {plan_ms}ms",
                        r.component_count, r.planned_count
                    );
                    jobs.set_done(
                        &job_id,
                        json!({
                            "ok": true,
                            "status": "done",
                            "plan": r.plan,
                            "componentCount": r.component_count,
                            "plannedCount": r.planned_count,
                            "stats": stats,
                        }),
                    );
                }
                Ok(Err(e)) => {
                    eprintln!("[{job_id}] plan failed: {}", e.message);
                    jobs.set_error(&job_id, e.message);
                }
                Err(e) => {
                    let msg = format!("plan panicked: {e}");
                    eprintln!("[{job_id}] {msg}");
                    jobs.set_error(&job_id, msg);
                }
            }
        });
    }
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
    // Optional explicit penetration tolerance (mm); absent => inferred from
    // linearDeflection inside plan_step.
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
