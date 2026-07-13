//! Carbon assembler service (Rust) — the CAD heavy-lifting hub. Action-based RPC
//! over HTTP/JSON, versioned under `/v1`, with one shared async job model:
//!
//!   POST /v1/convert | /v1/optimize | /v1/plan   → 202 { ok, job }   (create)
//!   GET  /v1/jobs/{id}?wait=N                     → 200 { ok, job }   (poll)
//!   POST /v1/jobs/{id}/cancel                     → 200 { ok, job }
//!   POST /v1/cache/invalidate                     → 200 { ok, cleared }
//!   GET  /v1                                      → discovery
//!   GET  /health                                  → liveness (unauth)
//!
//! Every heavy action creates a job (holding a concurrency slot) and the caller
//! long-polls one uniform job endpoint. Completion artifacts are late-mint
//! uploaded to signed URLs handed over on each poll. Wires the `converter` and
//! `planner` crates via `actions::*`.

mod actions;
mod cache;
mod config;
mod error;
mod http;
mod jobs;
mod progress;

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
use tokio::sync::Semaphore;
use tower_http::compression::{predicate::SizeAbove, CompressionLayer};

const VERSION: &str = "0.1.0";

// jemalloc on the Linux deploy target: the planner's blocking tasks allocate
// heavily from many threads (rayon sweeps + tokio workers); glibc malloc is the
// case it beats. Measured on macOS it LOSES (~+6% wall), so it stays Linux-only.
#[cfg(target_os = "linux")]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[derive(Clone)]
pub struct AppState {
    pub slots: Arc<Semaphore>,
    pub jobs: jobs::JobStore,
    pub cache: Arc<cache::ResultCache>,
    pub progress: progress::ProgressStore,
}

fn main() {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .max_blocking_threads(config::blocking_threads())
        .build()
        .expect("tokio runtime")
        .block_on(serve());
}

async fn serve() {
    let max = config::max_concurrency();
    let state = AppState {
        slots: Arc::new(Semaphore::new(max)),
        jobs: jobs::JobStore::from_env().await,
        cache: Arc::new(cache::ResultCache::new(config::cache_bytes())),
        progress: progress::ProgressStore::default(),
    };
    let slots = Arc::clone(&state.slots);
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1", get(discovery))
        .route("/v1/convert", post(create_convert))
        .route("/v1/optimize", post(create_optimize))
        .route("/v1/plan", post(create_plan))
        .route("/v1/jobs/:job_id", get(get_job))
        .route("/v1/jobs/:job_id/cancel", post(cancel_job))
        .route("/v1/cache/invalidate", post(cache_invalidate))
        // Negotiated response compression (zstd, gzip fallback). Content-encoding
        // is chosen from the request's `Accept-Encoding`, so the server never
        // sends an encoding the client didn't advertise — a caller bypasses it
        // entirely with `Accept-Encoding: identity`. Skip bodies under 1KB
        // (pointer-sized job envelopes) where a frame would cost more than it saves.
        .layer(CompressionLayer::new().compress_when(SizeAbove::new(1024)))
        .with_state(state);

    eprintln!(
        "assembler config: version={VERSION} concurrency={max} cacheMB={} maxParts={} maxSourceMB={} longPollCap={}s jobTtl={}s resultTtl={}s",
        config::cache_bytes() / 1024 / 1024,
        config::max_parts(),
        config::max_source_bytes() / 1024 / 1024,
        config::max_long_poll_secs(),
        config::job_ttl_secs(),
        config::result_ttl_secs(),
    );

    let addr = std::env::var("ASSEMBLER_BIND").unwrap_or_else(|_| "0.0.0.0:8000".into());
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    eprintln!("assembler (rust) listening on {addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();

    // Jobs run detached (create returns 202) and each holds a slot; wait for
    // every slot to free before exiting so a deploy/scale-down doesn't kill an
    // in-flight job. The grace deadline in shutdown_signal force-exits a wedged one.
    eprintln!("assembler draining in-flight jobs");
    let _ = slots.acquire_many(max as u32).await;
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
        std::process::exit(0);
    });
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "version": VERSION }))
}

