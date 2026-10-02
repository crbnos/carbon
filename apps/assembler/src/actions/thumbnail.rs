// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! `thumbnail` action — a model's GLB → a square PNG preview, rendered on the
//! CPU by `crates/thumbnail` (no GPU, no browser). The source is a GLB this
//! service wrote: the optimised one (`EXT_meshopt_compression`) or the lossless
//! `convert` output. Async job; the single `thumbnail` output is late-mint
//! uploaded.

use crate::jobs::{Done, Output};
use crate::{http, AppState};
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;

pub struct ThumbnailReq {
    pub source_url: String,
    /// Side of the square image in pixels (clamped by the renderer).
    pub size: u32,
    /// Storage path recorded in the completion pointer; the signed PUT URL is
    /// late-minted per poll, key `thumbnail`.
    pub path: Option<String>,
}

pub fn spawn(state: &AppState, job_id: &str, req: ThumbnailReq) {
    let jobs = state.jobs.clone();
    let slots = Arc::clone(&state.slots);
    let job_id = job_id.to_string();
    tokio::spawn(async move {
        let _permit = slots.acquire().await;
        if jobs.is_canceled(&job_id).await {
            return;
        }
        jobs.set_status(&job_id, "running").await;
        eprintln!("[{job_id}] thumbnail running");
        let started = Instant::now();

        let src = http::temp_path("glb");
        if let Err(e) = http::download_hashed(&req.source_url, &src, None).await {
            let _ = tokio::fs::remove_file(&src).await;
            eprintln!("[{job_id}] thumbnail failed: source download: {}", e.message);
            jobs.set_error(&job_id, &e.code, e.message).await;
            return;
        }
        let src_str = src.to_string_lossy().to_string();
        let size = req.size;

        let res = tokio::task::spawn_blocking(move || render(&src_str, size)).await;
        let _ = tokio::fs::remove_file(&src).await;

        let png = match res {
            Ok(Ok(png)) => png,
            Ok(Err(message)) => {
                eprintln!("[{job_id}] thumbnail failed: {message}");
                jobs.set_error(&job_id, "thumbnail_failed", message).await;
                return;
            }
            Err(e) => {
                let msg = format!("thumbnail panicked: {e}");
                eprintln!("[{job_id}] {msg}");
                jobs.set_error(&job_id, "thumbnail_failed", msg).await;
                return;
            }
        };

        let thumbnail_ms = started.elapsed().as_millis() as i64;
        eprintln!(
            "[{job_id}] thumbnail done: {} bytes, {thumbnail_ms}ms",
            png.len()
        );

        let done = Done {
            result: json!({
                "outputs": { "thumbnail": { "path": req.path, "bytes": png.len() } },
            }),
            stats: json!({
                "outputBytes": png.len(),
                "thumbnailMs": thumbnail_ms,
            }),
        };
        let outputs = vec![Output {
            name: "thumbnail".into(),
            content_type: "image/png".into(),
            bytes: png,
        }];
        jobs.finish(&job_id, outputs, done, None).await;
    });
}

fn render(path: &str, size: u32) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    // SAFETY: the temp file is ours alone and outlives the map; nothing writes it.
    let glb = unsafe { memmap2::Mmap::map(&file) }.map_err(|e| format!("mmap {path}: {e}"))?;
    thumbnail::render_png(&glb, size).map_err(|e| e.0)
}
