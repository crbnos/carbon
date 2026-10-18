// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
//! Async job; the single compressed `raw` output is uploaded to its
//! submit-time URL. The
//! caller then repoints `modelUpload.modelPath` at it and deletes the fat
//! original. `download_hashed` decompresses any `.zst` source transparently, so
//! re-running compact on an already-compacted model is a no-op-safe passthrough.

use crate::jobs::{Done, Output};
use crate::{admission, compute, http, telemetry, AppState};
use serde_json::json;
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
    /// repoints modelPath); the signed PUT URL comes with the submit, key `raw`.
    pub raw_path: Option<String>,
}

/// zstd level for the retained artifact. Background job, so favour ratio, but
/// not the glacial max — STEP/xbf/glTF text all compress well at this mid level.
pub(crate) const ZSTD_LEVEL: i32 = 12;

pub fn spawn(state: &AppState, job_id: &str, req: CompactReq) {
    let jobs = state.jobs.clone();
    let admission = state.admission.clone();
    let sources = state.sources.clone();
    let job_id = job_id.to_string();
    telemetry::spawn_job(&job_id.clone(), "compact", async move {
        if jobs.is_canceled(&job_id).await {
            return;
        }
        let started = Instant::now();

        let src = match sources.download(&req.source_url, "src", None).await {
            Ok(src) => src,
            Err(e) => {
                eprintln!("[{job_id}] compact failed: source download: {}", e.message);
                jobs.set_error(&job_id, &e.code, e.message).await;
                return;
            }
        };
        let src_str = src.path_string();
        let mode = req.mode;
        let level = ZSTD_LEVEL;

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
            eprintln!("[{job_id}] compact running");
            compute::run(Some(grant), move || compress(&src_str, mode, level)).await
        };
        drop(src);

        let out = match res {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => {
                eprintln!("[{job_id}] compact failed ({}): {}", e.code, e.message);
                jobs.set_error(&job_id, e.code, e.message).await;
                return;
            }
            Err(e) => {
                let msg = format!("compact {e}");
                eprintln!("[{job_id}] {msg}");
                jobs.set_error(&job_id, e.code("compact_failed"), msg).await;
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
    bytes: bytes::Bytes,
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
            let bytes = zstd_file_mapped(&xbf_str, level).map_err(|e| CompactErr {
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
            let bytes = zstd_file_mapped(src_path, level).map_err(|e| CompactErr {
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

/// zstd `path` into a temp file and hand it back memory-mapped: the page cache
/// holds the compressed bytes, not the heap. The file is unlinked at once; the
/// map keeps it readable until the bytes drop.
pub(crate) fn zstd_file_mapped(path: &str, level: i32) -> Result<bytes::Bytes, String> {
    let out = http::temp_path("zst");
    let written = (|| {
        let input = std::fs::File::open(path).map_err(|e| format!("open {path}: {e}"))?;
        let output = std::fs::File::create(&out).map_err(|e| format!("create temp: {e}"))?;
        let mut writer = std::io::BufWriter::new(output);
        zstd::stream::copy_encode(std::io::BufReader::new(input), &mut writer, level)
            .map_err(|e| format!("zstd encode: {e}"))?;
        std::io::Write::flush(&mut writer).map_err(|e| format!("flush temp: {e}"))?;
        http::map_file(&out).map_err(|e| format!("map temp: {e}"))
    })();
    let _ = std::fs::remove_file(&out);
    written
}
