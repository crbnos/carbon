//! Async job store shared by every heavy action (convert / optimize / plan).
//! An action handler creates a job (POST /v1/{action}) and the caller long-polls
//! GET /v1/jobs/{id}?wait=. One lifecycle, one poll, for all actions.
//!
//! Backend-selectable at boot (`ASSEMBLER_REDIS_URL`):
//!   - `Memory` (default): process-local DashMaps — single-process behavior.
//!   - `Redis`: status + pointers (never artifact bytes) live in Redis, so a
//!     restart or a sibling replica can still answer the poll — the service is
//!     stateless. A set-but-unreachable URL falls back to memory at boot.
//!
//! Completion artifacts are PUT to caller-signed URLs handed in on each poll
//! (late-mint offload) and only a `{result, stats}` POINTER is stored — artifact
//! bytes never enter Redis or linger in memory beyond the pending hand-off.

use crate::{cache::CODE_VERSION, config, http};
use dashmap::DashMap;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Notify;

/// One job's persisted state. Serializable so the Redis backend stores it as a
/// JSON blob and the memory backend keeps the same shape. `result`/`stats` hold
/// the completion POINTER (paths + counts) — never the artifact bytes.
#[derive(Clone, Serialize, Deserialize)]
struct JobRecord {
    action: String, // convert | optimize | plan
    status: String, // pending | running | uploading | done | error | canceled
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stats: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>, // { code, message }
    #[serde(skip_serializing_if = "Option::is_none")]
    meta: Option<Value>,
}

/// One artifact awaiting a late-minted upload URL (name → bytes + content type).
#[derive(Clone)]
pub struct Output {
    pub name: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

/// The terminal pointer to publish once every output is uploaded.
#[derive(Clone)]
pub struct Done {
    pub result: Value,
    pub stats: Value,
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

/// A finished job's artifacts held until a long-poll hands over fresh signed
/// upload URLs (late-mint offload). Never touches Redis on the memory backend;
/// on Redis it's stored under a short TTL so ANY replica's poll can drain it.
struct Pending {
    outputs: Vec<Output>,
    done: Done,
    /// Content-hash result-cache key `(model, contentHash, optsHash)` — the
    /// pointer is cached only once the artifact is durably uploaded.
    cache: Option<(String, u128, u64)>,
}

/// Shared job + content-hash result store. Cloned into every handler via
/// `AppState`; inner state is `Arc`/manager-cloned so clones share one store.
#[derive(Clone)]
pub struct JobStore {
    backend: Backend,
    /// Per-job in-process wakeups so a same-replica long-poll returns the instant
    /// the worker finishes (cross-replica completion caught by the Redis re-check).
    notifiers: Arc<DashMap<String, Arc<Notify>>>,
    /// Computed-but-not-yet-uploaded artifacts, keyed by job id.
    pending: Arc<DashMap<String, Pending>>,
}

/// Outcome of a finalize attempt during a long-poll.
pub enum Finalize {
    /// Uploaded — the job is now `done`.
    Uploaded,
    /// Nothing to upload here (already finalized, missing a URL, or on another
    /// replica) — keep waiting.
    NotPending,
    /// Upload failed transiently; artifacts kept for the next poll to retry.
    Retry,
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

    // --- job status (pointer, not artifact bytes) --------------------------

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

    /// The internal status of an active job (pending/running/uploading), for the
    /// create handler's idempotency attach. None if unknown or terminal.
    pub async fn existing_active(&self, id: &str) -> Option<String> {
        self.read(id)
            .await
            .filter(|j| matches!(j.status.as_str(), "pending" | "running" | "uploading"))
            .map(|j| external_status(&j.status).to_string())
    }

    pub async fn set_pending(&self, id: &str, action: &str, meta: Option<Value>) {
        self.write(
            id,
            &JobRecord {
                action: action.to_string(),
                status: "pending".into(),
                result: None,
                stats: None,
                error: None,
                meta,
            },
        )
        .await;
    }

    pub async fn set_status(&self, id: &str, status: &str) {
        if let Some(mut rec) = self.read(id).await {
            rec.status = status.to_string();
            self.write(id, &rec).await;
        }
    }

    /// Publish a terminal `done` pointer directly (for actions with no artifact
    /// to late-mint — an inline result or a cache hit whose artifact exists).
    pub async fn set_done(&self, id: &str, done: Done) {
        if let Some(mut rec) = self.read(id).await {
            rec.status = "done".into();
            rec.result = Some(done.result);
            rec.stats = Some(done.stats);
            rec.error = None;
            self.write(id, &rec).await;
        }
        self.wake(id);
    }

