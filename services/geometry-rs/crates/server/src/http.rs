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

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(!config::verify_tls())
        .build()
        .expect("reqwest client")
}

pub async fn download(url: &str, dest: &std::path::Path) -> Result<(), ApiError> {
    let limit = config::max_source_bytes();
    let resp = client()
        .get(url)
        .send()
        .await
        .map_err(|e| ApiError::new(422, "READ_FAILED", format!("could not download source: {e}")))?;
    if !resp.status().is_success() {
        return Err(ApiError::new(422, "READ_FAILED", format!("could not download source: {}", resp.status())));
    }
    if let Some(len) = resp.content_length() {
        if len as usize > limit {
            return Err(ApiError::new(413, "LIMIT_EXCEEDED", "source file exceeds the size limit"));
        }
    }
    let body = resp
        .bytes()
        .await
        .map_err(|e| ApiError::new(422, "READ_FAILED", format!("could not download source: {e}")))?;
    if body.len() > limit {
        return Err(ApiError::new(413, "LIMIT_EXCEEDED", "source file exceeds the size limit"));
    }
    tokio::fs::write(dest, &body)
        .await
        .map_err(|e| ApiError::new(500, "READ_FAILED", format!("could not write temp file: {e}")))?;
    Ok(())
}

pub async fn upload(url: &str, body: Vec<u8>, content_type: &str) -> Result<(), ApiError> {
    let resp = client()
        .put(url)
        .header("Content-Type", content_type)
        .header("x-upsert", "true") // retried jobs re-upload to the same path
        .body(body)
        .send()
        .await
        .map_err(|e| ApiError::new(502, "UPLOAD_FAILED", format!("could not upload artifact: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        let detail: String = detail.chars().take(200).collect();
        return Err(ApiError::new(502, "UPLOAD_FAILED", format!("could not upload artifact: {status} {detail}")));
    }
    Ok(())
}
