// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Signed-URL download/upload + temp files — port of `_download`/`_upload`.

use crate::config;
use crate::error::ApiError;
use crate::telemetry;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn temp_path(ext: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("geometry-{}-{n}-{nanos}.{ext}", std::process::id()))
}

/// Delete the sources an earlier process left behind. A killed process (an OOM
/// kill above all) skips its actions' own cleanup, and a pod's temp volume
/// outlives the container restart, so they would pile up. Only for the standing
/// server at startup, before it has a job of its own.
pub fn clear_stale_sources() {
    clear_sources_in(&std::env::temp_dir());
}

fn clear_sources_in(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with("geometry-") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// One shared client for the process: reuses connections (keep-alive/h2)
/// instead of paying a fresh pool + TLS handshake per download/upload.
fn client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .danger_accept_invalid_certs(!config::verify_tls())
            .connect_timeout(std::time::Duration::from_secs(10))
            // Idle-read timeout, not a total deadline: a large source can stream
            // for a while, but a stalled connection (no bytes for 60s) must fail
            // so it can't hold a concurrency slot forever.
            .read_timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest client")
    })
}

/// Stream the source to disk, hashing as it flows — one pass, no full-body RAM
/// buffer, and the content hash comes out free for the result-cache key.
/// `progress` (when given) is ticked with bytes done/total for live status.
///
/// Transparent zstd: a source whose first bytes are the zstd magic
/// (`28 B5 2F FD`) is streamed through a decoder, so a stored `.zst` (e.g. the
/// compacted `raw.xbf.zst`) lands on disk as the real STEP/XBF/mesh and every
/// action consumes it unchanged. The hash + size guard are over the
/// DECOMPRESSED bytes, so the result-cache key tracks geometry, not container.
pub async fn download_hashed(
    url: &str,
    dest: &std::path::Path,
    progress: Option<&crate::progress::JobProgress>,
) -> Result<u128, ApiError> {
    telemetry::outbound("download source", url, download(url, dest, progress)).await
}

async fn download(
    url: &str,
    dest: &std::path::Path,
    progress: Option<&crate::progress::JobProgress>,
) -> Result<u128, ApiError> {
    use async_compression::tokio::bufread::ZstdDecoder;
    use futures_util::StreamExt;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

    let limit = config::max_source_bytes();
    let resp = client().get(url).send().await.map_err(|e| {
        ApiError::new(
            422,
            "READ_FAILED",
            format!("could not download source: {e}"),
        )
    })?;
    if !resp.status().is_success() {
        return Err(ApiError::new(
            422,
            "READ_FAILED",
            format!("could not download source: {}", resp.status()),
        ));
    }
    // content-length is the on-the-wire (possibly compressed) size — advisory for
    // progress only; the real cap is the decompressed `written` counter below.
    if let Some(p) = progress {
        if let Some(len) = resp.content_length() {
            p.total.store(len, std::sync::atomic::Ordering::Relaxed);
        }
    }

    let read_err = |e: std::io::Error, dest: &std::path::Path| {
        let dest = dest.to_path_buf();
        async move {
            let _ = tokio::fs::remove_file(&dest).await;
            ApiError::new(
                422,
                "READ_FAILED",
                format!("could not download source: {e}"),
            )
        }
    };

    // reqwest byte stream → AsyncBufRead, so the 4-byte magic can be peeked
    // without consuming and the whole thing optionally piped through zstd.
    let byte_stream = resp
        .bytes_stream()
        .map(|r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)));
    let mut buf_reader = tokio::io::BufReader::new(tokio_util::io::StreamReader::new(byte_stream));
    let is_zstd = {
        let head = buf_reader.fill_buf().await.map_err(|e| {
            ApiError::new(
                422,
                "READ_FAILED",
                format!("could not download source: {e}"),
            )
        })?;
        head.len() >= 4 && head[0..4] == [0x28, 0xB5, 0x2F, 0xFD]
    };
    // multiple_members: tolerate a source written as concatenated zstd frames.
    let mut input: std::pin::Pin<Box<dyn tokio::io::AsyncRead + Send>> = if is_zstd {
        let mut dec = ZstdDecoder::new(buf_reader);
        dec.multiple_members(true);
        Box::pin(dec)
    } else {
        Box::pin(buf_reader)
    };

    let mut file = tokio::fs::File::create(dest).await.map_err(|e| {
        ApiError::new(
            500,
            "READ_FAILED",
            format!("could not write temp file: {e}"),
        )
    })?;
    let mut hasher = xxhash_rust::xxh3::Xxh3::new();
    let mut written = 0usize;
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        // A decode error (corrupt/truncated zstd) surfaces here as an io::Error —
        // fail loud rather than store a partial file.
        let n = match input.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => return Err(read_err(e, dest).await),
        };
        written += n;
        if limit > 0 && written > limit {
            let _ = tokio::fs::remove_file(dest).await;
            return Err(ApiError::new(
                413,
                "LIMIT_EXCEEDED",
                "source file exceeds the size limit",
            ));
        }
        if let Some(p) = progress {
            p.done
                .store(written as u64, std::sync::atomic::Ordering::Relaxed);
        }
        hasher.update(&buf[..n]);
        if let Err(e) = file.write_all(&buf[..n]).await {
            let _ = tokio::fs::remove_file(dest).await;
            return Err(ApiError::new(
                500,
                "READ_FAILED",
                format!("could not write temp file: {e}"),
            ));
        }
    }
    file.flush().await.ok();
    Ok(hasher.digest128())
}

