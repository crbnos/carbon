//! Signed-URL download/upload + temp files — port of `_download`/`_upload`.

use crate::config;
use crate::error::ApiError;
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
pub async fn download_hashed(
    url: &str,
    dest: &std::path::Path,
    progress: Option<&crate::progress::JobProgress>,
) -> Result<u128, ApiError> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

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
    if let Some(len) = resp.content_length() {
        if len as usize > limit {
            return Err(ApiError::new(
                413,
                "LIMIT_EXCEEDED",
                "source file exceeds the size limit",
            ));
        }
        if let Some(p) = progress {
            p.total.store(len, std::sync::atomic::Ordering::Relaxed);
        }
    }

    let mut file = tokio::fs::File::create(dest).await.map_err(|e| {
        ApiError::new(
            500,
            "READ_FAILED",
            format!("could not write temp file: {e}"),
        )
    })?;
    let mut hasher = xxhash_rust::xxh3::Xxh3::new();
    let mut written = 0usize;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        // Any mid-stream failure must remove the partial temp file — leaving it
        // leaks disk (callers don't clean up on error).
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let _ = tokio::fs::remove_file(dest).await;
                return Err(ApiError::new(
                    422,
                    "READ_FAILED",
                    format!("could not download source: {e}"),
                ));
            }
        };
        written += chunk.len();
        if written > limit {
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
        hasher.update(&chunk);
        if let Err(e) = file.write_all(&chunk).await {
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

pub async fn upload(
    url: &str,
    body: impl Into<reqwest::Body>,
    content_type: &str,
) -> Result<(), ApiError> {
    let resp = client()
        .put(url)
        .header("Content-Type", content_type)
        .header("x-upsert", "true") // retried jobs re-upload to the same path
        .body(body.into())
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
