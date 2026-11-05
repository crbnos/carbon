// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! `thumbnail` action — a model's GLB → a square PNG preview, rendered on the
//! CPU by `crates/thumbnail` (no GPU, no browser). The source is a GLB this
//! service wrote: the optimised one (`EXT_meshopt_compression`) or the lossless
//! `convert` output. Async job; the single `thumbnail` output is uploaded to
//! its submit-time URL.

use crate::jobs::{Done, Output};
use crate::{admission, compute, http, telemetry, AppState};
use serde_json::json;
use std::time::Instant;

pub struct ThumbnailReq {
    pub source_url: String,
    /// Side of the square image in pixels (clamped by the renderer).
    pub size: u32,
    /// Where the camera stands: model towards camera, Z up. The viewer's home
    /// direction unless the caller captured another.
    pub direction: [f32; 3],
    /// Storage path recorded in the completion pointer; the signed PUT URL
    /// comes with the submit, key `thumbnail`.
    pub path: Option<String>,
}

pub fn spawn(state: &AppState, job_id: &str, req: ThumbnailReq) {
    let jobs = state.jobs.clone();
    let admission = state.admission.clone();
    let sources = state.sources.clone();
    let job_id = job_id.to_string();
    telemetry::spawn_job(&job_id.clone(), "thumbnail", async move {
        if jobs.is_canceled(&job_id).await {
            return;
        }
        let started = Instant::now();

        let src = match sources.download(&req.source_url, "glb", None).await {
            Ok(src) => src,
            Err(e) => {
                eprintln!("[{job_id}] thumbnail failed: source download: {}", e.message);
                jobs.set_error(&job_id, &e.code, e.message).await;
                return;
            }
        };
        let src_str = src.path_string();
        let (size, direction) = (req.size, req.direction);

        let res = {
            let grant = admission
                .acquire(admission::estimate_mb(http::file_len(src.path()).await))
                .await;
            // The wait may have been long: a job cancelled meanwhile is dropped
            // before it takes the memory it was granted.
            if jobs.is_canceled(&job_id).await {
                return;
            }
            // Running from here on: the wait for memory is queue time, not work.
            jobs.set_status(&job_id, "running").await;
            eprintln!("[{job_id}] thumbnail running");
            compute::run(Some(grant), move || render(&src_str, size, direction)).await
        };
        drop(src);

        let png = match res {
            Ok(Ok(png)) => png,
            Ok(Err(message)) => {
                eprintln!("[{job_id}] thumbnail failed: {message}");
                jobs.set_error(&job_id, "thumbnail_failed", message).await;
                return;
            }
            Err(e) => {
                let msg = format!("thumbnail {e}");
                eprintln!("[{job_id}] {msg}");
                jobs.set_error(&job_id, e.code("thumbnail_failed"), msg).await;
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
            bytes: png.into(),
        }];
        jobs.finish(&job_id, outputs, done, None).await;
    });
}

fn render(path: &str, size: u32, direction: [f32; 3]) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    // SAFETY: the temp file is ours alone and outlives the map; nothing writes it.
    let glb = unsafe { memmap2::Mmap::map(&file) }.map_err(|e| format!("mmap {path}: {e}"))?;
    thumbnail::render_png(&glb, size, direction).map_err(|e| e.0)
}