    pub async fn set_error(&self, id: &str, code: &str, message: String) {
        if let Some(mut rec) = self.read(id).await {
            rec.status = "error".into();
            rec.error = Some(json!({ "code": code, "message": message }));
            self.write(id, &rec).await;
        }
        self.wake(id);
    }

    /// Best-effort cancel: mark canceled only if still active. The running task
    /// isn't forcibly killed — it drops its result when it finds the job canceled.
    pub async fn cancel(&self, id: &str) -> Option<Value> {
        let mut rec = self.read(id).await?;
        if matches!(rec.status.as_str(), "pending" | "running" | "uploading") {
            rec.status = "canceled".into();
            self.write(id, &rec).await;
            self.pending.remove(id);
            self.wake(id);
        }
        Some(Self::render(id, &rec))
    }

    /// True once the job left the active set (terminal or canceled) — the compute
    /// task polls this to abandon a canceled run.
    pub async fn is_canceled(&self, id: &str) -> bool {
        self.read(id)
            .await
            .map(|r| r.status == "canceled")
            .unwrap_or(true)
    }

    /// The uniform poll envelope: `{ ok, job: { id, action, status, result?,
    /// stats?, error? } }` with the internal status mapped to the public enum.
    fn render(id: &str, rec: &JobRecord) -> Value {
        let mut job = json!({
            "id": id,
            "action": rec.action,
            "status": external_status(&rec.status),
        });
        if let Some(r) = &rec.result {
            job["result"] = r.clone();
        }
        if let Some(s) = &rec.stats {
            job["stats"] = s.clone();
        }
        if let Some(e) = &rec.error {
            job["error"] = e.clone();
        }
        if let Some(m) = &rec.meta {
            job["meta"] = m.clone();
        }
        json!({ "ok": true, "job": job })
    }

