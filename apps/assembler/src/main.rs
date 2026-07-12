//! Carbon assembler service (Rust) — axum HTTP server: GET /health,
//! POST /convert (STEP -> GLB + assembly graph), POST /plan (202 async,
//! collision-free disassembly motion planning) + GET /plan/{jobId}. Wires the
//! `converter` and `planner` crates.

mod cache;
mod config;
mod error;
mod http;
mod plan_jobs;
mod progress;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use error::ApiError;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Semaphore;

const VERSION: &str = "0.1.0";

// jemalloc on the Linux deploy target: the planner's blocking tasks allocate
// heavily from many threads (rayon sweeps + tokio workers); glibc malloc is the
// case it beats. Measured on macOS it LOSES (~+6% wall), so it stays Linux-only.
#[cfg(target_os = "linux")]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[derive(Clone)]
struct AppState {
    slots: Arc<Semaphore>,
    jobs: plan_jobs::JobStore,
    cache: Arc<cache::ResultCache>,
    progress: progress::ProgressStore,
}

fn main() {
    // Manual runtime: cap the blocking pool at ~cores so converts queue inside
    // tokio instead of oversubscribing OCCT threads (async workers stay default
    // = cores, they only do I/O).
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .max_blocking_threads(config::blocking_threads())
        .build()
        .expect("tokio runtime")
        .block_on(serve());
}

async fn serve() {
    // Throughput vs latency is picked by env, not code:
    //   ASSEMBLER_MESH_PARALLEL=0 + ASSEMBLER_SEQUENTIAL=1 + max_concurrency=cores
    // runs each request single-threaded on its own worker (N concurrent requests
    // = N cores, no oversubscription). The defaults keep each request all-core
    // for lowest single-request latency (CLI / low-concurrency use).
    let max = config::max_concurrency();
    let state = AppState {
        slots: Arc::new(Semaphore::new(max)),
        jobs: plan_jobs::JobStore::from_env().await,
        cache: Arc::new(cache::ResultCache::new(config::cache_bytes())),
        progress: progress::ProgressStore::default(),
    };
    let slots = Arc::clone(&state.slots);
    let app = Router::new()
        .route("/health", get(health))
        .route("/convert", post(convert))
        .route("/convert/status/:job_id", get(convert_status))
        .route("/plan", post(plan))
        .route("/plan/:job_id", get(plan_status))
        .route("/cache/invalidate", post(cache_invalidate))
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

    // The listener has stopped and in-flight HTTP requests have drained (convert
    // is request-bound). Plan jobs run detached (POST /plan returns 202) and
    // each holds a slot, so wait for every slot to free — no permits held means
    // no plan is still running — before exiting, so a deploy/scale-down doesn't
    // kill a plan mid-flight. The grace deadline armed in shutdown_signal
    // force-exits if a wedged job overruns, so shutdown can't hang forever.
    eprintln!("assembler draining in-flight plan jobs");
    let _ = slots.acquire_many(max as u32).await;
    eprintln!("assembler drained cleanly; exiting");
}

/// Resolves on SIGTERM (container stop) or SIGINT (Ctrl-C), then arms a hard
/// deadline: if the graceful drain isn't done within ASSEMBLER_SHUTDOWN_GRACE_S,
/// the process force-exits — we stop on our own terms rather than waiting for
/// the orchestrator's SIGKILL.
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
    Json(json!({"ok": true, "version": VERSION}))
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

/// Read at most `cap` bytes from the head of a file, lossy-decoded.
fn read_head_lossy(path: &str, cap: usize) -> Result<String, converter::convert::ConvertError> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| {
        converter::convert::ConvertError::new("READ_FAILED", format!("read temp: {e}"))
    })?;
    let mut buf = Vec::new();
    file.take(cap as u64).read_to_end(&mut buf).map_err(|e| {
        converter::convert::ConvertError::new("READ_FAILED", format!("read temp: {e}"))
    })?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
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

