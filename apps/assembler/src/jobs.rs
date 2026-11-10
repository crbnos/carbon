// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Async job store shared by every action (`request::ACTIONS`).
//! One lifecycle for all actions: create -> compute -> upload to the submit-time
//! URLs -> completion callback; GET /v1/jobs/{id}?wait= serves status.
//!
//! Redis-backed, and Redis is REQUIRED (`REDIS_URL`): status +
//! pointers live in Redis, so a restart, a sibling replica, or a different
//! Lambda invocation can still answer the poll — the service is stateless.
//! Boot fails loudly when Redis is missing/unreachable; a silent in-memory
//! fallback would strand cross-instance polls (Lambda dispatch depends on
//! shared state) and hide the misconfiguration.
//!
//! Artifacts are PUT to the caller's signed URLs straight from memory; only a
//! `{result, stats}` POINTER is stored. Artifact bytes never go to Redis: an
//! upload that still fails after its retries fails the job with
//! `UPLOAD_FAILED`, and the caller resubmits with fresh URLs.

use crate::{cache::CODE_VERSION, config, http};
use bytes::Bytes;
use dashmap::DashMap;
use redis::AsyncCommands;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

/// Waits between upload attempts: four tries in all, about seven seconds.
const UPLOAD_RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
];

/// One job's state: a Redis HASH (one field each), so a status change can be
/// made conditional on the current status in one script without decoding the
/// rest. `result`/`stats` hold the completion POINTER (paths + counts) — never
/// the artifact bytes.
#[derive(Clone)]
struct JobRecord {
    action: String, // one of `request::ACTIONS`
    status: String, // pending | starting | running | uploading | done | error | canceled
    result: Option<Value>,
    stats: Option<Value>,
    error: Option<Value>, // { code, message }
    /// Signed PUT URLs handed over AT SUBMIT (name → URL), one per output.
    /// Never rendered; cleared once the job ends (they are bearer tokens).
    /// `callback_url` stays: the Lambda worker re-sends the callback after the
    /// job ends, and it only lets its holder report this one job.
    upload_urls: Option<HashMap<String, String>>,
    /// Completion webhook minted by the caller at submit: the terminal job
    /// envelope is POSTed here (fire-with-retries) so the caller's workflow
    /// wakes on an event instead of polling. Never rendered.
    callback_url: Option<String>,
}

impl JobRecord {
    fn from_fields(mut fields: HashMap<String, String>) -> Option<Self> {
        fn json<T: serde::de::DeserializeOwned>(v: Option<String>) -> Option<T> {
            v.and_then(|s| serde_json::from_str(&s).ok())
        }
        Some(JobRecord {
            action: fields.remove("action")?,
            status: fields.remove("status")?,
            result: json(fields.remove("result")),
            stats: json(fields.remove("stats")),
            error: json(fields.remove("error")),
            upload_urls: json(fields.remove("upload_urls")),
            callback_url: fields.remove("callback_url"),
        })
    }
}

/// Change a job only while it is still active (the one status check and the
/// write are a single atomic script, so a finish can never overwrite a cancel
/// that landed meanwhile). ARGV: ttl, n, then n field/value pairs to set, then
/// fields to delete. Returns 1 when it changed the job.
static TRANSITION: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r"
        local s = redis.call('HGET', KEYS[1], 'status')
        if s ~= 'pending' and s ~= 'starting' and s ~= 'running' and s ~= 'uploading' then
            return 0
        end
        local n = tonumber(ARGV[2])
        for i = 0, n - 1 do
            redis.call('HSET', KEYS[1], ARGV[3 + 2 * i], ARGV[4 + 2 * i])
        end
        for i = 3 + 2 * n, #ARGV do
            redis.call('HDEL', KEYS[1], ARGV[i])
        end
        redis.call('EXPIRE', KEYS[1], ARGV[1])
        return 1
        ",
    )
});

/// How long a running job's lease lives, and how often its worker renews it.
/// A poll that finds an active job with no lease ends it as `WORKER_LOST`: the
/// process running it died (a restart, an OOM kill, a Lambda timeout).
const LEASE_TTL_SECS: u64 = 30;
const LEASE_RENEW_EVERY: Duration = Duration::from_secs(10);

