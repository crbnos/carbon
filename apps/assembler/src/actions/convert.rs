// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! `convert` action — STEP → GLB + graph.json. Async job: the caller long-polls
//! and hands fresh signed upload URLs (`glb`, `graph`) per poll (late-mint). The
//! in-process result cache still skips re-tessellation for repeated content; the
//! artifacts are re-uploaded to each job's own paths.

use crate::cache::{CachedConvert, ResultCache};
use crate::jobs::{Done, Output};
use crate::{admission, config, http, progress, AppState};
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;

/// Everything a convert task needs from the request.
pub struct ConvertReq {
    pub source_url: String,
    /// Caller-declared content identity (storage etag); a hit skips the download.
    pub declared_hash: Option<String>,
    /// Storage paths recorded in the completion pointer (the app persists these);
    /// the actual signed PUT URLs are late-minted per poll, keyed `glb`/`graph`.
    pub glb_path: Option<String>,
    pub graph_path: Option<String>,
    pub lin: f64,
    pub ang: f64,
    /// Run meshopt geometry passes + EXT_meshopt encode on the GLB (default true).
    pub optimize: bool,
}

pub fn spawn(state: &AppState, job_id: &str, req: ConvertReq) {
    let jobs = state.jobs.clone();
    let cache = Arc::clone(&state.cache);
    let progress_store = state.progress.clone();
    let admission = state.admission.clone();
    let job_id = job_id.to_string();
    tokio::spawn(async move {
        if jobs.is_canceled(&job_id).await {
            return;
        }
        jobs.set_status(&job_id, "running").await;
        let tracker = progress_store.start(&job_id);
        eprintln!("[{job_id}] convert running");
        let started = Instant::now();

        // Declared-hash pre-check: a hit skips the source download entirely.
        if let Some(h) = &req.declared_hash {
            let key = ResultCache::key_declared(h, req.lin, req.ang);
            if let Some(entry) = cache.get(&key) {
                tracker.progress.set_phase(progress::PHASE_UPLOAD);
                complete(&jobs, &job_id, &req, entry, started, true).await;
                return;
            }
        }

        let tmp = http::temp_path("step");
        let content_hash =
            match http::download_hashed(&req.source_url, &tmp, Some(&tracker.progress)).await {
                Ok(h) => h,
                Err(e) => {
                    let _ = tokio::fs::remove_file(&tmp).await;
                    eprintln!("[{job_id}] convert failed: source download: {}", e.message);
                    jobs.set_error(&job_id, &e.code, e.message).await;
                    return;
                }
            };
        tracker.progress.set_phase(progress::PHASE_CONVERT);

        let key = match &req.declared_hash {
            Some(h) => ResultCache::key_declared(h, req.lin, req.ang),
            None => ResultCache::key(content_hash, req.lin, req.ang),
        };
        let entry = match cache.get(&key) {
            Some(entry) => {
                let _ = tokio::fs::remove_file(&tmp).await;
                entry
            }
            None => {
                // Held for the tessellation only: the download before it streams
                // to disk and the upload after it holds just the outputs.
                let _grant = admission
                    .acquire(admission::estimate_mb(http::file_len(&tmp).await))
                    .await;
                let tmp_str = tmp.to_string_lossy().to_string();
                let cache_ins = Arc::clone(&cache);
                let (lin, ang, optimize) = (req.lin, req.ang, req.optimize);
                let res = tokio::task::spawn_blocking(move || {
                    // Compacted retained raws are BinXCAF (`.xbf`) — binary, no
                    // STEP header to unit-detect (already mm); running the lossy
                    // text scan on them is wasted work at best.
                    if converter::convert::is_xbf(&tmp_str) {
                        converter::convert::convert_xbf(&tmp_str, lin, ang)
                    } else {
                        // Unit detection scans the head of the mapped file — no
                        // decoded copy of it.
                        let head = http::map_file(std::path::Path::new(&tmp_str)).map_err(|e| {
                            converter::convert::ConvertError::new(
                                "READ_FAILED",
                                format!("read temp: {e}"),
                            )
                        })?;
                        converter::convert::convert_step_head(&tmp_str, &head, lin, ang)
                    }
                    .map(|conv| {
                        let glb = if optimize {
                            optimize_glb(conv.glb)
                        } else {
                            conv.glb
                        };
                        cache_ins.insert(
                            key,
                            CachedConvert {
                                glb: glb.into(),
                                graph_bytes: serde_json::to_vec(&conv.graph).unwrap().into(),
                                component_count: conv.component_count,
                                triangles: conv.triangles,
                                unit: conv.graph["unit"].clone(),
                            },
                        )
                    })
                })
                .await;
                let _ = tokio::fs::remove_file(&tmp).await;
                match res {
                    Ok(Ok(entry)) => entry,
                    Ok(Err(e)) => {
                        let code = convert_code(&e);
                        eprintln!("[{job_id}] convert failed: {}", e.message);
                        jobs.set_error(&job_id, code, e.message).await;
                        return;
                    }
                    Err(e) => {
                        let msg = format!("convert panicked: {e}");
                        eprintln!("[{job_id}] {msg}");
                        jobs.set_error(&job_id, "TESSELLATION_FAILED", msg).await;
                        return;
                    }
                }
            }
        };

        tracker.progress.set_phase(progress::PHASE_UPLOAD);
        complete(&jobs, &job_id, &req, entry, started, false).await;
    });
}

