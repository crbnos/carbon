//! `compact` action — shrink the retained raw so lazy planning + reoptimise keep
//! working without hoarding the fat upload. Two modes:
//!
//!   - `xbf`  (STEP sources): STEP → OCCT BinXCAF (`.xbf`, lossless B-rep +
//!            assembly tree + names + colors, already mm) → zstd. Far smaller and
//!            faster to parse than ASCII STEP; the planner/convert/optimize read
//!            it transparently (content-sniffed as `xbf`).
//!   - `zstd` (mesh sources: glTF/GLB/STL): plain zstd of the raw — nothing to
//!            re-topologise, but reoptimise still needs the bytes.
//!
//! Async job; the single compressed `raw` output is late-mint uploaded. The
//! caller then repoints `modelUpload.modelPath` at it and deletes the fat
//! original. `download_hashed` decompresses any `.zst` source transparently, so
//! re-running compact on an already-compacted model is a no-op-safe passthrough.

use crate::jobs::{Done, Output};
use crate::{http, AppState};
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// STEP → BinXCAF (`.xbf`) → zstd.
    Xbf,
    /// Raw bytes → zstd (mesh sources).
    Zstd,
}

impl Mode {
    pub fn from_str(s: &str) -> Option<Mode> {
        match s.trim().to_ascii_lowercase().as_str() {
            "xbf" => Some(Mode::Xbf),
            "zstd" | "zst" => Some(Mode::Zstd),
            _ => None,
        }
    }
}

pub struct CompactReq {
    pub source_url: String,
    pub mode: Mode,
    /// Storage path recorded in the completion pointer (the app persists it and
    /// repoints modelPath); the signed PUT URL is late-minted per poll, key `raw`.
    pub raw_path: Option<String>,
}

/// zstd level for the retained artifact. Background job, so favour ratio, but
/// not the glacial max — STEP/xbf/glTF text all compress well at this mid level.
const ZSTD_LEVEL: i32 = 12;

pub fn spawn(state: &AppState, job_id: &str, req: CompactReq) {
    let jobs = state.jobs.clone();
    let slots = Arc::clone(&state.slots);
    let job_id = job_id.to_string();
    tokio::spawn(async move {
        let _permit = slots.acquire().await;
        if jobs.is_canceled(&job_id).await {
            return;
        }
        jobs.set_status(&job_id, "running").await;
        eprintln!("[{job_id}] compact running");
        let started = Instant::now();

        let src = http::temp_path("src");
        if let Err(e) = http::download_hashed(&req.source_url, &src, None).await {
            let _ = tokio::fs::remove_file(&src).await;
            eprintln!("[{job_id}] compact failed: source download: {}", e.message);
            jobs.set_error(&job_id, &e.code, e.message).await;
            return;
        }
        let src_str = src.to_string_lossy().to_string();
        let mode = req.mode;
        let level = ZSTD_LEVEL;

        let res = tokio::task::spawn_blocking(move || compress(&src_str, mode, level)).await;
        let _ = tokio::fs::remove_file(&src).await;

        let out = match res {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => {
                eprintln!("[{job_id}] compact failed ({}): {}", e.code, e.message);
                jobs.set_error(&job_id, e.code, e.message).await;
                return;
            }
            Err(e) => {
                let msg = format!("compact panicked: {e}");
                eprintln!("[{job_id}] {msg}");
                jobs.set_error(&job_id, "compact_failed", msg).await;
                return;
            }
        };

        let compact_ms = started.elapsed().as_millis() as i64;
        eprintln!(
            "[{job_id}] compact done: {} -> {} bytes ({}), {compact_ms}ms",
            out.input_bytes,
            out.bytes.len(),
            out.kind,
        );

        let done = Done {
            result: json!({
                "kind": out.kind,
                "outputs": { "raw": { "path": req.raw_path, "bytes": out.bytes.len() } },
            }),
            stats: json!({
                "inputBytes": out.input_bytes,
                "outputBytes": out.bytes.len(),
                "compactMs": compact_ms,
            }),
        };
        let outputs = vec![Output {
            name: "raw".into(),
            content_type: "application/zstd".into(),
            bytes: out.bytes,
        }];
        jobs.finish(&job_id, outputs, done, None).await;
    });
}

struct CompactErr {
    code: &'static str,
    message: String,
}

struct Compacted {
    bytes: Vec<u8>,
    input_bytes: u64,
    kind: &'static str,
}

fn compress(src_path: &str, mode: Mode, level: i32) -> Result<Compacted, CompactErr> {
    let input_bytes = std::fs::metadata(src_path).map(|m| m.len()).unwrap_or(0);
    match mode {
        Mode::Xbf => {
            let xbf = http::temp_path("xbf");
            let xbf_str = xbf.to_string_lossy().to_string();
            let r = converter::convert::step_to_xbf(src_path, &xbf_str).map_err(|e| CompactErr {
                code: "tessellation_failed",
                message: e.message,
            });
            if let Err(e) = r {
                let _ = std::fs::remove_file(&xbf);
                return Err(e);
            }
            let bytes = zstd_file(&xbf_str, level).map_err(|e| CompactErr {
                code: "compact_failed",
                message: e,
            });
            let _ = std::fs::remove_file(&xbf);
            Ok(Compacted {
                bytes: bytes?,
                input_bytes,
                kind: "xbf",
            })
        }
        Mode::Zstd => {
            let bytes = zstd_file(src_path, level).map_err(|e| CompactErr {
                code: "compact_failed",
                message: e,
            })?;
            Ok(Compacted {
                bytes,
                input_bytes,
                kind: "zstd",
            })
        }
    }
}

/// Stream a file through zstd into an owned buffer (the compressed artifact is
/// small — read is streaming, only the result is held).
fn zstd_file(path: &str, level: i32) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    zstd::stream::encode_all(std::io::BufReader::new(file), level)
        .map_err(|e| format!("zstd encode: {e}"))
}
