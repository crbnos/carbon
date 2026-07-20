//! Async job store shared by every heavy action (convert / optimize / plan).
//! One lifecycle for all actions: create -> compute -> finalize (submit-time
//! URLs) -> completion callback; GET /v1/jobs/{id}?wait= serves status and the
//! late-mint fallback.
//!
//! Redis-backed, and Redis is REQUIRED (`REDIS_URL`): status +
//! pointers (never artifact bytes) live in Redis, so a restart, a sibling
//! replica, or a different Lambda invocation can still answer the poll — the
//! service is stateless. Boot fails loudly when Redis is missing/unreachable;
//! a silent in-memory fallback would strand cross-instance polls (Lambda
//! dispatch depends on shared state) and hide the misconfiguration.
//!
//! Artifacts are PUT to caller-signed URLs; only a `{result, stats}` POINTER is
//! stored — artifact bytes never enter Redis beyond the pending hand-off.

use crate::{cache::CODE_VERSION, config, http};
use dashmap::DashMap;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Notify;

/// One job's persisted state, stored in Redis as a JSON blob. `result`/`stats`
/// hold the completion POINTER (paths + counts) — never the artifact bytes.
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
    /// Signed PUT URLs handed over AT SUBMIT (name → URL). Lets the job finalize
    /// the moment compute ends — no poll needed to deliver upload URLs. Fresh
    /// per-poll URLs remain the retry path if these expired. Never rendered.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    upload_urls: Option<HashMap<String, String>>,
    /// Completion webhook minted by the caller at submit: the terminal job
    /// envelope is POSTed here (fire-with-retries) so the caller's workflow
    /// wakes on an event instead of polling. Never rendered.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    callback_url: Option<String>,
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

/// Shared job + content-hash result store. Cloned into every handler via
/// `AppState`; inner state is `Arc`/manager-cloned so clones share one store.
/// Computed-but-unuploaded artifacts (the late-mint hand-off) live in Redis
/// under a short TTL so ANY replica's/invocation's poll can drain them.
#[derive(Clone)]
pub struct JobStore {
    conn: redis::aio::ConnectionManager,
    /// Per-job in-process wakeups so a same-replica long-poll returns the instant
    /// the worker finishes (cross-replica completion caught by the Redis re-check).
    notifiers: Arc<DashMap<String, Arc<Notify>>>,
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
    /// Build from env. Redis is REQUIRED — a missing or unreachable
    /// `REDIS_URL` refuses to boot (fail loud; a memory fallback would
    /// strand cross-instance polls and hide the misconfiguration).
    pub async fn from_env() -> Self {
        let Some(url) = config::redis_url() else {
            eprintln!(
                "assembler: Redis is required (set REDIS_URL); refusing to start"
            );
            std::process::exit(1);
        };
        match connect(&url).await {
            Ok(conn) => {
                eprintln!("assembler: redis job store connected");
                JobStore {
                    conn,
                    notifiers: Arc::new(DashMap::new()),
                }
            }
            Err(e) => {
                eprintln!("assembler: REDIS_URL unreachable ({e}); refusing to start");
                std::process::exit(1);
            }
        }
    }

    // --- job status (pointer, not artifact bytes) --------------------------

    async fn read(&self, id: &str) -> Option<JobRecord> {
        let mut c = self.conn.clone();
        match c.get::<_, Option<String>>(job_key(id)).await {
            Ok(Some(s)) => serde_json::from_str(&s).ok(),
            Ok(None) => None,
            Err(e) => {
                eprintln!("assembler: redis job read failed: {e}");
                None
            }
        }
    }

