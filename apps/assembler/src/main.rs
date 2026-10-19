// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Carbon assembler service (Rust) — the CAD heavy-lifting hub. Action-based RPC
//! over HTTP/JSON, versioned under `/v1`, with one shared async job model:
//!
//!   POST /v1/convert | /v1/optimize | /v1/plan | /v1/compact | /v1/thumbnail
//!                                                → 202 { ok, job }   (create, async)
//!   GET  /v1/jobs/{id}?wait=N                     → 200 { ok, job }   (poll)
//!   POST /v1/jobs/{id}/cancel                     → 200 { ok, job }
//!   POST /v1/cache/invalidate                     → 200 { ok, cleared }
//!   GET  /v1                                      → discovery
//!   GET  /health                                  → liveness (unauth)
//!
//! Every heavy action creates a job (holding a concurrency slot). Artifacts
//! upload via submit-time signed URLs and completion POSTs to a submit-time
//! callback URL; the poll endpoint remains for status. Wires the `converter` and `planner` crates via `actions::*`.

mod actions;
mod admission;
mod cache;
mod compute;
mod config;
mod dispatch;
mod error;
mod formats;
mod http;
mod jobs;
mod progress;
mod request;
mod source;
mod telemetry;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use error::ApiError;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tower_http::compression::{predicate::SizeAbove, CompressionLayer};

const VERSION: &str = "0.1.0";
/// How long the Lambda worker waits for its job: Lambda's own hard timeout.
const WORKER_MAX_WAIT: Duration = Duration::from_secs(900);

// jemalloc on the Linux deploy target: the planner's blocking tasks allocate
// heavily from many threads (rayon sweeps + tokio workers); glibc malloc is the
// case it beats. Measured on macOS it LOSES (~+6% wall), so it stays Linux-only.
#[cfg(target_os = "linux")]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

// Read by jemalloc at startup. A background thread purges freed pages after a
// second (and skips the lazy "muzzy" stage), so memory a finished job freed
// goes back to the OS instead of sitting in the allocator until the next job.
#[cfg(target_os = "linux")]
#[allow(non_upper_case_globals)]
#[export_name = "malloc_conf"]
pub static malloc_conf: &[u8] = b"background_thread:true,dirty_decay_ms:1000,muzzy_decay_ms:0\0";

#[derive(Clone)]
pub struct AppState {
    pub admission: admission::Admission,
    pub jobs: jobs::JobStore,
    pub cache: Arc<cache::ResultCache>,
    pub progress: progress::ProgressStore,
    pub sources: source::Sources,
}

fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .max_blocking_threads(config::blocking_threads())
        .build()
        .expect("tokio runtime");
    rt.block_on(serve());
}

/// Build the shared service state: one JobStore + cache + concurrency.
async fn build_state() -> AppState {
    AppState {
        admission: admission::Admission::from_env(),
        jobs: jobs::JobStore::from_env().await,
        cache: Arc::new(cache::ResultCache::new(
            config::cache_dir(),
            config::cache_bytes(),
        )),
        progress: progress::ProgressStore::default(),
        sources: source::Sources::new(config::source_slots()),
    }
}