async fn convert(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    let Json(req) = body.map_err(|_| ApiError::invalid("invalid JSON body"))?;

    let source_url = req["source"]["url"]
        .as_str()
        .ok_or_else(|| ApiError::invalid("missing source.url"))?;
    let glb_url = req["outputs"]["glb"]["url"]
        .as_str()
        .ok_or_else(|| ApiError::invalid("missing outputs.glb.url"))?;
    let graph_url = req["outputs"]["graph"]["url"]
        .as_str()
        .ok_or_else(|| ApiError::invalid("missing outputs.graph.url"))?;
    for url in [source_url, glb_url, graph_url] {
        config::validate_url(url)?;
    }
    let job_id = req["jobId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::invalid("missing jobId"))?
        .to_string();
    let lin = req["options"]["linearDeflection"].as_f64().unwrap_or(0.1);
    let ang = req["options"]["angularDeflection"].as_f64().unwrap_or(0.5);

    // No slot gate: OCCT reads scale across threads (thread_local allocator
    // patch) and the bounded blocking pool is the queue — overload waits, never
    // 429s. spawn_blocking, not inline: the sync OCCT call would pin an async
    // worker for its full duration (measured at c=64: /health p99 7ms -> 296ms
    // inline, and real files convert in 30-60s). One blocking hop does file
    // read + cache lookup + convert; DashMap ops are sync, never held across
    // an await.
    let started = std::time::Instant::now();
    // Live phase tracking for GET /convert/status/{jobId}; the guard removes
    // the entry when this request ends either way.
    let tracker = state.progress.start(&job_id);

    // Caller-declared content identity (storage etag): a hit here skips the
    // source download entirely.
    let declared = req["source"]["contentHash"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .map(str::to_string);
    if let Some(h) = &declared {
        let key = cache::ResultCache::key_declared(h, lin, ang);
        if let Some(entry) = state.cache.get(&key) {
            tracker.progress.set_phase(progress::PHASE_UPLOAD);
            return respond_convert(&job_id, entry, true, glb_url, graph_url, started).await;
        }
    }

    let tmp = http::temp_path("step");
    // Hash rides the download stream; a cache hit never touches the blocking
    // pool — it goes straight to the uploads.
    let content_hash =
        http::download_hashed(source_url, &tmp, Some(&tracker.progress)).await?;
    tracker.progress.set_phase(progress::PHASE_CONVERT);
    // Declared key when given (so the next declared lookup hits pre-download);
    // computed byte-hash key otherwise.
    let key = match &declared {
        Some(h) => cache::ResultCache::key_declared(h, lin, ang),
        None => cache::ResultCache::key(content_hash, lin, ang),
    };
    let hit = state.cache.get(&key);
    let was_hit = hit.is_some();
    let entry = match hit {
        Some(entry) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            entry
        }
        None => {
            let tmp_str = tmp.to_string_lossy().to_string();
            let cache = Arc::clone(&state.cache);
            tokio::task::spawn_blocking(move || {
                // Unit detection scans at most the first 32MB (its own cap) —
                // never load the full source into RAM.
                let text = read_head_lossy(&tmp_str, 32 * 1024 * 1024)?;
                let out =
                    converter::convert::convert_step(&tmp_str, &text, lin, ang).map(|conv| {
                        let entry = Arc::new(cache::CachedConvert {
                            glb: conv.glb.into(),
                            graph_bytes: serde_json::to_vec(&conv.graph).unwrap().into(),
                            component_count: conv.component_count,
                            triangles: conv.triangles,
                            unit: conv.graph["unit"].clone(),
                        });
                        cache.insert(key, Arc::clone(&entry));
                        entry
                    });
                let _ = std::fs::remove_file(&tmp_str);
                out
            })
            .await
            .map_err(|e| {
                ApiError::new(500, "TESSELLATION_FAILED", format!("convert panicked: {e}"))
            })?
            .map_err(ApiError::from)?
        }
    };

    tracker.progress.set_phase(progress::PHASE_UPLOAD);
    respond_convert(&job_id, entry, was_hit, glb_url, graph_url, started).await
}

async fn convert_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    match state.progress.get(&job_id) {
        Some(p) => {
            let (phase, done, total) = p.snapshot();
            Ok(Json(
                json!({"ok": true, "jobId": job_id, "phase": phase, "done": done, "total": total}),
            ))
        }
        None => Err(ApiError::new(
            404,
            "NOT_FOUND",
            format!("no in-flight convert {job_id}"),
        )),
    }
}