    async fn write(&self, id: &str, rec: &JobRecord) {
        let Ok(payload) = serde_json::to_string(rec) else {
            return;
        };
        let mut c = self.conn.clone();
        if let Err(e) = c
            .set_ex::<_, _, ()>(job_key(id), payload, config::job_ttl_secs())
            .await
        {
            eprintln!("assembler: redis job write failed: {e}");
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

    pub async fn set_pending(
        &self,
        id: &str,
        action: &str,
        meta: Option<Value>,
        upload_urls: HashMap<String, String>,
        callback_url: Option<String>,
    ) {
        self.write(
            id,
            &JobRecord {
                action: action.to_string(),
                status: "pending".into(),
                result: None,
                stats: None,
                error: None,
                meta,
                upload_urls: (!upload_urls.is_empty()).then_some(upload_urls),
                callback_url,
            },
        )
        .await;
    }

    pub async fn set_status(&self, id: &str, status: &str) {
        if let Some(mut rec) = self.read(id).await {
            // Canceled is terminal: a compute task that raced past its
            // is_canceled check must not resurrect the job.
            if rec.status == "canceled" {
                return;
            }
            rec.status = status.to_string();
            self.write(id, &rec).await;
        }
    }

    /// Publish a terminal `done` pointer. Deliberately does NOT deliver the
    /// completion callback: this runs on the poll path too (a late-mint
    /// `try_finalize` inside GET /v1/jobs), where awaiting callback retries
    /// would blow the poll's own timeout — and the poller already receives the
    /// result synchronously. Owners that need the notification send it
    /// explicitly: `finish()` on the direct-upload path, the plan action's
    /// inline/cache-hit publishes, and the worker/CLI after run_to_completion.
    pub async fn set_done(&self, id: &str, done: Done) {
        if let Some(mut rec) = self.read(id).await {
            if rec.status == "canceled" {
                return;
            }
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
            if rec.status == "canceled" {
                return;
            }
            rec.status = "error".into();
            rec.error = Some(json!({ "code": code, "message": message }));
            self.write(id, &rec).await;
        }
        self.send_callback(id).await;
        self.wake(id);
    }

    /// Best-effort cancel: mark canceled only if still active. The running task
    /// isn't forcibly killed — it drops its result when it finds the job canceled.
    pub async fn cancel(&self, id: &str) -> Option<Value> {
        let mut rec = self.read(id).await?;
        if matches!(rec.status.as_str(), "pending" | "running" | "uploading") {
            rec.status = "canceled".into();
            self.write(id, &rec).await;
            self.pending_remove(id).await;
            // Wake the event-driven waiter immediately (terminal state).
            self.send_callback(id).await;
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

    /// Hold computed-but-unuploaded artifacts for hand-off, stored in Redis
    /// (bytes + pointer) under a short TTL so ANY replica's poll can drain them.
    pub async fn pending_put(
        &self,
        id: &str,
        outputs: Vec<Output>,
        done: Done,
        cache: Option<(String, u128, u64)>,
    ) {
        let manifest: Vec<Value> = outputs
            .iter()
            .map(|o| json!({ "name": o.name, "contentType": o.content_type }))
            .collect();
        let done_json = json!({ "result": done.result, "stats": done.stats }).to_string();
        let mut c = self.conn.clone();
        let mut pipe = redis::pipe();
        pipe.hset(
            pending_key(id),
            "manifest",
            Value::from(manifest).to_string(),
        )
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

    /// Complete a computed job: hold the artifacts for upload, and — when the
    /// submit handed over upload URLs — finalize immediately (upload + publish
    /// the terminal pointer + fire the completion callback), so no poll is ever
    /// needed on the happy path. Without submit-time URLs the job parks in
    /// `uploading` and a late-mint poll drains it (the legacy/retry path).
    /// Replaces the pending_put + set_status("uploading") + wake trio in actions.
    pub async fn finish(
        &self,
        id: &str,
        outputs: Vec<Output>,
        done: Done,
        cache: Option<(String, u128, u64)>,
    ) {
        // A cancel that landed mid-compute wins: drop the result, upload nothing.
        if self.is_canceled(id).await {
            eprintln!("[{id}] finished after cancel; result dropped");
            return;
        }
        self.pending_put(id, outputs, done, cache).await;
        self.set_status(id, "uploading").await;
        let urls = self.read(id).await.and_then(|r| r.upload_urls);
        if let Some(urls) = urls {
            if let Finalize::Uploaded = self.try_finalize(id, &urls).await {
                // Terminal — deliver the callback from the action task, which
                // owns the process lifetime on the server path (the Lambda
                // worker re-sends after run_to_completion regardless).
                // Retry/NotPending: submit-time URLs failed; a late-mint poll
                // retries with fresh ones.
                self.send_callback(id).await;
            }
        }
        self.wake(id);
    }

    /// POST the terminal job envelope to the submit-time callback URL, if any.
    /// Bounded retries; failure is logged only — the caller's waitForEvent
    /// timeout + fallback poll covers a lost callback.
    pub async fn send_callback(&self, id: &str) {
        let Some(rec) = self.read(id).await else {
            return;
        };
        let Some(url) = rec.callback_url.clone() else {
            return;
        };
        if !matches!(rec.status.as_str(), "done" | "error" | "canceled") {
            return;
        }
        let body = Self::render(id, &rec);
        for attempt in 1..=3u32 {
            match http::post_json(&url, &body).await {
                Ok(()) => {
                    eprintln!("[{id}] completion callback delivered");
                    return;
                }
                Err(e) => {
                    eprintln!(
                        "[{id}] completion callback attempt {attempt} failed: {}",
                        e.message
                    );
                    tokio::time::sleep(Duration::from_secs(attempt as u64)).await;
                }
            }
        }
        eprintln!("[{id}] completion callback undelivered; caller falls back to poll");
    }

    async fn pending_take(
        &self,
        id: &str,
    ) -> Option<(Vec<Output>, Done, Option<(String, u128, u64)>)> {
        let mut c = self.conn.clone();
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
            let content_type = m["contentType"]
                .as_str()
                .unwrap_or("application/octet-stream")
                .to_string();
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

    async fn pending_remove(&self, id: &str) {
        let mut c = self.conn.clone();
        if let Err(e) = c.del::<_, ()>(pending_key(id)).await {
            eprintln!("assembler: redis pending_remove failed: {e}");
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
        let mut c = self.conn.clone();
        let raw: Option<Value> = match c.get::<_, Option<String>>(&key).await {
            Ok(Some(s)) => serde_json::from_str(&s).ok(),
            Ok(None) => None,
            Err(e) => {
                eprintln!("assembler: redis result read failed: {e}");
                None
            }
        };
        raw.map(|v| Done {
            result: v["result"].clone(),
            stats: v["stats"].clone(),
        })
    }

    async fn result_put(&self, model: &str, content: u128, opts: u64, pointer: Value) {
        let key = result_key(model, content, opts);
        let Ok(payload) = serde_json::to_string(&pointer) else {
            return;
        };
        let mut c = self.conn.clone();
        if let Err(e) = c
            .set_ex::<_, _, ()>(&key, payload, config::result_ttl_secs())
            .await
        {
            eprintln!("assembler: redis result write failed: {e}");
        }
    }

    /// Central explicit invalidation: drop every cached result pointer for a
    /// model so the next job re-derives. Returns how many entries were cleared.
    pub async fn invalidate_model(&self, model: &str) -> usize {
        let prefix = format!("asm:result:{model}:");
        let pattern = format!("{prefix}*");
        let mut scan = self.conn.clone();
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
        let mut c = self.conn.clone();
        if let Err(e) = c.del::<_, ()>(&keys).await {
            eprintln!("assembler: redis invalidate del failed: {e}");
            return 0;
        }
        keys.len()
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