/// A downloaded source's size, for the memory estimate. 0 if it cannot be read.
pub async fn file_len(path: &std::path::Path) -> u64 {
    tokio::fs::metadata(path).await.map_or(0, |m| m.len())
}

/// A file's bytes, memory-mapped: the page cache backs them, so uploading a
/// parked or cached artifact does not copy it onto the heap.
pub fn map_file(path: &std::path::Path) -> std::io::Result<bytes::Bytes> {
    let file = std::fs::File::open(path)?;
    if file.metadata()?.len() == 0 {
        return Ok(bytes::Bytes::new());
    }
    // SAFETY: these files are written once by this service and then only read
    // or unlinked; an unlinked file stays mapped until the map is dropped.
    let map = unsafe { memmap2::Mmap::map(&file) }?;
    Ok(bytes::Bytes::from_owner(map))
}

pub async fn upload(
    url: &str,
    body: impl Into<reqwest::Body>,
    content_type: &str,
) -> Result<(), ApiError> {
    telemetry::outbound("upload artifact", url, put(url, body.into(), content_type)).await
}

async fn put(url: &str, body: reqwest::Body, content_type: &str) -> Result<(), ApiError> {
    let resp = client()
        .put(url)
        .header("Content-Type", content_type)
        .header("x-upsert", "true") // retried jobs re-upload to the same path
        .body(body)
        .send()
        .await
        .map_err(|e| {
            ApiError::new(
                502,
                "UPLOAD_FAILED",
                format!("could not upload artifact: {e}"),
            )
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        let detail: String = detail.chars().take(200).collect();
        return Err(ApiError::new(
            502,
            "UPLOAD_FAILED",
            format!("could not upload artifact: {status} {detail}"),
        ));
    }
    Ok(())
}

/// POST a JSON body (the completion-callback delivery). Short timeout; the
/// caller owns retries.
pub async fn post_json(url: &str, body: &serde_json::Value) -> Result<(), ApiError> {
    telemetry::outbound("callback", url, post(url, body)).await
}

async fn post(url: &str, body: &serde_json::Value) -> Result<(), ApiError> {
    let resp = client()
        .post(url)
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| ApiError::new(502, "CALLBACK_FAILED", format!("callback POST failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(ApiError::new(
            502,
            "CALLBACK_FAILED",
            format!("callback POST returned {}", resp.status()),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_sources_are_cleared_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let stale = dir.path().join("geometry-1-0-123.step");
        let other = dir.path().join("asm-cache");
        std::fs::write(&stale, b"x").unwrap();
        std::fs::create_dir(&other).unwrap();

        clear_sources_in(dir.path());

        assert!(!stale.exists());
        assert!(other.exists());
    }
}
