// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Async job store shared by every action (convert / optimize / plan / compact / thumbnail).
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
//! Artifacts are PUT to caller-signed URLs straight from memory when the submit
//! carried the URLs; only a `{result, stats}` POINTER is stored. Outputs that
//! could not be uploaded yet (no URL at submit, or the upload failed) are parked
//! for a late-mint poll: as files under the temp dir on a standing service, so
//! a large model never lands in a Redis the apps share, or in Redis on Lambda,
//! where the poll is answered by a different invocation than the one that
//! computed.

use crate::{cache::CODE_VERSION, config, dispatch, http};
use bytes::Bytes;
use dashmap::DashMap;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Notify;

/// One job's persisted state, stored in Redis as a JSON blob. `result`/`stats`
/// hold the completion POINTER (paths + counts) — never the artifact bytes.
#[derive(Clone, Serialize, Deserialize)]
struct JobRecord {
    action: String, // convert | optimize | plan | compact | thumbnail
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

/// One artifact to upload (name → bytes + content type). `Bytes`, so handing it
/// to an upload or a retry is a refcount, never a copy.
#[derive(Clone)]
pub struct Output {
    pub name: String,
    pub content_type: String,
    pub bytes: Bytes,
}

/// The terminal pointer to publish once every output is uploaded.
#[derive(Clone)]
pub struct Done {
    pub result: Value,
    pub stats: Value,
}

/// A parked job: its outputs, terminal pointer, and result-cache key.
type Parked = (Vec<Output>, Done, Option<(String, u128, u64)>);

/// Shared job + content-hash result store. Cloned into every handler via
/// `AppState`; inner state is `Arc`/manager-cloned so clones share one store.
#[derive(Clone)]
pub struct JobStore {
    conn: redis::aio::ConnectionManager,
    /// Where outputs wait for a late-minted URL: this directory, or Redis when
    /// `None` (Lambda — see the module doc).
    park_dir: Option<PathBuf>,
    /// Per-job in-process wakeups so a same-replica long-poll returns the instant
    /// the worker finishes (cross-replica completion caught by the Redis re-check).
    notifiers: Notifiers,
}

/// One wakeup per job a long-poll is waiting on. An entry lives only while a
/// poll holds a [`Watch`] on it, so the map does not grow with every job the
/// process has ever been asked about.
#[derive(Clone, Default)]
struct Notifiers(Arc<DashMap<String, Arc<Notify>>>);

struct Watch {
    notifiers: Notifiers,
    id: String,
    notify: Arc<Notify>,
}

impl Notifiers {
    fn watch(&self, id: &str) -> Watch {
        let notify = self
            .0
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(Notify::new()))
            .clone();
        Watch {
            notifiers: self.clone(),
            id: id.to_string(),
            notify,
        }
    }

