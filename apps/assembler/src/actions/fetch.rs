// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! `fetch` action — copy a file from a URL the caller may not reach cheaply
//! (a CAD system's export, behind its own `Authorization`) into storage,
//! unchanged, and report its size and content hash. The bytes go source →
//! this service's disk → the `raw` upload URL; the caller never holds them.
//! No compute, so no memory grant: only a source slot.

use crate::jobs::{Done, Output};
use crate::{http, telemetry, AppState};
use serde_json::json;
use std::time::Instant;

pub struct FetchReq {
    pub source_url: String,
    /// Sent as the `Authorization` header. Lives only in this request: never
    /// in the job record, a log or a span.
    pub authorization: Option<String>,
    /// Refuse a file past this many bytes (413 `LIMIT_EXCEEDED`).
    pub max_bytes: Option<u64>,
    /// The upload's content type.
    pub content_type: String,
    /// Storage path recorded in the completion pointer; the signed PUT URL
    /// comes with the submit, key `raw`.
    pub path: Option<String>,
}

pub fn spawn(state: &AppState, job_id: &str, req: FetchReq) {
    let jobs = state.jobs.clone();
    let sources = state.sources.clone();
    let job_id = job_id.to_string();
    telemetry::spawn_job(&job_id.clone(), "fetch", async move {
        if jobs.is_canceled(&job_id).await {
            return;
        }
        let started = Instant::now();
        jobs.set_status(&job_id, "running").await;
        let opts = http::DownloadOpts {
            authorization: req.authorization.as_deref(),
            max_bytes: req.max_bytes,
            passthrough: true,
        };
        let src = match sources.download_with(&req.source_url, "fetch", None, &opts).await {
            Ok(src) => src,
            Err(e) => {
                eprintln!("[{job_id}] fetch failed: {}", e.message);
                jobs.set_error(&job_id, &e.code, e.message).await;
                return;
            }
        };
        let bytes = match http::map_file(src.path()) {
            Ok(bytes) => bytes,
            Err(e) => {
                jobs.set_error(&job_id, "READ_FAILED", format!("map fetched file: {e}"))
                    .await;
                return;
            }
        };
        let size = bytes.len();
        let fetch_ms = started.elapsed().as_millis() as i64;
        eprintln!("[{job_id}] fetch done: {size} bytes, {fetch_ms}ms");

        let done = Done {
            result: json!({
                "contentHash": format!("{:032x}", src.hash),
                "outputs": { "raw": { "path": req.path, "bytes": size } },
            }),
            stats: json!({ "outputBytes": size, "fetchMs": fetch_ms }),
        };
        let outputs = vec![Output {
            name: "raw".into(),
            content_type: req.content_type,
            bytes,
        }];
        jobs.finish(&job_id, outputs, done, None).await;
        drop(src);
    });
}