async fn serve() {
    telemetry::init();
    http::clear_stale_sources();
    let state = build_state().await;
    let admission = state.admission.clone();
    // Renews the lease of every job this process runs, and relays cancels.
    let heartbeat = state.jobs.clone();
    tokio::spawn(async move { heartbeat.heartbeat().await });
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1", get(discovery))
        .route("/v1/:action", post(create_job))
        .route("/v1/jobs/:job_id", get(get_job))
        .route("/v1/jobs/:job_id/cancel", post(cancel_job))
        .route("/v1/cache/invalidate", post(cache_invalidate));
    // Lambda self-invoke worker inlet: the Web Adapter delivers non-HTTP
    // (Event) payloads here (AWS_LWA_PASS_THROUGH_PATH). Mounted only on
    // Lambda, where it is reachable only by an IAM-signed Invoke — API Gateway
    // routes /health and /v1/* alone. A spec names a job and nothing else, so
    // a delivery can only start a pending job with the body its create stored.
    let app = if dispatch::from_env() == dispatch::Dispatch::Lambda {
        app.route("/events", post(worker_events))
    } else {
        app
    };
    let app = app
        // Negotiated response compression (zstd, gzip fallback). Content-encoding
        // is chosen from the request's `Accept-Encoding`, so the server never
        // sends an encoding the client didn't advertise — a caller bypasses it
        // entirely with `Accept-Encoding: identity`. Skip bodies under 1KB
        // (pointer-sized job envelopes) where a frame would cost more than it saves.
        .layer(CompressionLayer::new().compress_when(SizeAbove::new(1024)))
        .layer(axum::middleware::from_fn(telemetry::http_span))
        .with_state(state);

    eprintln!(
        "assembler config: version={VERSION} memoryBudgetMB={} cacheMB={} maxParts={} maxSourceMB={} longPollCap={}s jobTtl={}s resultTtl={}s",
        admission.budget_mb(),
        config::cache_bytes() / 1024 / 1024,
        config::max_parts(),
        config::max_source_bytes() / 1024 / 1024,
        config::max_long_poll_secs(),
        config::job_ttl_secs(),
        config::result_ttl_secs(),
    );

    // Standard PORT convention — the Lambda Web Adapter reads the same variable.
    let port = std::env::var("PORT").unwrap_or_else(|_| "8000".into());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    eprintln!("assembler (rust) listening on {addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();

    // Jobs run detached (create returns 202) and each holds part of the memory
    // budget while it computes; wait for all of it to come back before exiting
    // so a deploy/scale-down doesn't kill an in-flight job. The grace deadline
    // in shutdown_signal force-exits a wedged one.
    eprintln!("assembler draining in-flight jobs");
    admission.drain().await;
    telemetry::shutdown();
    eprintln!("assembler drained cleanly; exiting");
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }

    let grace = config::shutdown_grace();
    eprintln!("assembler received shutdown signal; draining (grace {grace:?})");
    tokio::spawn(async move {
        tokio::time::sleep(grace).await;
        eprintln!("assembler shutdown grace elapsed; forcing exit");
        telemetry::shutdown();
        std::process::exit(0);
    });
}

/// Healthy means it can do its job, and it cannot without Redis: every job's
/// status lives there. A probe that fails here gets the instance replaced.
async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    if state.jobs.ping().await {
        return (StatusCode::OK, Json(json!({ "ok": true, "version": VERSION })));
    }
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({ "ok": false, "version": VERSION, "error": "redis unreachable" })),
    )
}

async fn discovery(headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    let input_formats: Vec<Value> = formats::ALL
        .iter()
        .map(|f| {
            json!({
                "format": f.name(),
                "loader": f.loader_name(),
                "exact": f.exact(),
                "structured": f.structured(),
            })
        })
        .collect();
    Ok(Json(json!({
        "version": VERSION,
        "actions": request::ACTIONS,
        "input_formats": input_formats,
        "codecs": ["meshopt", "draco", "none"],
        "limits": {
            "max_parts": config::max_parts(),
            "max_source_bytes": config::max_source_bytes(),
            "max_output_bytes": request::DEFAULT_MAX_OUTPUT_BYTES,
            "max_render_weight_bytes": request::DEFAULT_MAX_RENDER_WEIGHT_BYTES,
            "max_long_poll_secs": config::max_long_poll_secs(),
        },
    })))
}

fn require_auth(headers: &HeaderMap) -> Result<(), ApiError> {
    let api_key = std::env::var("ASSEMBLER_SERVICE_API_KEY")
        .ok()
        .filter(|s| !s.is_empty());
    match api_key {
        None => {
            if std::env::var("ASSEMBLER_DEV_MODE").as_deref() == Ok("true") {
                Ok(())
            } else {
                Err(ApiError::unauthorized(
                    "ASSEMBLER_SERVICE_API_KEY is not configured",
                ))
            }
        }
        Some(key) => {
            let auth = headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            let (scheme, token) = auth.split_once(' ').unwrap_or(("", ""));
            if scheme.eq_ignore_ascii_case("bearer") && constant_eq(token, &key) {
                Ok(())
            } else {
                Err(ApiError::unauthorized("Invalid or missing bearer token"))
            }
        }
    }
}

fn constant_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Resolve the job id: the caller's `Idempotency-Key` (so a re-POST attaches to
/// the running job), else a generated id.
fn resolve_job_id(headers: &HeaderMap) -> String {
    headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .map(str::to_string)
        .unwrap_or_else(gen_id)
}

fn gen_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("job_{}_{nanos}_{n}", std::process::id())
}


/// Submit-time completion plumbing: the caller's `callback_url` (body) and
/// upload URLs (X-Carbon-Upload-Urls header) are stored ON the job so it can
/// finalize + notify the moment compute ends — no poll on the happy path.
/// Both are caller-supplied URLs -> SSRF-validated like every other URL.
fn submit_plumbing(
    headers: &HeaderMap,
    req: &Value,
) -> Result<(HashMap<String, String>, Option<String>), ApiError> {
    let urls = parse_upload_urls(headers)?;
    let callback = match req["callback_url"].as_str().filter(|s| !s.is_empty()) {
        Some(u) => {
            config::validate_url(u)?;
            Some(u.to_string())
        }
        None => None,
    };
    Ok((urls, callback))
}

