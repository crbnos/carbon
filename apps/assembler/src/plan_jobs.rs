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

/// A finished plan held in memory until a long-poll hands the service a fresh
/// signed upload URL to PUT it to (late-mint offload). Never touches Redis (it's
/// bytes, not a pointer); lives only on the replica that computed the plan.
struct Pending {
    plan: Vec<u8>,
    /// The completion pointer to publish once the upload succeeds.
    done: Value,
    /// Content-hash cache key `(model, contentHash, optsHash)` — the pointer is
    /// only cached once the artifact is durably uploaded (never a dangling path).
    cache: Option<(String, u128, u64)>,
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
    /// Computed-but-not-yet-uploaded plans, keyed by job id. A long-poll that
    /// carries an upload URL drains this via `try_finalize`.
    pending: Arc<DashMap<String, Pending>>,
}

/// Outcome of a finalize attempt during a long-poll.
pub enum Finalize {
    /// Uploaded — the returned value is the terminal `done` status.
    Uploaded(Value),
    /// Nothing to upload here (already finalized, or the artifact lives on
    /// another replica) — keep waiting.
    NotPending,
    /// Upload failed transiently; the artifact is kept for the next poll to retry.
    Retry,
}

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
                        pending: Arc::new(DashMap::new()),
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
            pending: Arc::new(DashMap::new()),
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

    /// Long-poll a job to a terminal state. `upload_url` (when the request
    /// carried one) is used to drain a computed-but-unuploaded plan the instant
    /// it's ready (late-mint offload). With `max`, holds until terminal or the
    /// deadline (same-replica wake via `Notify`, cross-replica via the ~500ms
    /// re-read); without `max`, a single shot. `None` only if the job is unknown.
    pub async fn poll(
        &self,
        id: &str,
        upload_url: Option<&str>,
        max: Option<Duration>,
    ) -> Option<Value> {
        let deadline = max.map(|m| Instant::now() + m);
        loop {
            let cur = self.status(id).await;
            if let Some(v) = &cur {
                match v["status"].as_str().unwrap_or("") {
                    "done" | "error" => return cur,
                    "uploading" => {
                        if let Some(u) = upload_url {
                            if let Finalize::Uploaded(done) = self.try_finalize(id, u).await {
                                return Some(done);
                            }
                        }
                    }
                    _ => {}
                }
            }
            let Some(dl) = deadline else {
                return cur; // single shot: current status (or None if unknown)
            };
            let now = Instant::now();
            if now >= dl {
                return cur;
            }
            let notify = self.notifier(id);
            let tick = (dl - now).min(Duration::from_millis(500));
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
    }

    /// Hold a computed-but-unuploaded plan for hand-off. Memory backend keeps it
    /// in-process; Redis backend stores it (bytes + pointer) under a short TTL so
    /// ANY replica's poll can drain it — removing the single-process constraint.
    async fn pending_put(
        &self,
        id: &str,
        plan: Vec<u8>,
        done: Value,
        cache: Option<(String, u128, u64)>,
    ) {
        match &self.backend {
            Backend::Memory { .. } => {
                self.pending
                    .insert(id.to_string(), Pending { plan, done, cache });
            }
            Backend::Redis { conn } => {
                let cache_s = cache.map(|(m, c, o)| format!("{m}|{c:032x}|{o}"));
                let mut c = conn.clone();
                let mut pipe = redis::pipe();
                pipe.hset(pending_key(id), "plan", plan)
                    .ignore()
                    .hset(pending_key(id), "done", done.to_string())
                    .ignore();
                if let Some(cs) = cache_s {
                    pipe.hset(pending_key(id), "cache", cs).ignore();
                }
                pipe.expire(pending_key(id), config::pending_ttl_secs() as i64)
                    .ignore();
                if let Err(e) = pipe.query_async::<()>(&mut c).await {
                    eprintln!("assembler: redis pending_put failed: {e}");
                }
            }
        }
    }

    async fn pending_take(&self, id: &str) -> Option<(Vec<u8>, Value, Option<(String, u128, u64)>)> {
        match &self.backend {
            Backend::Memory { .. } => self
                .pending
                .get(id)
                .map(|p| (p.plan.clone(), p.done.clone(), p.cache.clone())),
            Backend::Redis { conn } => {
                let mut c = conn.clone();
                let res: redis::RedisResult<(Option<Vec<u8>>, Option<String>, Option<String>)> =
                    redis::pipe()
                        .hget(pending_key(id), "plan")
                        .hget(pending_key(id), "done")
                        .hget(pending_key(id), "cache")
                        .query_async(&mut c)
                        .await;
                let (plan, done_s, cache_s) = match res {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("assembler: redis pending_take failed: {e}");
                        return None;
                    }
                };
                let done: Value = serde_json::from_str(&done_s?).ok()?;
                Some((plan?, done, cache_s.and_then(parse_cache)))
            }
        }
    }

    async fn pending_remove(&self, id: &str) {
        match &self.backend {
            Backend::Memory { .. } => {
                self.pending.remove(id);
            }
            Backend::Redis { conn } => {
                let mut c = conn.clone();
                if let Err(e) = c.del::<_, ()>(pending_key(id)).await {
                    eprintln!("assembler: redis pending_remove failed: {e}");
                }
            }
        }
    }

    /// Drain a computed-but-unuploaded plan to `upload_url` (called from a
    /// long-poll that carried a fresh signed URL). On success publishes the
    /// terminal `done` pointer; on transient failure keeps the artifact so the
    /// next poll can retry with a fresher URL.
    pub async fn try_finalize(&self, id: &str, upload_url: &str) -> Finalize {
        let Some((plan, done, cache)) = self.pending_take(id).await else {
            return Finalize::NotPending;
        };
        match http::upload(upload_url, plan, "application/json").await {
            Ok(()) => {
                self.pending_remove(id).await;
                if let Some((model, content, opts)) = cache {
                    self.result_put(&model, content, opts, done.clone()).await;
                }
                self.set_done(id, done.clone()).await;
                Finalize::Uploaded(done)
            }
            Err(e) => {
                eprintln!("[{id}] plan upload failed (will retry next poll): {}", e.message);
                Finalize::Retry
            }
        }
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
                    let pointer = json!({
                        "ok": true,
                        "status": "done",
                        "planPath": req.plan_path,
                        "componentCount": r.component_count,
                        "plannedCount": r.planned_count,
                        "stats": stats,
                    });
                    eprintln!(
                        "[{job_id}] plan computed: {} parts, {} planned, {plan_ms}ms",
                        r.component_count, r.planned_count
                    );

                    match &req.plan_path {
                        // Late-mint offload: hold the plan in memory and mark the
                        // job "uploading"; a long-poll carrying a fresh signed URL
                        // drains it (try_finalize) and publishes the pointer.
                        Some(_) => match serde_json::to_vec(&r.plan) {
                            Ok(bytes) => {
                                let cache = req
                                    .model_upload_id
                                    .as_ref()
                                    .map(|m| (m.clone(), content_hash, opts_hash));
                                jobs.pending_put(&job_id, bytes, pointer, cache).await;
                                jobs.set_status(&job_id, "uploading").await;
                                jobs.wake(&job_id);
                            }
                            Err(e) => {
                                jobs.set_error(&job_id, format!("serialize plan: {e}")).await
                            }
                        },
                        // No storage path (None meta): return the plan inline in
                        // the status body for the app to persist itself.
                        None => {
                            let mut done = pointer;
                            done["plan"] = r.plan;
                            jobs.set_done(&job_id, done).await;
                        }
                    }
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

fn pending_key(id: &str) -> String {
    format!("asm:pending:{id}")
}

/// Parse a `"model|contentHex|opts"` cache tuple stored alongside a pending plan.
fn parse_cache(s: String) -> Option<(String, u128, u64)> {
    let mut it = s.splitn(3, '|');
    let model = it.next()?.to_string();
    let content = u128::from_str_radix(it.next()?, 16).ok()?;
    let opts = it.next()?.parse().ok()?;
    Some((model, content, opts))
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
