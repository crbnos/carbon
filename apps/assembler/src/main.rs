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
    extract::{Path, State},
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
    let state = AppState {
        slots: Arc::new(Semaphore::new(config::max_concurrency())),
        jobs: plan_jobs::JobStore::default(),
        cache: Arc::new(cache::ResultCache::new(config::cache_bytes())),
        progress: progress::ProgressStore::default(),
    };
    let app = Router::new()
        .route("/health", get(health))
        .route("/convert", post(convert))
        .route("/convert/status/:job_id", get(convert_status))
        .route("/plan", post(plan))
        .route("/plan/:job_id", get(plan_status))
        .with_state(state);

    let addr = std::env::var("ASSEMBLER_BIND").unwrap_or_else(|_| "0.0.0.0:8000".into());
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    eprintln!("assembler (rust) listening on {addr}");
    axum::serve(listener, app).await.unwrap();
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
    let job_id = req["jobId"].as_str().unwrap_or("unknown").to_string();
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
    // Optional signed PUT for plan.json (mirrors /convert's outputs) — when
    // present the service uploads the plan instead of returning it by value.
    let plan_url = match req["outputs"]["plan"]["url"].as_str() {
        Some(u) => {
            config::validate_url(u)?;
            Some(u.to_string())
        }
        None => None,
    };
    let job_id = req["jobId"].as_str().unwrap_or("unknown").to_string();

    // Idempotent: attach to an in-flight run rather than starting a second.
    if let Some(status) = state.jobs.existing_active(&job_id) {
        return Ok((
            axum::http::StatusCode::ACCEPTED,
            Json(json!({"ok": true, "jobId": job_id, "status": status})),
        ));
    }
    // Opaque caller context echoed back in the completion event + status
    // responses (keeps event consumers self-contained; no server semantics).
    let meta = match &req["meta"] {
        Value::Null => None,
        m => Some(m.clone()),
    };
    state.jobs.set_pending(&job_id, meta);
    state.jobs.spawn(
        &state,
        &job_id,
        source_url.to_string(),
        plan_url,
        req["options"].clone(),
    );

    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(json!({"ok": true, "jobId": job_id, "status": "pending"})),
    ))
}

async fn plan_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    state
        .jobs
        .status(&job_id)
        .ok_or_else(|| ApiError::new(404, "NOT_FOUND", format!("no plan job {job_id}")))
        .map(Json)
}