/// Limit check + concurrent artifact PUTs + response — shared by the
/// pre-download declared-hash hit and the normal path.
async fn respond_convert(
    job_id: &str,
    entry: Arc<cache::CachedConvert>,
    was_hit: bool,
    glb_url: &str,
    graph_url: &str,
    started: std::time::Instant,
) -> Result<Json<Value>, ApiError> {
    let mp = config::max_parts();
    if entry.component_count > mp as i64 {
        return Err(ApiError::new(
            413,
            "LIMIT_EXCEEDED",
            format!(
                "assembly has {} part instances; the limit is {mp}",
                entry.component_count
            ),
        ));
    }

    // Independent PUTs — run them concurrently.
    let (glb_res, graph_res) = tokio::join!(
        http::upload(glb_url, entry.glb.clone(), "model/gltf-binary"),
        http::upload(graph_url, entry.graph_bytes.clone(), "application/json"),
    );
    glb_res?;
    graph_res?;

    let convert_ms = started.elapsed().as_millis() as i64;
    eprintln!(
        "[{job_id}] convert done: {} parts, {} triangles, {convert_ms}ms{}",
        entry.component_count,
        entry.triangles,
        if was_hit { " (cache hit)" } else { "" }
    );
    Ok(Json(json!({
        "ok": true,
        "componentCount": entry.component_count,
        "unit": entry.unit,
        "stats": {"convertMs": convert_ms, "meshTriangles": entry.triangles, "warnings": []},
    })))
}

async fn plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    require_auth(&headers)?;
    let Json(req) = body.map_err(|_| ApiError::invalid("invalid JSON body"))?;
    let source_url = req["source"]["url"]
        .as_str()
        .ok_or_else(|| ApiError::invalid("missing source.url"))?;
    config::validate_url(source_url)?;
    let job_id = req["jobId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::invalid("missing jobId"))?
        .to_string();

    // Opaque caller context echoed back in status responses; the storage path +
    // model id inside it also drive the completion pointer and the content-hash
    // result cache.
    let meta = match &req["meta"] {
        Value::Null => None,
        m => Some(m.clone()),
    };
    let plan_path = meta
        .as_ref()
        .and_then(|m| m["planPath"].as_str())
        .map(str::to_string);
    let model_upload_id = meta
        .as_ref()
        .and_then(|m| m["modelUploadId"].as_str())
        .map(str::to_string);

    // Idempotent: attach to an in-flight run rather than starting a second.
    if let Some(status) = state.jobs.existing_active(&job_id).await {
        return Ok((
            axum::http::StatusCode::ACCEPTED,
            Json(json!({"ok": true, "jobId": job_id, "status": status})),
        ));
    }
    eprintln!(
        "[{job_id}] plan queued (model={})",
        model_upload_id.as_deref().unwrap_or("?")
    );
    state.jobs.set_pending(&job_id, meta.clone()).await;
    state.jobs.spawn(
        &state,
        &job_id,
        plan_jobs::PlanReq {
            source_url: source_url.to_string(),
            plan_path,
            model_upload_id,
            options: req["options"].clone(),
        },
    );

    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(json!({"ok": true, "jobId": job_id, "status": "pending"})),
    ))
}

#[derive(serde::Deserialize)]
struct WaitQuery {
    /// Long-poll hold in seconds; server-capped. Absent => return immediately.
    wait: Option<u64>,
}

async fn plan_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
    Query(q): Query<WaitQuery>,
) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    // Late-mint offload: the app hands a FRESH signed upload URL on each poll, so
    // the service PUTs the finished plan.json the instant it's ready with a token
    // minted seconds ago (no long-lived URL). Absent for non-offload callers.
    let upload_url = headers
        .get("x-plan-upload-url")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if let Some(u) = &upload_url {
        config::validate_url(u)?;
    }
    let max = match q.wait {
        Some(secs) if secs > 0 => Some(std::time::Duration::from_secs(
            secs.min(config::max_long_poll_secs()),
        )),
        _ => None,
    };
    state
        .jobs
        .poll(&job_id, upload_url.as_deref(), max)
        .await
        .ok_or_else(|| ApiError::new(404, "NOT_FOUND", format!("no plan job {job_id}")))
        .map(Json)
}

/// Central explicit cache invalidation: drop every content-hash result pointer
/// for a model so the next plan re-derives. Best-effort from the app's
/// invalidateAssemblyPlanCache / invalidateAssemblyModelCache.
async fn cache_invalidate(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    let Json(req) = body.map_err(|_| ApiError::invalid("invalid JSON body"))?;
    let model = req["modelUploadId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::invalid("missing modelUploadId"))?;
    let cleared = state.jobs.invalidate_model(model).await;
    eprintln!("cache invalidate: model={model} cleared={cleared}");
    Ok(Json(json!({"ok": true, "cleared": cleared})))
}