    /// Long-poll a job to a terminal state. `upload_urls` (name→signed PUT URL,
    /// minted fresh by the caller each poll) drain a computed-but-unuploaded job
    /// the instant it's ready. With `max`, holds until terminal or the deadline;
    /// without, a single shot. `None` only if the job is unknown.
    pub async fn poll(
        &self,
        id: &str,
        upload_urls: &HashMap<String, String>,
        max: Option<Duration>,
    ) -> Option<Value> {
        let deadline = max.map(|m| Instant::now() + m);
        loop {
            let rec = self.read(id).await?;
            match rec.status.as_str() {
                "done" | "error" | "canceled" => return Some(Self::render(id, &rec)),
                "uploading" if !upload_urls.is_empty() => {
                    if let Finalize::Uploaded = self.try_finalize(id, upload_urls).await {
                        // re-read → the now-`done` record renders on the next loop
                        continue;
                    }
                }
                _ => {}
            }
            let Some(dl) = deadline else {
                return Some(Self::render(id, &rec)); // single shot
            };
            let now = Instant::now();
            if now >= dl {
                return Some(Self::render(id, &rec));
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

    pub fn wake(&self, id: &str) {
        if let Some(n) = self.notifiers.get(id) {
            n.notify_waiters();
        }
    }

    // --- late-mint hand-off -------------------------------------------------

    /// Hold computed-but-unuploaded artifacts for hand-off. Memory keeps them
    /// in-process; Redis stores them (bytes + pointer) under a short TTL so ANY
    /// replica's poll can drain them.
    pub async fn pending_put(
        &self,
        id: &str,
        outputs: Vec<Output>,
        done: Done,
        cache: Option<(String, u128, u64)>,
    ) {
        match &self.backend {
            Backend::Memory { .. } => {
                self.pending.insert(
                    id.to_string(),
                    Pending {
                        outputs,
                        done,
                        cache,
                    },
                );
            }
            Backend::Redis { conn } => {
                let manifest: Vec<Value> = outputs
                    .iter()
                    .map(|o| json!({ "name": o.name, "contentType": o.content_type }))
                    .collect();
                let done_json =
                    json!({ "result": done.result, "stats": done.stats }).to_string();
                let mut c = conn.clone();
                let mut pipe = redis::pipe();
                pipe.hset(pending_key(id), "manifest", Value::from(manifest).to_string())
                    .ignore()
                    .hset(pending_key(id), "done", done_json)
                    .ignore();
                for o in &outputs {
                    pipe.hset(pending_key(id), format!("b:{}", o.name), o.bytes.clone())
                        .ignore();
                }
                if let Some((m, ch, op)) = &cache {
                    pipe.hset(pending_key(id), "cache", format!("{m}|{ch:032x}|{op}"))
                        .ignore();
                }
                pipe.expire(pending_key(id), config::pending_ttl_secs() as i64)
                    .ignore();
                if let Err(e) = pipe.query_async::<()>(&mut c).await {
                    eprintln!("assembler: redis pending_put failed: {e}");
                }
            }
        }
    }

    async fn pending_take(
        &self,
        id: &str,
    ) -> Option<(Vec<Output>, Done, Option<(String, u128, u64)>)> {
        match &self.backend {
            Backend::Memory { .. } => self.pending.get(id).map(|p| {
                (
                    p.outputs.clone(),
                    p.done.clone(),
                    p.cache.clone(),
                )
            }),
            Backend::Redis { conn } => {
                let mut c = conn.clone();
                let res: redis::RedisResult<(Option<String>, Option<String>, Option<String>)> =
                    redis::pipe()
                        .hget(pending_key(id), "manifest")
                        .hget(pending_key(id), "done")
                        .hget(pending_key(id), "cache")
                        .query_async(&mut c)
                        .await;
                let (manifest_s, done_s, cache_s) = match res {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("assembler: redis pending_take failed: {e}");
                        return None;
                    }
                };
                let manifest: Vec<Value> = serde_json::from_str(&manifest_s?).ok()?;
                let mut outputs = Vec::with_capacity(manifest.len());
                for m in &manifest {
                    let name = m["name"].as_str()?.to_string();
                    let content_type = m["contentType"].as_str().unwrap_or("application/octet-stream").to_string();
                    let bytes: Option<Vec<u8>> =
                        c.hget(pending_key(id), format!("b:{name}")).await.ok()?;
                    outputs.push(Output {
                        name,
                        content_type,
                        bytes: bytes?,
                    });
                }
                let done_v: Value = serde_json::from_str(&done_s?).ok()?;
                let done = Done {
                    result: done_v["result"].clone(),
                    stats: done_v["stats"].clone(),
                };
                Some((outputs, done, cache_s.and_then(parse_cache)))
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

    /// Drain computed-but-unuploaded artifacts to their fresh signed URLs (from a
    /// long-poll). Every output must have a matching URL; on success publishes the
    /// terminal pointer, else keeps the artifacts for the next poll to retry.
    pub async fn try_finalize(&self, id: &str, urls: &HashMap<String, String>) -> Finalize {
        let Some((outputs, done, cache)) = self.pending_take(id).await else {
            return Finalize::NotPending;
        };
        // Need a URL for every output before we can finalize.
        if outputs.iter().any(|o| !urls.contains_key(&o.name)) {
            return Finalize::NotPending;
        }
        for o in &outputs {
            let url = &urls[&o.name];
            if let Err(e) = http::upload(url, o.bytes.clone(), &o.content_type).await {
                eprintln!(
                    "[{id}] output '{}' upload failed (retry next poll): {}",
                    o.name, e.message
                );
                return Finalize::Retry;
            }
        }
        self.pending_remove(id).await;
        if let Some((model, content, opts)) = cache {
            let pointer = json!({ "result": done.result, "stats": done.stats });
            self.result_put(&model, content, opts, pointer).await;
        }
        self.set_done(id, done).await;
        Finalize::Uploaded
    }

    // --- content-hash result-pointer cache (CODE_VERSION-stamped) ----------

    pub async fn result_get(&self, model: &str, content: u128, opts: u64) -> Option<Done> {
        let key = result_key(model, content, opts);
        let raw: Option<Value> = match &self.backend {
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
        };
        raw.map(|v| Done {
            result: v["result"].clone(),
            stats: v["stats"].clone(),
        })
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
    /// model so the next job re-derives. Returns how many entries were cleared.
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
}

async fn connect(url: &str) -> redis::RedisResult<redis::aio::ConnectionManager> {
    let client = redis::Client::open(url)?;
    let mut conn = client.get_connection_manager().await?;
    redis::cmd("PING").query_async::<()>(&mut conn).await?;
    Ok(conn)
}

/// Map an internal status to the public job-status enum.
fn external_status(internal: &str) -> &'static str {
    match internal {
        "pending" => "queued",
        "running" | "uploading" => "running",
        "done" => "succeeded",
        "error" => "failed",
        "canceled" => "canceled",
        _ => "running",
    }
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

/// Parse a `"model|contentHex|opts"` cache tuple stored alongside a pending job.
fn parse_cache(s: String) -> Option<(String, u128, u64)> {
    let mut it = s.splitn(3, '|');
    let model = it.next()?.to_string();
    let content = u128::from_str_radix(it.next()?, 16).ok()?;
    let opts = it.next()?.parse().ok()?;
    Some((model, content, opts))
}

/// Stable hash of an options object. `serde_json` serializes object keys sorted,
/// so the string is deterministic.
pub fn opts_hash(options: &Value) -> u64 {
    xxhash_rust::xxh3::xxh3_64(options.to_string().as_bytes())
}