/// The uniform 202 create response: `{ ok, job }` + a `Location` to poll.
fn created(job_id: &str, action: &str, status: &str) -> (StatusCode, HeaderMap, Json<Value>) {
    let mut hm = HeaderMap::new();
    if let Ok(loc) = format!("/v1/jobs/{job_id}").parse() {
        hm.insert(header::LOCATION, loc);
    }
    (
        StatusCode::ACCEPTED,
        hm,
        Json(json!({ "ok": true, "job": { "id": job_id, "action": action, "status": status } })),
    )
}

fn parse_body(
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Value, ApiError> {
    body.map(|Json(v)| v)
        .map_err(|_| ApiError::invalid("invalid JSON body"))
}

/// Create a job for any action (`POST /v1/{action}`). The body is parsed and
/// validated before anything is recorded, so a bad request leaves no job.
/// A re-POST with the same `Idempotency-Key` attaches to the active job.
async fn create_job(
    State(state): State<AppState>,
    Path(action): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, HeaderMap, Json<Value>), ApiError> {
    require_auth(&headers)?;
    let req = parse_body(body)?;
    let parsed = request::parse(&action, &req)?;
    let job_id = resolve_job_id(&headers);
    let (upload_urls, callback_url) = submit_plumbing(&headers, &req)?;

    // Another create with this key is in its window: it will start the job.
    if !state.jobs.claim_create(&job_id).await {
        return Ok(created(&job_id, &action, "queued"));
    }
    let started = async {
        if let Some(status) = state.jobs.existing_active(&job_id).await {
            return Ok(status);
        }
        state
            .jobs
            .set_pending(&job_id, &action, upload_urls, callback_url)
            .await;
        if dispatch::from_env() == dispatch::Dispatch::Lambda {
            lambda_dispatch(&state, &job_id, &action, &req).await?;
        } else {
            eprintln!("[{job_id}] {action} queued");
            request::spawn(&state, &job_id, parsed);
        }
        Ok::<_, ApiError>("queued".to_string())
    }
    .await;
    state.jobs.release_create(&job_id).await;
    Ok(created(&job_id, &action, &started?))
}

/// Lambda-mode create path: instead of spawning in-process (this instance
/// freezes after the response), fire the job as an Event-type self-invocation.
/// The request body waits in Redis for the worker; the spec carries only
/// `action`, `job_id` and the trace, so no signed URL, caller token or service
/// key rides in the Invoke payload. A failed dispatch fails the job loudly
/// (never a forever-"pending" record).
async fn lambda_dispatch(
    state: &AppState,
    job_id: &str,
    action: &str,
    req: &Value,
) -> Result<(), ApiError> {
    let mut spec = json!({ "action": action, "job_id": job_id });
    telemetry::inject(&mut spec);
    let dispatched = match state.jobs.put_request(job_id, req).await {
        Ok(()) => dispatch::self_invoke(&spec).await,
        Err(m) => Err(m),
    };
    if let Err(m) = dispatched {
        state
            .jobs
            .set_error(job_id, "dispatch_failed", m.clone())
            .await;
        return Err(ApiError::new(503, "dispatch_failed", m));
    }
    eprintln!("[{job_id}] {action} dispatched to worker invocation");
    Ok(())
}

/// Worker inlet for the Lambda self-invoke (LWA pass-through). Runs the spec's
/// action to completion in THIS invocation — its own 900s window — uploading via
/// the submit-time URLs; state lives in the shared (Redis) JobStore so any
/// instance's poll can answer. A delivery runs the job when it can claim the
/// job's lease: a pending job, or one whose worker stopped renewing it (a
/// crashed or timed-out invocation Lambda redelivers). Otherwise it is a no-op.
async fn worker_events(
    State(state): State<AppState>,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let spec = parse_body(body)?;
    let action = spec["action"].as_str().unwrap_or_default().to_string();
    let job_id = spec["job_id"].as_str().unwrap_or_default().to_string();
    if job_id.is_empty() {
        return Err(ApiError::invalid("missing job_id"));
    }
    match state.jobs.internal_active(&job_id).await {
        Some(status) => {
            // The lease is the claim: of two deliveries one wins, and while a
            // live worker renews it every other delivery is a no-op.
            if !state.jobs.claim_lease(&job_id).await {
                eprintln!("[{job_id}] worker no-op (another worker holds it)");
                return Ok(Json(json!({ "ok": true, "noop": true })));
            }
            let Some(req) = state.jobs.read_request(&job_id).await else {
                let message = "the request expired before a worker took it".to_string();
                state.jobs.set_error(&job_id, "dispatch_failed", message.clone()).await;
                return Err(ApiError::new(410, "dispatch_failed", message));
            };
            if status != "pending" {
                eprintln!("[{job_id}] worker taking over a job left {status}");
            }
            // Mark it taken before the long download and admission wait.
            state.jobs.set_status(&job_id, "starting").await;
            if let Err(e) = spawn_traced(&state, &job_id, &action, &spec, &req) {
                state.jobs.set_error(&job_id, "invalid_input", e.message.clone()).await;
                return Err(e);
            }
            eprintln!("[{job_id}] worker running {action}");
        }
        None => {
            eprintln!("[{job_id}] worker no-op (job ended or unknown)");
            return Ok(Json(json!({ "ok": true, "noop": true })));
        }
    }

    let result = run_to_completion(&state, &job_id).await;
    // The worker invocation owns the Lambda lifetime: the action task's inline
    // callback send may be killed by the post-response freeze, so (re)send here
    // before returning. Duplicate deliveries are harmless — the receiver's
    // waitForEvent consumes the first matching event.
    state.jobs.send_callback(&job_id).await;
    eprintln!(
        "[{job_id}] worker finished: {}",
        result["job"]["status"].as_str().unwrap_or("?")
    );
    Ok(Json(result))
}

/// Parse and spawn the worker's job under the submitting request's trace, when
/// the spec carries it. Sync: the trace guard cannot be held across an await.
fn spawn_traced(
    state: &AppState,
    job_id: &str,
    action: &str,
    spec: &Value,
    req: &Value,
) -> Result<(), ApiError> {
    let _trace = telemetry::attach(spec);
    request::spawn(state, job_id, request::parse(action, req)?);
    Ok(())
}

/// Wait for a spawned job to reach a terminal state, or the worker's ceiling.
async fn run_to_completion(state: &AppState, job_id: &str) -> Value {
    let deadline = Instant::now() + WORKER_MAX_WAIT;
    loop {
        match state.jobs.poll(job_id, Some(Duration::from_secs(30))).await {
            None => {
                return json!({ "ok": false,
                    "error": { "code": "not_found", "message": "job vanished" } })
            }
            Some(v) => match v["job"]["status"].as_str() {
                Some("succeeded" | "failed" | "canceled") => return v,
                _ if Instant::now() >= deadline => return v,
                _ => continue,
            },
        }
    }
}

#[derive(serde::Deserialize)]
struct WaitQuery {
    /// Long-poll hold in seconds; server-capped. Absent => return immediately.
    wait: Option<u64>,
}

async fn get_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
    Query(q): Query<WaitQuery>,
) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    let max = match q.wait {
        Some(secs) if secs > 0 => Some(Duration::from_secs(secs.min(config::max_long_poll_secs()))),
        _ => None,
    };
    let mut v = state
        .jobs
        .poll(&job_id, max)
        .await
        .ok_or_else(|| ApiError::new(404, "not_found", format!("no job {job_id}")))?;
    // Best-effort live progress (same replica only): merge the convert phase
    // checklist while the job is running.
    if v["job"]["status"] == "running" {
        if let Some(p) = state.progress.get(&job_id) {
            let (phase, done, total) = p.snapshot();
            v["job"]["progress"] = json!({ "phase": phase, "done": done, "total": total });
        }
    }
    Ok(Json(v))
}

