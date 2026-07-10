//! Carbon geometry service (Rust) — axum HTTP server matching the wire contract
//! of `services/geometry/app/main.py`: GET /health, POST /convert, POST /plan
//! (202 async) + GET /plan/{jobId}. Wires the `converter` and `planner` crates.

mod config;
mod error;
mod http;
mod plan_jobs;

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

#[derive(Clone)]
struct AppState {
    slots: Arc<Semaphore>,
    jobs: plan_jobs::JobStore,
}

#[tokio::main]
async fn main() {
    let state = AppState {
        slots: Arc::new(Semaphore::new(config::max_concurrency())),
        jobs: plan_jobs::JobStore::default(),
    };
    let app = Router::new()
        .route("/health", get(health))
        .route("/convert", post(convert))
        .route("/plan", post(plan))
        .route("/plan/:job_id", get(plan_status))
        .with_state(state);

    let addr = std::env::var("GEOMETRY_BIND").unwrap_or_else(|_| "0.0.0.0:8000".into());
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    eprintln!("carbon-geometry (rust) listening on {addr}");
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> Json<Value> {
    Json(json!({"ok": true, "version": VERSION}))
}

fn require_auth(headers: &HeaderMap) -> Result<(), ApiError> {
    let api_key = std::env::var("GEOMETRY_SERVICE_API_KEY").ok().filter(|s| !s.is_empty());
    match api_key {
        None => {
            if std::env::var("GEOMETRY_DEV_MODE").as_deref() == Ok("true") {
                Ok(())
            } else {
                Err(ApiError::unauthorized("GEOMETRY_SERVICE_API_KEY is not configured"))
            }
        }
        Some(key) => {
            let auth = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("");
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

async fn convert(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    let Json(req) = body.map_err(|_| ApiError::invalid("invalid JSON body"))?;

    let source_url = req["source"]["url"].as_str().ok_or_else(|| ApiError::invalid("missing source.url"))?;
    let glb_url = req["outputs"]["glb"]["url"].as_str().ok_or_else(|| ApiError::invalid("missing outputs.glb.url"))?;
    let graph_url = req["outputs"]["graph"]["url"].as_str().ok_or_else(|| ApiError::invalid("missing outputs.graph.url"))?;
    for url in [source_url, glb_url, graph_url] {
        config::validate_url(url)?;
    }
    let job_id = req["jobId"].as_str().unwrap_or("unknown").to_string();
    let lin = req["options"]["linearDeflection"].as_f64().unwrap_or(0.1);
    let ang = req["options"]["angularDeflection"].as_f64().unwrap_or(0.5);

    let _permit = state.slots.try_acquire().map_err(|_| ApiError::busy())?;

    let started = std::time::Instant::now();
    let tmp = http::temp_path("step");
    http::download(source_url, &tmp).await?;
    let text = tokio::fs::read_to_string(&tmp).await.unwrap_or_default();
    let tmp_str = tmp.to_string_lossy().to_string();

    let conv = tokio::task::spawn_blocking(move || {
        converter::convert::convert_step(&tmp_str, &text, lin, ang)
    })
    .await
    .map_err(|e| ApiError::new(500, "TESSELLATION_FAILED", format!("convert panicked: {e}")))?
    .map_err(ApiError::from)?;
    let _ = tokio::fs::remove_file(&tmp).await;

    let mp = config::max_parts();
    if conv.component_count > mp as i64 {
        return Err(ApiError::new(413, "LIMIT_EXCEEDED", format!(
            "assembly has {} part instances; the limit is {mp}", conv.component_count
        )));
    }

    http::upload(glb_url, conv.glb.clone(), "model/gltf-binary").await?;
    http::upload(graph_url, serde_json::to_vec(&conv.graph).unwrap(), "application/json").await?;

    let convert_ms = started.elapsed().as_millis() as i64;
    eprintln!("[{job_id}] convert done: {} parts, {} triangles, {convert_ms}ms", conv.component_count, conv.triangles);
    Ok(Json(json!({
        "ok": true,
        "componentCount": conv.component_count,
        "unit": conv.graph["unit"],
        "stats": {"convertMs": convert_ms, "meshTriangles": conv.triangles, "warnings": []},
    })))
}

async fn plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    require_auth(&headers)?;
    let Json(req) = body.map_err(|_| ApiError::invalid("invalid JSON body"))?;
    let source_url = req["source"]["url"].as_str().ok_or_else(|| ApiError::invalid("missing source.url"))?;
    config::validate_url(source_url)?;
    let job_id = req["jobId"].as_str().unwrap_or("unknown").to_string();

    // Idempotent: attach to an in-flight run rather than starting a second.
    if let Some(status) = state.jobs.existing_active(&job_id) {
        return Ok((axum::http::StatusCode::ACCEPTED, Json(json!({"ok": true, "jobId": job_id, "status": status}))));
    }
    state.jobs.set_pending(&job_id);
    state.jobs.spawn(&state, &job_id, source_url.to_string(), req["options"].clone());

    Ok((axum::http::StatusCode::ACCEPTED, Json(json!({"ok": true, "jobId": job_id, "status": "pending"}))))
}

async fn plan_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_auth(&headers)?;
    state.jobs.status(&job_id).ok_or_else(|| ApiError::new(404, "NOT_FOUND", format!("no plan job {job_id}"))).map(Json)
}