/// Enforce the part-count limit, then hold the GLB + graph for late-mint upload.
async fn complete(
    jobs: &crate::jobs::JobStore,
    job_id: &str,
    req: &ConvertReq,
    entry: Arc<CachedConvert>,
    started: Instant,
    was_hit: bool,
) {
    let mp = config::max_parts();
    if entry.component_count > mp as i64 {
        jobs.set_error(
            job_id,
            "LIMIT_EXCEEDED",
            format!(
                "assembly has {} part instances; the limit is {mp}",
                entry.component_count
            ),
        )
        .await;
        return;
    }

    let convert_ms = started.elapsed().as_millis() as i64;
    eprintln!(
        "[{job_id}] convert computed: {} parts, {} triangles, {convert_ms}ms{}",
        entry.component_count,
        entry.triangles,
        if was_hit { " (cache hit)" } else { "" }
    );

    let done = Done {
        result: json!({
            "componentCount": entry.component_count,
            "unit": entry.unit,
            "outputs": {
                "glb": { "path": req.glb_path },
                "graph": { "path": req.graph_path },
            },
        }),
        stats: json!({ "convertMs": convert_ms, "meshTriangles": entry.triangles }),
    };
    let outputs = vec![
        Output {
            name: "glb".into(),
            content_type: "model/gltf-binary".into(),
            bytes: entry.glb.clone(),
        },
        Output {
            name: "graph".into(),
            content_type: "application/json".into(),
            bytes: entry.graph_bytes.clone(),
        },
    ];
    // Convert output paths are job-scoped, so no result-pointer cache (the bytes
    // are cached in-process instead); artifacts always re-upload.
    jobs.finish(job_id, outputs, done, None).await;
}

/// Meshopt geometry optimisation + EXT_meshopt encode on the convert output.
/// Full fidelity (no simplify) — convert must not drop geometry the planner and
/// nodeIds depend on. Best-effort: on any optimise error keep the plain,
/// contract-valid GLB rather than failing the convert.
fn optimize_glb(glb: Vec<u8>) -> Vec<u8> {
    let opts = optimize::Options {
        codec: optimize::Codec::Meshopt,
        simplify: None,
        ..Default::default()
    };
    match optimize::optimize_glb(&glb, &opts) {
        Ok(res) => res.glb,
        Err(e) => {
            eprintln!(
                "convert: meshopt optimise skipped ({}); serving plain GLB",
                e
            );
            glb
        }
    }
}

fn convert_code(e: &converter::convert::ConvertError) -> &'static str {
    match e.code.as_str() {
        "READ_FAILED" => "READ_FAILED",
        "INVALID_INPUT" => "INVALID_INPUT",
        "LIMIT_EXCEEDED" => "LIMIT_EXCEEDED",
        "BUSY" => "BUSY",
        "UPLOAD_FAILED" => "UPLOAD_FAILED",
        _ => "TESSELLATION_FAILED",
    }
}
