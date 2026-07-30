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

/// POST a JSON body (the completion-callback delivery). Short timeout; the
/// caller owns retries.
pub async fn post_json(url: &str, body: &serde_json::Value) -> Result<(), ApiError> {
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