    fn wake(&self, id: &str) {
        if let Some(n) = self.0.get(id) {
            n.notify_waiters();
        }
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        // The map's handle and this one: no other poll is waiting on the job.
        self.notifiers
            .0
            .remove_if(&self.id, |_, notify| Arc::strong_count(notify) <= 2);
    }
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
                    park_dir: (dispatch::from_env() == dispatch::Dispatch::Local)
                        .then(config::pending_dir),
                    notifiers: Notifiers::default(),
                }
            }
            Err(e) => {
                eprintln!("assembler: REDIS_URL unreachable ({e}); refusing to start");
                std::process::exit(1);
            }
        }
    }

    /// Whether Redis answers, for the health check. Bounded, so a connection
    /// that hangs fails the check instead of hanging it.
    pub async fn ping(&self) -> bool {
        let mut c = self.conn.clone();
        let ping = redis::cmd("PING");
        let answer = ping.query_async::<()>(&mut c);
        match tokio::time::timeout(Duration::from_secs(2), answer).await {
            Ok(Ok(())) => true,
            Ok(Err(e)) => {
                eprintln!("assembler: redis ping failed: {e}");
                false
            }
            Err(_) => {
                eprintln!("assembler: redis ping timed out");
                false
            }
        }
    }

    // --- job status (pointer, not artifact bytes) --------------------------

    async fn read(&self, id: &str) -> Option<JobRecord> {
        self.try_read(id).await.ok().flatten()
    }

    /// `Err` when Redis could not be asked, as opposed to `Ok(None)` for a job
    /// it does not have.
    async fn try_read(&self, id: &str) -> Result<Option<JobRecord>, ()> {
        let mut c = self.conn.clone();
        match c.get::<_, Option<String>>(job_key(id)).await {
            Ok(Some(s)) => Ok(serde_json::from_str(&s).ok()),
            Ok(None) => Ok(None),
            Err(e) => {
                eprintln!("assembler: redis job read failed: {e}");
                Err(())
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

    /// The EXTERNAL status of an active job (queued/running), for the create
    /// handler's idempotency-attach 202 response. None if unknown or terminal.
    pub async fn existing_active(&self, id: &str) -> Option<String> {
        self.internal_active(id)
            .await
            .map(|s| external_status(&s).to_string())
    }

    /// The INTERNAL status of an active job (pending/running/uploading). The
    /// worker inlet dedupes deliveries on these exact names — the external
    /// mapping folds pending->queued and uploading->running, which would make
    /// the worker's pending/uploading branches unreachable (every Lambda job
    /// no-op'd forever).
    pub async fn internal_active(&self, id: &str) -> Option<String> {
        self.read(id)
            .await
            .filter(|j| matches!(j.status.as_str(), "pending" | "running" | "uploading"))
            .map(|j| j.status)
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
        crate::telemetry::record_error(code, &message);
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
            self.unpark(id).await;
            // Wake the event-driven waiter immediately (terminal state).
            self.send_callback(id).await;
            self.wake(id);
        }
        Some(Self::render(id, &rec))
    }

    /// True when the job was canceled or its record is gone — the compute task
    /// asks this to abandon a run nobody waits for. A Redis that could not be
    /// asked is not a cancel: dropping a finished compute over one failed read
    /// would leave the job `running` until its TTL.
    pub async fn is_canceled(&self, id: &str) -> bool {
        match self.try_read(id).await {
            Ok(Some(rec)) => rec.status == "canceled",
            Ok(None) => true,
            Err(()) => false,
        }
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
        let mut watch = None;
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
            let watch = watch.get_or_insert_with(|| self.notifiers.watch(id));
            let tick = (dl - now).min(Duration::from_millis(500));
            tokio::select! {
                _ = watch.notify.notified() => {}
                _ = tokio::time::sleep(tick) => {}
            }
        }
    }

    pub fn wake(&self, id: &str) {
        self.notifiers.wake(id);
    }

    /// Complete a computed job. When the submit handed over an upload URL for
    /// every output, upload them straight from memory and publish the terminal
    /// pointer + completion callback — nothing is stored anywhere. Otherwise
    /// (no URLs at submit, or that upload failed) park the outputs and leave the
    /// job `uploading` for a late-mint poll to drain.
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
        self.set_status(id, "uploading").await;
        let urls = self
            .read(id)
            .await
            .and_then(|r| r.upload_urls)
            .unwrap_or_default();
        if has_every_url(&outputs, &urls) && upload_all(id, &outputs, &urls).await {
            self.publish(id, done, cache).await;
            // Terminal — deliver the callback from the action task, which owns
            // the process lifetime on the server path (the Lambda worker
            // re-sends after run_to_completion regardless).
            self.send_callback(id).await;
            self.wake(id);
            return;
        }
        self.park(id, &outputs, &done, &cache).await;
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

    // --- late-mint hand-off -------------------------------------------------

    /// Hold computed-but-unuploaded outputs until a poll brings URLs for them.
    /// A failure is logged only: the job then sits `uploading` with nothing to
    /// drain until the caller times out and resubmits, as with an expired TTL.
    async fn park(
        &self,
        id: &str,
        outputs: &[Output],
        done: &Done,
        cache: &Option<(String, u128, u64)>,
    ) {
        let manifest = json!({
            "outputs": outputs
                .iter()
                .map(|o| json!({ "name": o.name, "contentType": o.content_type }))
                .collect::<Vec<_>>(),
            "done": { "result": done.result, "stats": done.stats },
            "cache": cache.as_ref().map(|(m, ch, op)| format!("{m}|{ch:032x}|{op}")),
        })
        .to_string();
        let Some(dir) = self.park_path(id) else {
            let mut c = self.conn.clone();
            let mut pipe = redis::pipe();
            pipe.hset(pending_key(id), "manifest", manifest).ignore();
            for o in outputs {
                pipe.hset(pending_key(id), format!("b:{}", o.name), o.bytes.as_ref())
                    .ignore();
            }
            pipe.expire(pending_key(id), config::pending_ttl_secs() as i64)
                .ignore();
            if let Err(e) = pipe.query_async::<()>(&mut c).await {
                eprintln!("assembler: redis park failed: {e}");
            }
            return;
        };
        if let Err(e) = park_on_disk(&dir, &manifest, outputs).await {
            eprintln!("[{id}] could not park outputs in {}: {e}", dir.display());
            let _ = tokio::fs::remove_dir_all(&dir).await;
        }
    }

    /// The parked outputs of a job, if any are parked here.
    async fn parked(&self, id: &str) -> Option<Parked> {
        let Some(dir) = self.park_path(id) else {
            let mut c = self.conn.clone();
            let manifest: Option<String> = c
                .hget(pending_key(id), "manifest")
                .await
                .map_err(|e| eprintln!("assembler: redis parked read failed: {e}"))
                .ok()?;
            let manifest: Value = serde_json::from_str(&manifest?).ok()?;
            let mut outputs = Vec::new();
            for (name, content_type) in manifest_outputs(&manifest)? {
                let bytes: Option<Vec<u8>> =
                    c.hget(pending_key(id), format!("b:{name}")).await.ok()?;
                outputs.push(Output {
                    name,
                    content_type,
                    bytes: bytes?.into(),
                });
            }
            return Some((outputs, manifest_done(&manifest), manifest_cache(&manifest)));
        };
        parked_on_disk(&dir).await
    }

    async fn unpark(&self, id: &str) {
        let Some(dir) = self.park_path(id) else {
            let mut c = self.conn.clone();
            if let Err(e) = c.del::<_, ()>(pending_key(id)).await {
                eprintln!("assembler: redis unpark failed: {e}");
            }
            return;
        };
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    /// The directory a job's outputs park in. Job ids are caller-chosen
    /// (`Idempotency-Key`), so the name is a hash of the id, never the id.
    fn park_path(&self, id: &str) -> Option<PathBuf> {
        let name = format!("{:032x}", xxhash_rust::xxh3::xxh3_128(id.as_bytes()));
        self.park_dir.as_ref().map(|dir| dir.join(name))
    }

    /// Delete parked outputs older than the pending TTL — the job they belong to
    /// was never drained and has been (or will be) resubmitted. Redis expires
    /// its own keys, so this is the disk half of that TTL.
    pub async fn sweep_parked(&self) {
        let Some(dir) = &self.park_dir else {
            return;
        };
        sweep_dir(dir, Duration::from_secs(config::pending_ttl_secs())).await;
    }

    /// Drain parked outputs to fresh signed URLs (from a long-poll). Every
    /// output must have a matching URL; on success publishes the terminal
    /// pointer, else keeps the outputs for the next poll to retry.
    pub async fn try_finalize(&self, id: &str, urls: &HashMap<String, String>) -> Finalize {
        let Some((outputs, done, cache)) = self.parked(id).await else {
            return Finalize::NotPending;
        };
        if !has_every_url(&outputs, urls) {
            return Finalize::NotPending;
        }
        if !upload_all(id, &outputs, urls).await {
            return Finalize::Retry;
        }
        self.unpark(id).await;
        self.publish(id, done, cache).await;
        Finalize::Uploaded
    }

    /// Every output is uploaded: record the result pointer and mark the job done.
    async fn publish(&self, id: &str, done: Done, cache: Option<(String, u128, u64)>) {
        if let Some((model, content, opts)) = cache {
            let pointer = json!({ "result": done.result, "stats": done.stats });
            self.result_put(&model, content, opts, pointer).await;
        }
        self.set_done(id, done).await;
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

/// The client's defaults suit nobody waiting on a job: no limit on a connect
/// or a reply, and a reconnect backoff that goes from one second straight to a
/// minute or two (its factor of 100 multiplies each delay). After a Redis
/// restart that left every job read and write failing for about two minutes.
/// Bounded waits, and retries that double from one second up to five.
const REDIS_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REDIS_RESPONSE_TIMEOUT: Duration = Duration::from_secs(15);
const REDIS_RETRY_FACTOR: u64 = 2;
const REDIS_RETRY_MAX_DELAY_MS: u64 = 5_000;

async fn connect(url: &str) -> redis::RedisResult<redis::aio::ConnectionManager> {
    let client = redis::Client::open(url)?;
    let config = redis::aio::ConnectionManagerConfig::new()
        .set_connection_timeout(REDIS_CONNECT_TIMEOUT)
        .set_response_timeout(REDIS_RESPONSE_TIMEOUT)
        .set_factor(REDIS_RETRY_FACTOR)
        .set_max_delay(REDIS_RETRY_MAX_DELAY_MS);
    let mut conn = client.get_connection_manager_with_config(config).await?;
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

async fn park_on_disk(
    dir: &std::path::Path,
    manifest: &str,
    outputs: &[Output],
) -> std::io::Result<()> {
    tokio::fs::create_dir_all(dir).await?;
    for (i, o) in outputs.iter().enumerate() {
        tokio::fs::write(dir.join(i.to_string()), &o.bytes).await?;
    }
    // The manifest is written last, under its final name by rename, so a reader
    // never sees a job whose output files are still being written.
    tokio::fs::write(dir.join("manifest.tmp"), manifest).await?;
    tokio::fs::rename(dir.join("manifest.tmp"), dir.join("manifest.json")).await
}

async fn parked_on_disk(dir: &std::path::Path) -> Option<Parked> {
    let manifest = tokio::fs::read(dir.join("manifest.json")).await.ok()?;
    let manifest: Value = serde_json::from_slice(&manifest).ok()?;
    let mut outputs = Vec::new();
    for (i, (name, content_type)) in manifest_outputs(&manifest)?.into_iter().enumerate() {
        outputs.push(Output {
            name,
            content_type,
            bytes: http::map_file(&dir.join(i.to_string())).ok()?,
        });
    }
    Some((outputs, manifest_done(&manifest), manifest_cache(&manifest)))
}

/// Remove every entry of `dir` last modified more than `ttl` ago.
async fn sweep_dir(dir: &std::path::Path, ttl: Duration) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let age = entry
            .metadata()
            .await
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok());
        if age.is_some_and(|age| age > ttl) {
            let _ = tokio::fs::remove_dir_all(entry.path()).await;
        }
    }
}

fn has_every_url(outputs: &[Output], urls: &HashMap<String, String>) -> bool {
    outputs.iter().all(|o| urls.contains_key(&o.name))
}

/// PUT every output to its URL. False on the first failure (logged).
async fn upload_all(id: &str, outputs: &[Output], urls: &HashMap<String, String>) -> bool {
    for o in outputs {
        if let Err(e) = http::upload(&urls[&o.name], o.bytes.clone(), &o.content_type).await {
            eprintln!(
                "[{id}] output '{}' upload failed (a poll retries with fresh URLs): {}",
                o.name, e.message
            );
            return false;
        }
    }
    true
}

fn manifest_outputs(manifest: &Value) -> Option<Vec<(String, String)>> {
    manifest["outputs"]
        .as_array()?
        .iter()
        .map(|o| {
            Some((
                o["name"].as_str()?.to_string(),
                o["contentType"]
                    .as_str()
                    .unwrap_or("application/octet-stream")
                    .to_string(),
            ))
        })
        .collect()
}

fn manifest_done(manifest: &Value) -> Done {
    Done {
        result: manifest["done"]["result"].clone(),
        stats: manifest["done"]["stats"].clone(),
    }
}

fn manifest_cache(manifest: &Value) -> Option<(String, u128, u64)> {
    manifest["cache"].as_str().map(str::to_string).and_then(parse_cache)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn output(name: &str, bytes: &'static [u8]) -> Output {
        Output {
            name: name.into(),
            content_type: "application/octet-stream".into(),
            bytes: Bytes::from_static(bytes),
        }
    }

    #[test]
    fn a_wakeup_lives_only_while_a_poll_waits_on_it() {
        let notifiers = Notifiers::default();
        let first = notifiers.watch("job");
        let second = notifiers.watch("job");
        assert!(Arc::ptr_eq(&first.notify, &second.notify));

        drop(first);
        assert_eq!(notifiers.0.len(), 1, "the second poll still waits");
        drop(second);
        assert!(notifiers.0.is_empty());
    }

    #[tokio::test]
    async fn parked_outputs_come_back_from_disk_as_they_went_in() {
        let dir = tempfile::tempdir().unwrap();
        let job = dir.path().join("job");
        let manifest = json!({
            "outputs": [
                { "name": "glb", "contentType": "model/gltf-binary" },
                { "name": "graph", "contentType": "application/json" },
                { "name": "empty", "contentType": "text/plain" },
            ],
            "done": { "result": { "componentCount": 3 }, "stats": { "ms": 7 } },
            "cache": "model-1|000000000000000000000000000000ff|42",
        })
        .to_string();
        let outputs = [output("glb", b"glTF-bytes"), output("graph", b"{}"), output("empty", b"")];

        assert!(parked_on_disk(&job).await.is_none());
        park_on_disk(&job, &manifest, &outputs).await.unwrap();

        let (back, done, cache) = parked_on_disk(&job).await.unwrap();
        let names: Vec<_> = back.iter().map(|o| (o.name.as_str(), &o.bytes[..])).collect();
        assert_eq!(
            names,
            [("glb", &b"glTF-bytes"[..]), ("graph", &b"{}"[..]), ("empty", &b""[..])]
        );
        assert_eq!(back[0].content_type, "model/gltf-binary");
        assert_eq!(done.result["componentCount"], 3);
        assert_eq!(done.stats["ms"], 7);
        assert_eq!(cache, Some(("model-1".to_string(), 0xff, 42)));
    }

    #[tokio::test]
    async fn a_job_without_its_manifest_is_not_parked() {
        // Output files land before the manifest; a reader in between sees nothing.
        let dir = tempfile::tempdir().unwrap();
        let job = dir.path().join("job");
        tokio::fs::create_dir_all(&job).await.unwrap();
        tokio::fs::write(job.join("0"), b"half-written").await.unwrap();
        assert!(parked_on_disk(&job).await.is_none());
    }

    #[tokio::test]
    async fn the_sweep_removes_only_what_outlived_the_ttl() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = json!({ "outputs": [], "done": {} }).to_string();
        park_on_disk(&dir.path().join("old"), &manifest, &[]).await.unwrap();

        sweep_dir(dir.path(), Duration::from_secs(3600)).await;
        assert!(dir.path().join("old").exists());

        sweep_dir(dir.path(), Duration::ZERO).await;
        assert!(!dir.path().join("old").exists());
    }
}
