//! Async plan jobs + shared job/result store. A job runs in a Tokio task
//! (holding a concurrency slot); callers long-poll GET /plan/{jobId}?wait=.
//!
//! The store is backend-selectable at boot (`ASSEMBLER_REDIS_URL`):
//!   - `Memory` (default): process-local DashMaps — single-process behavior.
//!   - `Redis`: status + pointers (never plan/glb bytes) live in Redis, so a
//!     restart or a sibling replica can still answer the poll. This is what
//!     makes the service stateless. A set-but-unreachable URL falls back to
//!     memory at boot rather than refusing to start.
//!
//! On completion the plan artifact is PUT to the caller-signed `outputs.plan.url`
//! (offload) and only the `{planPath, stats, …}` POINTER is stored — the plan
//! JSON never enters Redis or lingers in memory.

use crate::{cache::CODE_VERSION, config, http, AppState};
use dashmap::DashMap;
use planner::steps::PlanUnit;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Notify;

/// One job's persisted state. Serializable so the Redis backend stores it as a
/// JSON blob and the memory backend keeps the same shape. `done` holds the
/// completion POINTER (planPath/stats/counts) — not the plan itself.
#[derive(Clone, Serialize, Deserialize)]
struct JobRecord {
    status: String, // pending | running | done | error
    #[serde(skip_serializing_if = "Option::is_none")]
    done: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    meta: Option<Value>,
}

#[derive(Clone)]
enum Backend {
    Memory {
        jobs: Arc<DashMap<String, JobRecord>>,
        results: Arc<DashMap<String, Value>>,
    },
    Redis {
        conn: redis::aio::ConnectionManager,
    },
}

/// Shared job + content-hash result store. Cloned into every handler via
/// `AppState`; all inner state is `Arc`/manager-cloned so clones share one store.
#[derive(Clone)]
pub struct JobStore {
    backend: Backend,
    /// Per-job in-process wakeups so a same-replica long-poll returns the instant
    /// the worker finishes (cross-replica completion is caught by the Redis
    /// re-check inside `wait_status`).
    notifiers: Arc<DashMap<String, Arc<Notify>>>,
}

/// Everything a plan task needs from the request.
pub struct PlanReq {
    pub source_url: String,
    /// Signed PUT URL the service uploads plan.json to (offload). None => legacy
    /// inline behavior (plan rides the status body; the app uploads it).
    pub plan_upload_url: Option<String>,
    /// Storage path recorded in the completion pointer (what the app persists).
    pub plan_path: Option<String>,
    /// Scopes the content-hash result cache; None disables caching for this job.
    pub model_upload_id: Option<String>,
    pub options: Value,
}

impl JobStore {
    /// Build from env: Redis when `ASSEMBLER_REDIS_URL` is set and reachable,
    /// else in-memory. Never refuses to boot.
    pub async fn from_env() -> Self {
        let notifiers = Arc::new(DashMap::new());
        if let Some(url) = config::redis_url() {
            match connect(&url).await {
                Ok(conn) => {
                    eprintln!("assembler: redis job store enabled");
                    return JobStore {
                        backend: Backend::Redis { conn },
                        notifiers,
                    };
                }
                Err(e) => {
                    eprintln!(
                        "assembler: ASSEMBLER_REDIS_URL unreachable ({e}); falling back to in-memory store"
                    );
                }
            }
        } else {
            eprintln!("assembler: in-memory job store (ASSEMBLER_REDIS_URL unset)");
        }
        JobStore {
            backend: Backend::Memory {
                jobs: Arc::new(DashMap::new()),
                results: Arc::new(DashMap::new()),
            },
            notifiers,
        }
    }

    // --- job status (pointer, not content) ---------------------------------

    async fn read(&self, id: &str) -> Option<JobRecord> {
        match &self.backend {
            Backend::Memory { jobs, .. } => jobs.get(id).map(|j| j.clone()),
            Backend::Redis { conn } => {
                let mut c = conn.clone();
                match c.get::<_, Option<String>>(job_key(id)).await {
                    Ok(Some(s)) => serde_json::from_str(&s).ok(),
                    Ok(None) => None,
                    Err(e) => {
                        eprintln!("assembler: redis job read failed: {e}");
                        None
                    }
                }
            }
        }
    }

    async fn write(&self, id: &str, rec: &JobRecord) {
        match &self.backend {
            Backend::Memory { jobs, .. } => {
                jobs.insert(id.to_string(), rec.clone());
            }
            Backend::Redis { conn } => {
                let Ok(payload) = serde_json::to_string(rec) else {
                    return;
                };
                let mut c = conn.clone();
                if let Err(e) = c
                    .set_ex::<_, _, ()>(job_key(id), payload, config::job_ttl_secs())
                    .await
                {
                    eprintln!("assembler: redis job write failed: {e}");
                }
            }
        }
    }

    pub async fn existing_active(&self, id: &str) -> Option<String> {
        self.read(id)
            .await
            .filter(|j| j.status == "pending" || j.status == "running")
            .map(|j| j.status)
    }