/// The jobs this process is running, with each one's cancel token.
static RUNNING: LazyLock<DashMap<String, CancellationToken>> = LazyLock::new(DashMap::new);

tokio::task_local! {
    /// The running job's cancel token, for the downloads and uploads it makes.
    static JOB_CANCEL: CancellationToken;
}

/// Run `job` as job `id` of this process: listed for the lease heartbeat, and
/// with a cancel token its transfers watch (`current_cancel`).
pub fn track<F: Future>(id: &str, job: F) -> impl Future<Output = F::Output> {
    struct Untrack(String);
    impl Drop for Untrack {
        fn drop(&mut self) {
            RUNNING.remove(&self.0);
        }
    }
    let token = CancellationToken::new();
    RUNNING.insert(id.to_string(), token.clone());
    let untrack = Untrack(id.to_string());
    JOB_CANCEL.scope(token, async move {
        let _untrack = untrack;
        job.await
    })
}

/// The cancel token of the job this task is running, if it is one.
pub fn current_cancel() -> Option<CancellationToken> {
    JOB_CANCEL.try_with(CancellationToken::clone).ok()
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

/// Shared job + content-hash result store. Cloned into every handler via
/// `AppState`; inner state is `Arc`/manager-cloned so clones share one store.
#[derive(Clone)]
pub struct JobStore {
    conn: redis::aio::ConnectionManager,
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
        match c.hgetall::<_, HashMap<String, String>>(job_key(id)).await {
            Ok(fields) if fields.is_empty() => Ok(None),
            Ok(fields) => Ok(JobRecord::from_fields(fields)),
            Err(e) => {
                eprintln!("assembler: redis job read failed: {e}");
                Err(())
            }
        }
    }

    /// Apply `set` and `delete` to an active job; false when the job is gone
    /// or already ended (canceled included), so nothing was changed.
    async fn transition(&self, id: &str, set: &[(&str, String)], delete: &[&str]) -> bool {
        let mut invocation = TRANSITION.key(job_key(id));
        invocation.arg(config::job_ttl_secs()).arg(set.len());
        for (field, value) in set {
            invocation.arg(*field).arg(value);
        }
        for field in delete {
            invocation.arg(*field);
        }
        let mut c = self.conn.clone();
        match invocation.invoke_async::<i64>(&mut c).await {
            Ok(changed) => changed == 1,
            Err(e) => {
                eprintln!("assembler: redis job transition failed: {e}");
                false
            }
        }
    }

    /// The EXTERNAL status of an active job (queued/running), for the create
    /// handler's idempotency-attach 202 response. None if unknown or terminal.
    pub async fn existing_active(&self, id: &str) -> Option<String> {
        self.internal_active(id)
            .await
            .map(|s| external_status(&s).to_string())
    }

    /// The INTERNAL status of an active job (pending/starting/running/uploading).
    /// The worker inlet decides on these exact names — the external mapping
    /// folds pending/starting->queued and uploading->running.
    pub async fn internal_active(&self, id: &str) -> Option<String> {
        self.read(id)
            .await
            .filter(|j| is_active(&j.status))
            .map(|j| j.status)
    }

    pub async fn set_pending(
        &self,
        id: &str,
        action: &str,
        upload_urls: HashMap<String, String>,
        callback_url: Option<String>,
    ) {
        let mut fields = vec![
            ("action", action.to_string()),
            ("status", "pending".to_string()),
        ];
        if !upload_urls.is_empty() {
            fields.push(("upload_urls", json!(upload_urls).to_string()));
        }
        if let Some(url) = callback_url {
            fields.push(("callback_url", url));
        }
        let key = job_key(id);
        let mut c = self.conn.clone();
        let written = redis::pipe()
            .atomic()
            .del(&key)
            .ignore()
            .hset_multiple(&key, &fields)
            .ignore()
            .expire(&key, config::job_ttl_secs() as i64)
            .ignore()
            .query_async::<()>(&mut c)
            .await;
        if let Err(e) = written {
            eprintln!("assembler: redis job write failed: {e}");
        }
    }

    /// Move an active job to `status`. A job that is working (not `pending`)
    /// holds a lease, renewed by `heartbeat` while this process runs it.
    pub async fn set_status(&self, id: &str, status: &str) {
        // The lease first: a poll between the two writes would otherwise see a
        // working status with no lease and end a live job `WORKER_LOST`. A
        // lease left on a job that already ended expires on its own.
        if status != "pending" {
            self.renew_lease(id).await;
        }
        self.transition(id, &[("status", status.to_string())], &[]).await;
    }

    /// Publish a terminal `done` pointer. Does NOT deliver the completion
    /// callback; its owner sends it: `finish()`, the plan action's cache-hit
    /// publish, and the Lambda worker after `run_to_completion`.
    pub async fn set_done(&self, id: &str, done: Done) {
        let set = [
            ("status", "done".to_string()),
            ("result", done.result.to_string()),
            ("stats", done.stats.to_string()),
        ];
        if self.transition(id, &set, &["error", "upload_urls"]).await {
            self.ended(id).await;
        }
        self.wake(id);
    }

    pub async fn set_error(&self, id: &str, code: &str, message: String) {
        crate::telemetry::record_error(code, &message);
        let set = [
            ("status", "error".to_string()),
            ("error", json!({ "code": code, "message": message }).to_string()),
        ];
        if self.transition(id, &set, &["upload_urls"]).await {
            self.ended(id).await;
        }
        self.notify(id);
        self.wake(id);
    }

    /// A job ended: drop its lease and the request a Lambda worker read.
    async fn ended(&self, id: &str) {
        let mut c = self.conn.clone();
        if let Err(e) = c.del::<_, ()>(&[lease_key(id), request_key(id)]).await {
            eprintln!("assembler: redis job cleanup failed: {e}");
        }
    }

    /// Deliver the callback in its own task: its retries can take ~36 s, and
    /// `set_error`/`cancel` run inside requests that API Gateway cuts at 30 s.
    fn notify(&self, id: &str) {
        let store = self.clone();
        let id = id.to_string();
        tokio::spawn(async move { store.send_callback(&id).await });
    }

    // --- leases: who is running a job --------------------------------------

    /// Take a job no live worker holds (a Lambda worker's claim: of two
    /// deliveries one wins, and a redelivery after a crash takes over).
    pub async fn claim_lease(&self, id: &str) -> bool {
        let mut c = self.conn.clone();
        let claimed: redis::RedisResult<Option<String>> = redis::cmd("SET")
            .arg(lease_key(id))
            .arg(1)
            .arg("NX")
            .arg("EX")
            .arg(LEASE_TTL_SECS)
            .query_async(&mut c)
            .await;
        claimed.map_or_else(
            |e| {
                eprintln!("assembler: redis lease claim failed: {e}");
                false
            },
            |reply| reply.is_some(),
        )
    }

    async fn renew_lease(&self, id: &str) {
        let mut c = self.conn.clone();
        if let Err(e) = c
            .set_ex::<_, _, ()>(lease_key(id), 1, LEASE_TTL_SECS)
            .await
        {
            eprintln!("assembler: redis lease renew failed: {e}");
        }
    }

    /// Whether a live worker holds the job. A Redis that cannot be asked
    /// answers yes: a job is never ended over one failed read.
    async fn lease_alive(&self, id: &str) -> bool {
        let mut c = self.conn.clone();
        c.exists::<_, bool>(lease_key(id)).await.unwrap_or(true)
    }

    /// Every `LEASE_RENEW_EVERY`: renew the lease of each job this process
    /// runs, and cancel the token of any that was canceled (from any replica).
    /// Runs for the life of the process.
    pub async fn heartbeat(&self) {
        loop {
            tokio::time::sleep(LEASE_RENEW_EVERY).await;
            let running: Vec<(String, CancellationToken)> = RUNNING
                .iter()
                .map(|e| (e.key().clone(), e.value().clone()))
                .collect();
            if running.is_empty() {
                continue;
            }
            let mut pipe = redis::pipe();
            for (id, _) in &running {
                pipe.set_ex(lease_key(id), 1, LEASE_TTL_SECS).ignore();
                pipe.hget(job_key(id), "status");
            }
            let mut c = self.conn.clone();
            match pipe.query_async::<Vec<Option<String>>>(&mut c).await {
                Ok(statuses) => {
                    for ((_, token), status) in running.iter().zip(statuses) {
                        if status.as_deref() == Some("canceled") {
                            token.cancel();
                        }
                    }
                }
                Err(e) => eprintln!("assembler: redis heartbeat failed: {e}"),
            }
        }
    }

    // --- Lambda requests ----------------------------------------------------

    /// Hold a Lambda job's request body for its worker. The worker spec carries
    /// only ids, so signed URLs and caller tokens never ride in the Invoke
    /// payload (which AWS keeps for its async retries). Kept until the job
    /// ends, so a redelivery after a crashed worker can run it again.
    pub async fn put_request(&self, id: &str, body: &Value) -> Result<(), String> {
        let mut c = self.conn.clone();
        c.set_ex::<_, _, ()>(request_key(id), body.to_string(), REQUEST_TTL_SECS)
            .await
            .map_err(|e| format!("could not store the request: {e}"))
    }

    /// A Lambda job's request body; `None` once the job ended or it expired.
    pub async fn read_request(&self, id: &str) -> Option<Value> {
        let mut c = self.conn.clone();
        let raw: Option<String> = c
            .get(request_key(id))
            .await
            .map_err(|e| eprintln!("assembler: redis request read failed: {e}"))
            .ok()?;
        serde_json::from_str(&raw?).ok()
    }

    /// Hold the create window for `id`, so two POSTs with one Idempotency-Key
    /// cannot both spawn (the active check and the pending write are separate
    /// round trips). False while another create holds it. A Redis that cannot
    /// be asked does not block the create: its own writes fail just the same.
    pub async fn claim_create(&self, id: &str) -> bool {
        let mut c = self.conn.clone();
        let claimed: redis::RedisResult<Option<String>> = redis::cmd("SET")
            .arg(create_key(id))
            .arg(1)
            .arg("NX")
            .arg("EX")
            .arg(CREATE_CLAIM_TTL_SECS)
            .query_async(&mut c)
            .await;
        match claimed {
            Ok(reply) => reply.is_some(),
            Err(e) => {
                eprintln!("assembler: redis create claim failed: {e}");
                true
            }
        }
    }

    pub async fn release_create(&self, id: &str) {
        let mut c = self.conn.clone();
        if let Err(e) = c.del::<_, ()>(create_key(id)).await {
            eprintln!("assembler: redis create release failed: {e}");
        }
    }

    /// Cancel an active job. Its downloads and uploads stop at once on this
    /// replica, or within a heartbeat on another; a compute already running
    /// finishes and its result is dropped.
    pub async fn cancel(&self, id: &str) -> Option<Value> {
        if self
            .transition(id, &[("status", "canceled".to_string())], &["upload_urls"])
            .await
        {
            if let Some(token) = RUNNING.get(id) {
                token.cancel();
            }
            self.ended(id).await;
            // Wake the event-driven waiter immediately (terminal state).
            self.notify(id);
            self.wake(id);
        }
        let rec = self.read(id).await?;
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
        json!({ "ok": true, "job": job })
    }

    /// Long-poll a job to a terminal state. With `max`, holds until terminal or
    /// the deadline; without, a single shot. `None` only if the job is unknown.
    pub async fn poll(&self, id: &str, max: Option<Duration>) -> Option<Value> {
        let deadline = max.map(|m| Instant::now() + m);
        let mut watch = None;
        loop {
            let mut rec = self.read(id).await?;
            // Working, but no process holds its lease: whatever ran it died.
            if matches!(rec.status.as_str(), "starting" | "running" | "uploading")
                && !self.lease_alive(id).await
            {
                self.set_error(id, "WORKER_LOST", "the worker running this job stopped".into())
                    .await;
                rec = self.read(id).await?;
            }
            if matches!(rec.status.as_str(), "done" | "error" | "canceled") {
                return Some(Self::render(id, &rec));
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

    /// Complete a computed job: upload every output to its submit-time URL,
    /// then publish the terminal pointer and deliver the callback. An upload
    /// that fails after its retries fails the job with `UPLOAD_FAILED`; the
    /// outputs are dropped, never kept for later.
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
        let uploaded = upload_all(id, &outputs, &urls, &UPLOAD_RETRY_DELAYS).await;
        // Nothing reads the bytes past this point; don't hold them through
        // the callback's retries.
        drop(outputs);
        match uploaded {
            Ok(()) => {
                self.publish(id, done, cache).await;
                // Terminal — deliver the callback from the action task, which
                // owns the process lifetime on the server path (the Lambda
                // worker re-sends after run_to_completion regardless).
                self.send_callback(id).await;
                self.wake(id);
            }
            Err(message) => self.set_error(id, "UPLOAD_FAILED", message).await,
        }
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
        let pattern = format!("asm:result:{}:*", escape_glob(model));
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
/// `starting`: a worker took the job and is downloading its source or waiting
/// for memory. It is still `queued` to callers (queue time is not work), but a
/// second delivery of the same job sees it as taken. `running` is set only
/// once admission grants the memory.
fn is_active(status: &str) -> bool {
    matches!(status, "pending" | "starting" | "running" | "uploading")
}

fn external_status(internal: &str) -> &'static str {
    match internal {
        "pending" | "starting" => "queued",
        "running" | "uploading" => "running",
        "done" => "succeeded",
        "error" => "failed",
        "canceled" => "canceled",
        _ => "running",
    }
}

/// `asm:job2`: the record became a hash (it was a JSON string under
/// `asm:job`), and a new prefix keeps the two from meeting during a deploy.
fn job_key(id: &str) -> String {
    format!("asm:job2:{id}")
}

fn lease_key(id: &str) -> String {
    format!("asm:lease:{id}")
}

/// How long a Lambda job's request is kept at most (it is deleted when the job
/// ends): long enough for AWS's async retries to redeliver a crashed job.
const REQUEST_TTL_SECS: u64 = 2 * 60 * 60;

/// How long a create may hold its window; released as soon as it is done.
const CREATE_CLAIM_TTL_SECS: u64 = 30;

fn create_key(id: &str) -> String {
    format!("asm:create:{id}")
}

fn request_key(id: &str) -> String {
    format!("asm:req:{id}")
}

/// Escape Redis glob metacharacters, so a caller's id matches only itself.
fn escape_glob(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '*' | '?' | '[' | ']' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn result_key(model: &str, content: u128, opts: u64) -> String {
    format!("asm:result:{model}:{content:032x}:{opts:016x}:v{CODE_VERSION}")
}

/// PUT every output to its URL, retrying each one after every wait in
/// `delays`. An output with no URL, or one still failing after its retries,
/// is the error (the message names the output).
async fn upload_all(
    id: &str,
    outputs: &[Output],
    urls: &HashMap<String, String>,
    delays: &[Duration],
) -> Result<(), String> {
    for o in outputs {
        let Some(url) = urls.get(&o.name) else {
            return Err(format!("no upload URL for output '{}'", o.name));
        };
        let mut waits = delays.iter();
        loop {
            match http::upload(url, o.bytes.clone(), &o.content_type).await {
                Ok(()) => break,
                Err(e) => match waits.next() {
                    Some(wait) => {
                        eprintln!(
                            "[{id}] output '{}' upload failed, retrying in {wait:?}: {}",
                            o.name, e.message
                        );
                        tokio::time::sleep(*wait).await;
                    }
                    None => {
                        return Err(format!("output '{}' upload failed: {}", o.name, e.message))
                    }
                },
            }
        }
    }
    Ok(())
}

/// Stable hash of an options object. `serde_json` serializes object keys sorted,
/// so the string is deterministic.
pub fn opts_hash(options: &Value) -> u64 {
    xxhash_rust::xxh3::xxh3_64(options.to_string().as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

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

    #[test]
    fn a_model_id_matches_only_itself_in_a_scan() {
        assert_eq!(escape_glob("model-1"), "model-1");
        assert_eq!(escape_glob("*"), "\\*");
        assert_eq!(escape_glob("a?b[c]\\"), "a\\?b\\[c\\]\\\\");
    }

    #[test]
    fn a_taken_job_is_still_queued_to_callers_and_active() {
        // A worker took it but has not been granted memory: callers must not
        // start its time budget, and a second delivery must see it as taken.
        assert_eq!(external_status("starting"), "queued");
        assert!(is_active("starting"));
        assert!(!is_active("canceled"));
    }

    /// A storage stand-in that answers 503 to the first `failures` PUTs and
    /// 200 after, counting every attempt.
    async fn flaky_storage(failures: usize) -> (String, Arc<AtomicUsize>) {
        let attempts = Arc::new(AtomicUsize::new(0));
        let seen = attempts.clone();
        let app = axum::Router::new().route(
            "/upload",
            axum::routing::put(move || {
                let seen = seen.clone();
                async move {
                    if seen.fetch_add(1, Ordering::SeqCst) < failures {
                        axum::http::StatusCode::SERVICE_UNAVAILABLE
                    } else {
                        axum::http::StatusCode::OK
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{addr}/upload"), attempts)
    }

    fn glb() -> Vec<Output> {
        vec![Output {
            name: "glb".into(),
            content_type: "model/gltf-binary".into(),
            bytes: Bytes::from_static(b"glTF"),
        }]
    }

    const NO_WAIT: [Duration; 3] = [Duration::ZERO; 3];

    /// A store on the Redis in `REDIS_URL` (the local stack's), or `None` to
    /// skip: these pin behaviour that only Redis itself can show.
    async fn redis_store() -> Option<JobStore> {
        let url = std::env::var("REDIS_URL").ok().filter(|u| !u.is_empty())?;
        let conn = connect(&url).await.ok()?;
        Some(JobStore {
            conn,
            notifiers: Notifiers::default(),
        })
    }

    fn unique(name: &str) -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("test-{name}-{nanos}")
    }

    #[tokio::test]
    async fn one_create_window_per_job_id() {
        let Some(store) = redis_store().await else { return };
        let id = unique("claim");
        assert!(store.claim_create(&id).await);
        assert!(!store.claim_create(&id).await, "a second create waits it out");
        store.release_create(&id).await;
        assert!(store.claim_create(&id).await);
        store.release_create(&id).await;
    }

    #[tokio::test]
    async fn a_lambda_request_is_kept_until_its_job_ends() {
        let Some(store) = redis_store().await else { return };
        let id = unique("request");
        let body = json!({ "source": { "url": "https://storage.test/m.step" } });
        store.set_pending(&id, "thumbnail", HashMap::new(), None).await;
        store.put_request(&id, &body).await.unwrap();
        assert_eq!(store.read_request(&id).await, Some(body.clone()));
        assert_eq!(store.read_request(&id).await, Some(body), "a redelivery reads it too");
        store.set_error(&id, "thumbnail_failed", "x".into()).await;
        assert_eq!(store.read_request(&id).await, None);
    }

    #[tokio::test]
    async fn one_worker_claims_a_job_and_a_crashed_one_releases_it() {
        let Some(store) = redis_store().await else { return };
        let id = unique("lease");
        assert!(store.claim_lease(&id).await);
        assert!(!store.claim_lease(&id).await, "a second delivery is a no-op");
        let mut c = store.conn.clone();
        let _: () = c.del(lease_key(&id)).await.unwrap(); // the lease ran out
        assert!(store.claim_lease(&id).await, "a redelivery takes over");
    }

    #[tokio::test]
    async fn a_job_whose_worker_died_ends_as_worker_lost() {
        let Some(store) = redis_store().await else { return };
        let id = unique("lost");
        store.set_pending(&id, "thumbnail", HashMap::new(), None).await;
        store.set_status(&id, "running").await;
        let job = store.poll(&id, None).await.unwrap();
        assert_eq!(job["job"]["status"], "running", "its lease is live");

        let mut c = store.conn.clone();
        let _: () = c.del(lease_key(&id)).await.unwrap(); // no renewal came
        let job = store.poll(&id, None).await.unwrap();
        assert_eq!(job["job"]["status"], "failed");
        assert_eq!(job["job"]["error"]["code"], "WORKER_LOST");
    }

    #[tokio::test]
    async fn a_finish_never_overwrites_a_cancel() {
        let Some(store) = redis_store().await else { return };
        let id = unique("cancel");
        store.set_pending(&id, "thumbnail", HashMap::new(), None).await;
        store.set_status(&id, "running").await;
        store.cancel(&id).await;
        store.set_done(&id, Done { result: json!({}), stats: json!({}) }).await;
        store.set_error(&id, "thumbnail_failed", "late".into()).await;
        store.set_status(&id, "uploading").await;
        let job = store.poll(&id, None).await.unwrap();
        assert_eq!(job["job"]["status"], "canceled");
    }

    #[tokio::test]
    async fn a_cancel_fires_the_running_jobs_token() {
        let Some(store) = redis_store().await else { return };
        let id = unique("token");
        store.set_pending(&id, "thumbnail", HashMap::new(), None).await;
        let (fired_tx, fired_rx) = tokio::sync::oneshot::channel();
        let job = track(&id, async move {
            current_cancel().unwrap().cancelled().await;
            let _ = fired_tx.send(());
        });
        let running = tokio::spawn(job);
        tokio::task::yield_now().await;
        store.cancel(&id).await;
        tokio::time::timeout(Duration::from_secs(1), fired_rx).await.unwrap().unwrap();
        running.await.unwrap();
        assert!(!RUNNING.contains_key(&id), "an ended job is untracked");
    }

    #[tokio::test]
    async fn a_failed_upload_fails_the_job_and_parks_nothing() {
        let Some(store) = redis_store().await else { return };
        let (url, _) = flaky_storage(usize::MAX).await;
        let id = unique("upload");
        store
            .set_pending(&id, "thumbnail", HashMap::from([("glb".to_string(), url)]), None)
            .await;
        let done = Done { result: json!({}), stats: json!({}) };
        store.finish(&id, glb(), done, None).await;

        let job = store.poll(&id, None).await.unwrap();
        assert_eq!(job["job"]["status"], "failed");
        assert_eq!(job["job"]["error"]["code"], "UPLOAD_FAILED");
        let mut c = store.conn.clone();
        let parked: Vec<String> = c.keys(format!("asm:pending:{id}*")).await.unwrap();
        assert!(parked.is_empty());
        let rec = store.read(&id).await.unwrap();
        assert!(rec.upload_urls.is_none(), "an ended job keeps no signed URLs");
    }

    #[tokio::test]
    async fn an_upload_that_fails_twice_then_lands_succeeds() {
        let (url, attempts) = flaky_storage(2).await;
        let urls = HashMap::from([("glb".to_string(), url)]);
        assert_eq!(upload_all("job", &glb(), &urls, &NO_WAIT).await, Ok(()));
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn an_upload_still_failing_after_its_retries_is_an_error() {
        let (url, attempts) = flaky_storage(usize::MAX).await;
        let urls = HashMap::from([("glb".to_string(), url)]);
        let err = upload_all("job", &glb(), &urls, &NO_WAIT).await.unwrap_err();
        assert!(err.starts_with("output 'glb' upload failed"), "{err}");
        assert_eq!(attempts.load(Ordering::SeqCst), 4, "one try plus three retries");
    }

    #[tokio::test]
    async fn an_output_without_a_url_is_an_error_not_a_wait() {
        let err = upload_all("job", &glb(), &HashMap::new(), &NO_WAIT).await.unwrap_err();
        assert_eq!(err, "no upload URL for output 'glb'");
    }
}