async fn discovery(headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    Ok(Json(json!({
        "version": VERSION,
        "actions": ["convert", "optimize", "plan"],
        "limits": {
            "maxParts": config::max_parts(),
            "maxSourceMB": config::max_source_bytes() / 1024 / 1024,
            "maxLongPollSecs": config::max_long_poll_secs(),
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

async fn create_convert(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, HeaderMap, Json<Value>), ApiError> {
    require_auth(&headers)?;
    let req = parse_body(body)?;

    let source_url = req["source"]["url"]
        .as_str()
        .ok_or_else(|| ApiError::invalid("missing source.url"))?;
    config::validate_url(source_url)?;
    let job_id = resolve_job_id(&headers);

    if let Some(status) = state.jobs.existing_active(&job_id).await {
        return Ok(created(&job_id, "convert", &status));
    }

    let declared_hash = req["source"]["contentHash"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .map(str::to_string);
    let meta = optional_meta(&req);
    state.jobs.set_pending(&job_id, "convert", meta).await;
    eprintln!("[{job_id}] convert queued");
    actions::convert::spawn(
        &state,
        &job_id,
        actions::convert::ConvertReq {
            source_url: source_url.to_string(),
            declared_hash,
            glb_path: req["outputs"]["glb"]["path"].as_str().map(str::to_string),
            graph_path: req["outputs"]["graph"]["path"].as_str().map(str::to_string),
            lin: req["options"]["linearDeflection"].as_f64().unwrap_or(0.1),
            ang: req["options"]["angularDeflection"].as_f64().unwrap_or(0.5),
            optimize: req["options"]["optimize"].as_bool().unwrap_or(true),
        },
    );
    Ok(created(&job_id, "convert", "queued"))
}

async fn create_optimize(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, HeaderMap, Json<Value>), ApiError> {
    require_auth(&headers)?;
    let req = parse_body(body)?;

    let source_url = req["source"]["url"]
        .as_str()
        .ok_or_else(|| ApiError::invalid("missing source.url"))?;
    config::validate_url(source_url)?;
    let job_id = resolve_job_id(&headers);

    if let Some(status) = state.jobs.existing_active(&job_id).await {
        return Ok(created(&job_id, "optimize", &status));
    }

    let o = &req["options"];
    let opts = actions::optimize::Opts {
        codec: o["codec"]
            .as_str()
            .and_then(optimize::Codec::from_str_opt)
            .unwrap_or_default(),
        ladder: parse_ladder(o),
        simplify_aggressive: o["simplifyAggressive"].as_bool().unwrap_or(false),
        weld: o["weld"].as_bool().unwrap_or(true),
        reorder: o["reorder"].as_bool().unwrap_or(true),
        // The quality/perf knob: max simplify deviation in mm. Absent = ratio-only.
        tolerance: o["tolerance"].as_f64().map(|f| f as f32),
        // Auto mode by default (scale-invariant, per-mesh adaptive); `autoError: 0`
        // disables it for a lossless optimise (weld/reorder/encode only).
        auto_error: Some(
            o["autoError"]
                .as_f64()
                .unwrap_or(optimize::DEFAULT_AUTO_ERROR as f64) as f32,
        )
        .filter(|&e| e > 0.0),
        // Draco quantization bits (position, normal, texcoord) — Draco codec only.
        draco_bits: (
            o["dracoPositionBits"].as_i64().unwrap_or(14) as i32,
            o["dracoNormalBits"].as_i64().unwrap_or(10) as i32,
            o["dracoTexcoordBits"].as_i64().unwrap_or(12) as i32,
        ),
        // Quantize normals to i16 (none/meshopt); default on for optimise.
        quantize_normals: o["quantizeNormals"].as_bool().unwrap_or(true),
        max_packed: o["maxPackedBytes"].as_u64().unwrap_or(419_430_400) as usize,
        max_output: o["maxOutputBytes"].as_u64().unwrap_or(125_829_120) as usize,
        lin: o["linearDeflection"].as_f64().unwrap_or(0.1),
        ang: o["angularDeflection"].as_f64().unwrap_or(0.5),
    };
    let format = req["source"]["format"].as_str().unwrap_or("glb").to_string();

    let meta = optional_meta(&req);
    state.jobs.set_pending(&job_id, "optimize", meta).await;
    eprintln!("[{job_id}] optimize queued (format={format})");
    actions::optimize::spawn(
        &state,
        &job_id,
        actions::optimize::OptimizeReq {
            source_url: source_url.to_string(),
            format,
            glb_path: req["outputs"]["glb"]["path"].as_str().map(str::to_string),
            opts,
        },
    );
    Ok(created(&job_id, "optimize", "queued"))
}

/// The simplify ladder: `options.ladder` (array of number|null) if present, else
/// a single rung from `options.simplify`, else `[null]` (full fidelity).
fn parse_ladder(options: &Value) -> Vec<Option<f32>> {
    if let Some(arr) = options["ladder"].as_array() {
        return arr.iter().map(|v| v.as_f64().map(|f| f as f32)).collect();
    }
    match options["simplify"].as_f64() {
        Some(f) => vec![Some(f as f32)],
        None => vec![None],
    }
}

async fn create_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, HeaderMap, Json<Value>), ApiError> {
    require_auth(&headers)?;
    let req = parse_body(body)?;

    let source_url = req["source"]["url"]
        .as_str()
        .ok_or_else(|| ApiError::invalid("missing source.url"))?;
    config::validate_url(source_url)?;
    let job_id = resolve_job_id(&headers);

    if let Some(status) = state.jobs.existing_active(&job_id).await {
        return Ok(created(&job_id, "plan", &status));
    }

    let meta = optional_meta(&req);
    let plan_path = meta
        .as_ref()
        .and_then(|m| m["planPath"].as_str())
        .map(str::to_string);
    let model_upload_id = meta
        .as_ref()
        .and_then(|m| m["modelUploadId"].as_str())
        .map(str::to_string);

    state.jobs.set_pending(&job_id, "plan", meta).await;
    eprintln!(
        "[{job_id}] plan queued (model={})",
        model_upload_id.as_deref().unwrap_or("?")
    );
    actions::plan::spawn(
        &state,
        &job_id,
        actions::plan::PlanReq {
            source_url: source_url.to_string(),
            plan_path,
            model_upload_id,
            options: req["options"].clone(),
        },
    );
    Ok(created(&job_id, "plan", "queued"))
}

fn optional_meta(req: &Value) -> Option<Value> {
    match &req["meta"] {
        Value::Null => None,
        m => Some(m.clone()),
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
    // Late-mint offload: the caller hands FRESH signed upload URLs on each poll
    // (one per pending output, keyed by output name), so the service PUTs the
    // finished artifacts with tokens minted seconds ago. Absent for callers that
    // don't offload.
    let upload_urls = parse_upload_urls(&headers)?;
    let max = match q.wait {
        Some(secs) if secs > 0 => Some(std::time::Duration::from_secs(
            secs.min(config::max_long_poll_secs()),
        )),
        _ => None,
    };
    let mut v = state
        .jobs
        .poll(&job_id, &upload_urls, max)
        .await
        .ok_or_else(|| ApiError::new(404, "NOT_FOUND", format!("no job {job_id}")))?;
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

/// Parse fresh per-poll signed upload URLs. Preferred: the
/// `X-Carbon-Upload-Urls` JSON header `{"glb":"…","graph":"…"}`. Also accepts the
/// single-output legacy `X-Plan-Upload-Url` (→ `{"plan": …}`).
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
    if let Some(url) = headers
        .get("x-plan-upload-url")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
    {
        config::validate_url(url)?;
        out.insert("plan".into(), url.to_string());
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
        .ok_or_else(|| ApiError::new(404, "NOT_FOUND", format!("no job {job_id}")))
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