    pub async fn set_pending(&self, id: &str, meta: Option<Value>) {
        self.write(
            id,
            &JobRecord {
                status: "pending".into(),
                done: None,
                error: None,
                meta,
            },
        )
        .await;
    }

    async fn set_status(&self, id: &str, status: &str) {
        if let Some(mut rec) = self.read(id).await {
            rec.status = status.to_string();
            self.write(id, &rec).await;
        }
    }

    async fn set_done(&self, id: &str, done: Value) {
        let meta = self.read(id).await.and_then(|r| r.meta);
        self.write(
            id,
            &JobRecord {
                status: "done".into(),
                done: Some(done),
                error: None,
                meta,
            },
        )
        .await;
        self.wake(id);
    }

    async fn set_error(&self, id: &str, error: String) {
        let meta = self.read(id).await.and_then(|r| r.meta);
        self.write(
            id,
            &JobRecord {
                status: "error".into(),
                done: None,
                error: Some(error),
                meta,
            },
        )
        .await;
        self.wake(id);
    }

    fn render(rec: &JobRecord) -> Value {
        let mut out = match rec.status.as_str() {
            "done" => rec
                .done
                .clone()
                .unwrap_or_else(|| json!({"ok": true, "status": "done"})),
            "error" => json!({"ok": true, "status": "error", "error": rec.error}),
            s => json!({"ok": true, "status": s}),
        };
        if let Some(meta) = &rec.meta {
            out["meta"] = meta.clone();
        }
        out
    }

    pub async fn status(&self, id: &str) -> Option<Value> {
        self.read(id).await.map(|r| Self::render(&r))
    }

    /// Long-poll: return the terminal status the instant it lands (same-replica
    /// via `Notify`, cross-replica via a ~500ms Redis re-check), else the current
    /// non-terminal status when `max` elapses. `None` only if the job is unknown.
    pub async fn wait_status(&self, id: &str, max: Duration) -> Option<Value> {
        let notify = self.notifier(id);
        let deadline = Instant::now() + max;
        loop {
            let cur = self.read(id).await;
            match &cur {
                Some(rec) if rec.status == "done" || rec.status == "error" => {
                    return Some(Self::render(rec));
                }
                _ => {}
            }
            let now = Instant::now();
            if now >= deadline {
                return cur.map(|r| Self::render(&r));
            }
            let tick = (deadline - now).min(Duration::from_millis(500));
            tokio::select! {
                _ = notify.notified() => {}
                _ = tokio::time::sleep(tick) => {}
            }
        }
    }

