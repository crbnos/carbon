//! In-process async plan jobs — port of `app/main.py`'s background plan store.
//! A job runs in a Tokio task (holding a concurrency slot); callers poll
//! GET /plan/{jobId}. Restart drops jobs; callers re-submit (same as Python).

use crate::{config, http, AppState};
use planner::steps::PlanUnit;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;

struct Job {
    status: String, // pending | running | done | error
    done: Option<Value>,
    error: Option<String>,
}

#[derive(Clone, Default)]
pub struct JobStore {
    inner: Arc<Mutex<HashMap<String, Job>>>,
}

impl JobStore {
    pub fn existing_active(&self, id: &str) -> Option<String> {
        let map = self.inner.lock().unwrap();
        map.get(id).filter(|j| j.status == "pending" || j.status == "running").map(|j| j.status.clone())
    }

    pub fn set_pending(&self, id: &str) {
        self.inner.lock().unwrap().insert(
            id.to_string(),
            Job { status: "pending".into(), done: None, error: None },
        );
    }

    fn set_status(&self, id: &str, status: &str) {
        if let Some(j) = self.inner.lock().unwrap().get_mut(id) {
            j.status = status.to_string();
        }
    }

    fn set_done(&self, id: &str, done: Value) {
        if let Some(j) = self.inner.lock().unwrap().get_mut(id) {
            j.status = "done".into();
            j.done = Some(done);
        }
    }

    fn set_error(&self, id: &str, error: String) {
        if let Some(j) = self.inner.lock().unwrap().get_mut(id) {
            j.status = "error".into();
            j.error = Some(error);
        }
    }

    pub fn status(&self, id: &str) -> Option<Value> {
        let map = self.inner.lock().unwrap();
        let job = map.get(id)?;
        Some(match job.status.as_str() {
            "done" => job.done.clone().unwrap_or_else(|| json!({"ok": true, "status": "done"})),
            "error" => json!({"ok": true, "status": "error", "error": job.error}),
            s => json!({"ok": true, "status": s}),
        })
    }

    pub fn spawn(&self, state: &AppState, job_id: &str, url: String, options: Value) {
        let jobs = self.clone();
        let slots = Arc::clone(&state.slots);
        let job_id = job_id.to_string();
        tokio::spawn(async move {
            let _permit = slots.acquire().await;
            jobs.set_status(&job_id, "running");
            let started = std::time::Instant::now();

            let tmp = http::temp_path("step");
            if let Err(e) = http::download(&url, &tmp).await {
                jobs.set_error(&job_id, e.message);
                return;
            }
            let tmp_str = tmp.to_string_lossy().to_string();
            let (lin, ang, clearance, path_samples, units, sequence) = parse_options(&options);
            let mp = config::max_parts();

            let res = tokio::task::spawn_blocking(move || {
                planner::steps::plan_step(&tmp_str, lin, ang, clearance, path_samples, Some(mp), units, sequence)
            })
            .await;
            let _ = tokio::fs::remove_file(&tmp).await;

            match res {
                Ok(Ok(r)) => {
                    let plan_ms = started.elapsed().as_millis() as i64;
                    jobs.set_done(&job_id, json!({
                        "ok": true,
                        "status": "done",
                        "plan": r.plan,
                        "componentCount": r.component_count,
                        "plannedCount": r.planned_count,
                        "stats": {
                            "planMs": plan_ms,
                            "tiers": r.tiers,
                            "warnings": r.warnings,
                            "verifiedCount": r.verified_count,
                        },
                    }));
                }
                Ok(Err(e)) => jobs.set_error(&job_id, e.message),
                Err(e) => jobs.set_error(&job_id, format!("plan panicked: {e}")),
            }
        });
    }
}

type Opts = (f64, f64, f64, usize, Option<Vec<PlanUnit>>, Option<Vec<Vec<String>>>);

fn parse_options(options: &Value) -> Opts {
    let lin = options["linearDeflection"].as_f64().unwrap_or(0.1);
    let ang = options["angularDeflection"].as_f64().unwrap_or(0.5);
    let clearance = options["clearance"].as_f64().unwrap_or(0.5);
    let path_samples = options["pathSamples"].as_u64().unwrap_or(60) as usize;

    let units = options["units"].as_array().map(|arr| {
        arr.iter()
            .map(|u| PlanUnit {
                id: u["id"].as_str().unwrap_or("").to_string(),
                name: u["name"].as_str().map(|s| s.to_string()),
                node_ids: u["nodeIds"].as_array().map(|a| {
                    a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
                }).unwrap_or_default(),
            })
            .collect()
    });
    let sequence = options["sequence"].as_array().map(|arr| {
        arr.iter()
            .map(|g| g.as_array().map(|a| {
                a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
            }).unwrap_or_default())
            .collect()
    });
    (lin, ang, clearance, path_samples, units, sequence)
}