/// Parse the submit-time signed upload URLs: the `X-Carbon-Upload-Urls` JSON
/// header `{"glb":"…","graph":"…"}`.
fn parse_upload_urls(headers: &HeaderMap) -> Result<HashMap<String, String>, ApiError> {
    let mut out = HashMap::new();
    if let Some(raw) = headers
        .get("x-carbon-upload-urls")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
    {
        let map: HashMap<String, String> = serde_json::from_str(raw)
            .map_err(|_| ApiError::invalid("invalid X-Carbon-Upload-Urls header"))?;
        for (name, url) in map {
            config::validate_url(&url)?;
            out.insert(name, url);
        }
    }
    Ok(out)
}

async fn cancel_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    state
        .jobs
        .cancel(&job_id)
        .await
        .map(Json)
        .ok_or_else(|| ApiError::new(404, "not_found", format!("no job {job_id}")))
}

/// Central explicit cache invalidation: drop every content-hash result pointer
/// for a model so the next job re-derives.
async fn cache_invalidate(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    let req = parse_body(body)?;
    let model = req["modelUploadId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::invalid("missing modelUploadId"))?;
    let cleared = state.jobs.invalidate_model(model).await;
    eprintln!("cache invalidate: model={model} cleared={cleared}");
    Ok(Json(json!({ "ok": true, "cleared": cleared })))
}