    fn notifier(&self, id: &str) -> Arc<Notify> {
        self.notifiers
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(Notify::new()))
            .clone()
    }

    fn wake(&self, id: &str) {
        if let Some(n) = self.notifiers.get(id) {
            n.notify_waiters();
        }
        // A late waiter recreates its notifier and immediately re-reads the now
        // terminal status in wait_status's loop, so dropping this can't lose a
        // wakeup — it just keeps the map from growing unbounded.
        self.notifiers.remove(id);
    }

    // --- content-hash result-pointer cache (CODE_VERSION-stamped) ----------

    async fn result_get(&self, model: &str, content: u128, opts: u64) -> Option<Value> {
        let key = result_key(model, content, opts);
        match &self.backend {
            Backend::Memory { results, .. } => results.get(&key).map(|v| v.clone()),
            Backend::Redis { conn } => {
                let mut c = conn.clone();
                match c.get::<_, Option<String>>(&key).await {
                    Ok(Some(s)) => serde_json::from_str(&s).ok(),
                    Ok(None) => None,
                    Err(e) => {
                        eprintln!("assembler: redis result read failed: {e}");
                        None
                    }
                }
            }
        }
    }

    async fn result_put(&self, model: &str, content: u128, opts: u64, pointer: Value) {
        let key = result_key(model, content, opts);
        match &self.backend {
            Backend::Memory { results, .. } => {
                results.insert(key, pointer);
            }
            Backend::Redis { conn } => {
                let Ok(payload) = serde_json::to_string(&pointer) else {
                    return;
                };
                let mut c = conn.clone();
                if let Err(e) = c
                    .set_ex::<_, _, ()>(&key, payload, config::result_ttl_secs())
                    .await
                {
                    eprintln!("assembler: redis result write failed: {e}");
                }
            }
        }
    }

    /// Central explicit invalidation: drop every cached result pointer for a
    /// model so the next plan re-derives. Returns how many entries were cleared.
    pub async fn invalidate_model(&self, model: &str) -> usize {
        let prefix = format!("asm:result:{model}:");
        match &self.backend {
            Backend::Memory { results, .. } => {
                let keys: Vec<String> = results
                    .iter()
                    .filter(|e| e.key().starts_with(&prefix))
                    .map(|e| e.key().clone())
                    .collect();
                for k in &keys {
                    results.remove(k);
                }
                keys.len()
            }
            Backend::Redis { conn } => {
                let pattern = format!("{prefix}*");
                let mut scan = conn.clone();
                let mut keys: Vec<String> = Vec::new();
                match scan.scan_match::<_, String>(&pattern).await {
                    Ok(mut iter) => {
                        while let Some(k) = iter.next_item().await {
                            keys.push(k);
                        }
                    }
                    Err(e) => {
                        eprintln!("assembler: redis invalidate scan failed: {e}");
                        return 0;
                    }
                }
                if keys.is_empty() {
                    return 0;
                }
                let mut c = conn.clone();
                if let Err(e) = c.del::<_, ()>(&keys).await {
                    eprintln!("assembler: redis invalidate del failed: {e}");
                    return 0;
                }
                keys.len()
            }
        }
    }

    // --- the plan task ------------------------------------------------------

    pub fn spawn(&self, state: &AppState, job_id: &str, req: PlanReq) {
        let jobs = self.clone();
        let slots = Arc::clone(&state.slots);
        let job_id = job_id.to_string();
        tokio::spawn(async move {
            let _permit = slots.acquire().await;
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
                    jobs.set_error(&job_id, msg).await;
                    return;
                }
            };
            let opts_hash = opts_hash(&req.options);

            // Content-hash result cache: same model + same bytes + same options +
            // same CODE_VERSION => reuse the prior plan's storage pointer, skip
            // the FCL compute. Same-model scoped so a reused pointer shares the
            // model's invalidation (never a cross-model dangling path).
            if let Some(model) = &req.model_upload_id {
                if let Some(ptr) = jobs.result_get(model, content_hash, opts_hash).await {
                    let _ = tokio::fs::remove_file(&tmp).await;
                    eprintln!("[{job_id}] plan cache hit ({} parts)", ptr["componentCount"]);
                    jobs.set_done(&job_id, ptr).await;
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

                    // Offload: PUT plan.json to the caller-signed URL so only the
                    // pointer reaches Redis/the poll body. Legacy (no upload URL):
                    // the plan rides the status body and the app uploads it.
                    if let Some(url) = &req.plan_upload_url {
                        match serde_json::to_vec(&r.plan) {
                            Ok(bytes) => {
                                if let Err(e) =
                                    http::upload(url, bytes, "application/json").await
                                {
                                    eprintln!("[{job_id}] plan upload failed: {}", e.message);
                                    jobs.set_error(&job_id, e.message).await;
                                    return;
                                }
                            }
                            Err(e) => {
                                jobs.set_error(&job_id, format!("serialize plan: {e}")).await;
                                return;
                            }
                        }
                    }

                    let mut done = json!({
                        "ok": true,
                        "status": "done",
                        "planPath": req.plan_path,
                        "componentCount": r.component_count,
                        "plannedCount": r.planned_count,
                        "stats": stats,
                    });
                    if req.plan_upload_url.is_none() {
                        // Legacy inline path (no offload): the app expects the
                        // plan in the body and uploads it itself.
                        done["plan"] = r.plan;
                    }

                    // Cache the pointer for identical future requests (only when
                    // the artifact is durable in storage, i.e. it was offloaded).
                    if let (Some(model), Some(_)) = (&req.model_upload_id, &req.plan_path) {
                        if req.plan_upload_url.is_some() {
                            jobs.result_put(model, content_hash, opts_hash, done.clone())
                                .await;
                        }
                    }

                    eprintln!(
                        "[{job_id}] plan done: {} parts, {} planned, {plan_ms}ms",
                        r.component_count, r.planned_count
                    );
                    jobs.set_done(&job_id, done).await;
                }
                Ok(Err(e)) => {
                    eprintln!("[{job_id}] plan failed: {}", e.message);
                    jobs.set_error(&job_id, e.message).await;
                }
                Err(e) => {
                    let msg = format!("plan panicked: {e}");
                    eprintln!("[{job_id}] {msg}");
                    jobs.set_error(&job_id, msg).await;
                }
            }
        });
    }
}

async fn connect(url: &str) -> redis::RedisResult<redis::aio::ConnectionManager> {
    let client = redis::Client::open(url)?;
    let mut conn = client.get_connection_manager().await?;
    // Validate the URL at boot so a bad one falls back to memory now, not on the
    // first job.
    redis::cmd("PING").query_async::<()>(&mut conn).await?;
    Ok(conn)
}

fn job_key(id: &str) -> String {
    format!("asm:job:{id}")
}

fn result_key(model: &str, content: u128, opts: u64) -> String {
    format!("asm:result:{model}:{content:032x}:{opts:016x}:v{CODE_VERSION}")
}

/// Stable hash of the plan options. serde_json serializes object keys sorted
/// (BTreeMap), so the string is deterministic; it includes units/sequence, so
/// dropping auto-swarm units on a fresh regenerate changes the key and misses.
fn opts_hash(options: &Value) -> u64 {
    xxhash_rust::xxh3::xxh3_64(options.to_string().as_bytes())
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
