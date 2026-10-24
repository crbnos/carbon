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

/// The whole download, headers to last byte. The read timeout below catches a
/// stalled connection; this catches one that trickles. Generous: a 2.5 GB
/// source at 1 MB/s still lands.
const DOWNLOAD_DEADLINE: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// The whole upload: two minutes plus 2 MB/s of body.
fn upload_deadline(bytes: Option<u64>) -> std::time::Duration {
    std::time::Duration::from_secs(120 + bytes.unwrap_or(0) / (2 * 1024 * 1024))
}

/// One shared client for the process: reuses connections (keep-alive/h2)
/// instead of paying a fresh pool + TLS handshake per download/upload.
///
/// Follows no redirects: every URL here is a signed storage URL or our own
/// callback, checked by `config::validate_url`, and a redirect would take the
/// request to a host that was never checked. Errors never carry the URL
/// (`without_url`): signed URLs hold their token in the query string, and an
/// error message is logged, stored on the job and returned to the caller.
fn client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
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

/// Resolves a host to its public addresses only, refusing one that has none.
/// `validate_url` sees only the URL, so a hostname that resolves to a private
/// address (a tenant URL pointed inside the network) passed it.
struct PublicOnly;

impl reqwest::dns::Resolve for PublicOnly {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs = public_addrs(&host).await?;
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

async fn public_addrs(
    host: &str,
) -> Result<Vec<std::net::SocketAddr>, Box<dyn std::error::Error + Send + Sync>> {
    let addrs: Vec<_> = tokio::net::lookup_host((host, 0))
        .await?
        .filter(|addr| config::is_public_ip(addr.ip()))
        .collect();
    if addrs.is_empty() {
        return Err(format!("{host} resolves to no public address").into());
    }
    Ok(addrs)
}

/// The `fetch` action's client: it follows redirects (a CAD system may answer
/// a download with one to its object store), but only to URLs that pass
/// `config::validate_url`, and at most five. reqwest drops the Authorization
/// header on a redirect to another host. Outside dev mode it connects only to
/// public addresses (`PublicOnly`): `fetch` is the one action whose URL comes
/// from a third party (a CAD system's tenant URL is the customer's to set),
/// while every other URL is one of our own signed storage URLs.
fn fetch_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        let policy = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("too many redirects")
            } else if config::validate_url(attempt.url().as_str()).is_err() {
                attempt.error("redirect to a host that is not allowed")
            } else {
                attempt.follow()
            }
        });
        let builder = reqwest::Client::builder();
        let builder = if config::require_https() {
            builder.dns_resolver(std::sync::Arc::new(PublicOnly))
        } else {
            builder
        };
        builder
            .redirect(policy)
            .danger_accept_invalid_certs(!config::verify_tls())
            .connect_timeout(std::time::Duration::from_secs(10))
            .read_timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest client")
    })
}

/// What a download may do beyond the default (the `fetch` action's).
#[derive(Default)]
pub struct DownloadOpts<'a> {
    /// Sent as the `Authorization` header, marked sensitive.
    pub authorization: Option<&'a str>,
    /// Refuse a body past this many bytes (413 `LIMIT_EXCEEDED`).
    pub max_bytes: Option<u64>,
    /// Write the bytes exactly as served: no zstd decoding, and follow
    /// validated redirects.
    pub passthrough: bool,
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
pub async fn download_with(
    url: &str,
    dest: &std::path::Path,
    progress: Option<&crate::progress::JobProgress>,
    opts: &DownloadOpts<'_>,
) -> Result<u128, ApiError> {
    let mut request = if opts.passthrough {
        fetch_client().get(url)
    } else {
        client().get(url)
    };
    if let Some(auth) = opts.authorization {
        let mut value = reqwest::header::HeaderValue::from_str(auth)
            .map_err(|_| ApiError::invalid("invalid source.authorization"))?;
        value.set_sensitive(true);
        request = request.header(reqwest::header::AUTHORIZATION, value);
    }
    let limit = opts
        .max_bytes
        .map_or(config::max_source_bytes(), |b| b as usize);
    let span = if opts.passthrough { "fetch source" } else { "download source" };
    let download = download(request.timeout(DOWNLOAD_DEADLINE), dest, progress, limit, !opts.passthrough);
    telemetry::outbound(span, url, unless_canceled(download)).await
}

/// Run a transfer for the current job, giving up the moment the job is
/// canceled (`jobs::track`'s token): a canceled job stops moving bytes.
async fn unless_canceled<T>(
    transfer: impl std::future::Future<Output = Result<T, ApiError>>,
) -> Result<T, ApiError> {
    let Some(token) = crate::jobs::current_cancel() else {
        return transfer.await;
    };
    tokio::select! {
        result = transfer => result,
        _ = token.cancelled() => Err(ApiError::new(409, "canceled", "the job was canceled")),
    }
}

/// `limit` 0 = unlimited.
async fn download(
    request: reqwest::RequestBuilder,
    dest: &std::path::Path,
    progress: Option<&crate::progress::JobProgress>,
    limit: usize,
    decode_zstd: bool,
) -> Result<u128, ApiError> {
    use async_compression::tokio::bufread::ZstdDecoder;
    use futures_util::StreamExt;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

    let too_large = || ApiError::new(413, "LIMIT_EXCEEDED", "source file exceeds the size limit");
    let resp = request
        .send()
        .await
        .map_err(|e| {
        ApiError::new(
            422,
            "READ_FAILED",
            format!("could not download source: {}", e.without_url()),
        )
    })?;
    if !resp.status().is_success() {
        return Err(ApiError::new(
            422,
            "READ_FAILED",
            format!("could not download source: {}", resp.status()),
        ));
    }
    if limit > 0 && resp.content_length().is_some_and(|len| len > limit as u64) {
        return Err(too_large());
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
        .map(|r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.without_url())));
    let mut buf_reader = tokio::io::BufReader::new(tokio_util::io::StreamReader::new(byte_stream));
    let is_zstd = {
        let head = buf_reader.fill_buf().await.map_err(|e| {
            ApiError::new(
                422,
                "READ_FAILED",
                format!("could not download source: {e}"),
            )
        })?;
        decode_zstd && head.len() >= 4 && head[0..4] == [0x28, 0xB5, 0x2F, 0xFD]
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
            return Err(too_large());
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
/// cached artifact does not copy it onto the heap.
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
    let put = put(url, body.into(), content_type);
    telemetry::outbound("upload artifact", url, unless_canceled(put)).await
}

async fn put(url: &str, body: reqwest::Body, content_type: &str) -> Result<(), ApiError> {
    let deadline = upload_deadline(body.as_bytes().map(|b| b.len() as u64));
    let resp = client()
        .put(url)
        .timeout(deadline)
        .header("Content-Type", content_type)
        .header("x-upsert", "true") // retried jobs re-upload to the same path
        .body(body)
        .send()
        .await
        .map_err(|e| {
            ApiError::new(
                502,
                "UPLOAD_FAILED",
                format!("could not upload artifact: {}", e.without_url()),
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
        .map_err(|e| {
            ApiError::new(
                502,
                "CALLBACK_FAILED",
                format!("callback POST failed: {}", e.without_url()),
            )
        })?;
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

    #[tokio::test]
    async fn a_failed_request_never_echoes_its_signed_url() {
        // Nothing listens on port 1: the connect fails, and reqwest's error
        // would normally quote the whole URL, token included.
        let url = "http://127.0.0.1:1/object/sign/m.step?token=secret-token";
        let dest = temp_path("step");
        let download = download_with(url, &dest, None, &DownloadOpts::default()).await.err().unwrap();
        let upload = upload(url, bytes::Bytes::new(), "application/step").await.err().unwrap();
        let callback = post_json(url, &serde_json::json!({})).await.err().unwrap();
        for message in [download.message, upload.message, callback.message] {
            assert!(!message.contains("secret-token"), "{message}");
            assert!(!message.contains("/object/sign"), "{message}");
        }
    }

    #[tokio::test]
    async fn a_redirect_is_not_followed() {
        let app = axum::Router::new()
            .route(
                "/object",
                axum::routing::get(|| async {
                    (axum::http::StatusCode::FOUND, [("location", "/elsewhere")])
                }),
            )
            .route("/elsewhere", axum::routing::get(|| async { "unchecked host" }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let dest = temp_path("step");
        let err = download_with(&format!("http://{addr}/object"), &dest, None, &DownloadOpts::default())
            .await
            .err()
            .unwrap();
        assert!(err.message.contains("302"), "{}", err.message);
    }

    /// A CAD system's download stand-in: `/export` needs the bearer and
    /// redirects to `/blob` on the SAME host; `/elsewhere` redirects to a
    /// second listener, which records whether an Authorization header came.
    async fn cad_system(body: &'static [u8]) -> (String, std::sync::Arc<std::sync::atomic::AtomicBool>) {
        use axum::http::{HeaderMap, StatusCode};
        use std::sync::atomic::{AtomicBool, Ordering};
        let leaked = std::sync::Arc::new(AtomicBool::new(false));
        let seen = leaked.clone();
        let other = axum::Router::new().route(
            "/blob",
            axum::routing::get(move |headers: HeaderMap| {
                let seen = seen.clone();
                async move {
                    seen.store(headers.contains_key("authorization"), Ordering::SeqCst);
                    body
                }
            }),
        );
        let other_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let other_addr = other_listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(other_listener, other).await.unwrap() });

        let app = axum::Router::new()
            .route(
                "/export",
                axum::routing::get(|headers: HeaderMap| async move {
                    if headers.get("authorization").and_then(|v| v.to_str().ok())
                        == Some("Bearer onshape-token")
                    {
                        (StatusCode::FOUND, [("location", "/blob")]).into_response()
                    } else {
                        StatusCode::UNAUTHORIZED.into_response()
                    }
                }),
            )
            .route("/blob", axum::routing::get(move || async move { body }))
            .route(
                "/elsewhere",
                axum::routing::get(move || async move {
                    (StatusCode::FOUND, [("location", format!("http://{other_addr}/blob"))])
                }),
            );
        use axum::response::IntoResponse;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{addr}"), leaked)
    }

    #[tokio::test]
    async fn a_host_resolving_only_to_private_addresses_is_refused() {
        let err = public_addrs("localhost").await.err().unwrap();
        assert!(err.to_string().contains("no public address"), "{err}");
    }

    #[tokio::test]
    async fn a_canceled_job_stops_its_download_at_once() {
        // A source that sends headers and then nothing: the download would sit
        // in its 60 s read timeout.
        let app = axum::Router::new().route(
            "/slow",
            axum::routing::get(|| async {
                let stream = futures_util::stream::pending::<Result<bytes::Bytes, std::io::Error>>();
                axum::body::Body::from_stream(stream)
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let dest = temp_path("step");
        let url = format!("http://{addr}/slow");
        let job = crate::jobs::track("cancel-download", async move {
            let token = crate::jobs::current_cancel().unwrap();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                token.cancel();
            });
            download_with(&url, &dest, None, &DownloadOpts::default()).await
        });
        let err = tokio::time::timeout(std::time::Duration::from_secs(5), job)
            .await
            .expect("the download stopped")
            .err()
            .unwrap();
        assert_eq!(err.code, "canceled");
    }

    fn fetch_opts(auth: Option<&str>, max_bytes: Option<u64>) -> DownloadOpts<'_> {
        // The stand-ins are plain http on 127.0.0.1, which `validate_url` (and
        // so the redirect policy) allows only in dev mode, as in local dev.
        std::env::set_var("ASSEMBLER_DEV_MODE", "true");
        DownloadOpts { authorization: auth, max_bytes, passthrough: true }
    }

    #[tokio::test]
    async fn a_fetch_sends_its_bearer_and_writes_the_bytes_unchanged() {
        // zstd magic first: a passthrough must not decode it.
        let body: &'static [u8] = &[0x28, 0xB5, 0x2F, 0xFD, 1, 2, 3];
        let (base, _) = cad_system(body).await;
        let dest = temp_path("fetch");
        let hash = download_with(&format!("{base}/export"), &dest, None, &fetch_opts(Some("Bearer onshape-token"), None))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert_eq!(hash, xxhash_rust::xxh3::xxh3_128(body));
        let _ = std::fs::remove_file(&dest);

        let refused = download_with(&format!("{base}/export"), &dest, None, &fetch_opts(None, None))
            .await
            .err()
            .unwrap();
        assert!(refused.message.contains("401"), "{}", refused.message);
    }

    #[tokio::test]
    async fn a_fetch_redirected_to_another_host_does_not_carry_the_bearer() {
        let (base, leaked) = cad_system(b"ISO-10303-21;").await;
        let dest = temp_path("fetch");
        download_with(&format!("{base}/elsewhere"), &dest, None, &fetch_opts(Some("Bearer onshape-token"), None))
            .await
            .unwrap();
        let _ = std::fs::remove_file(&dest);
        assert!(!leaked.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[tokio::test]
    async fn a_fetch_past_its_cap_is_refused() {
        let (base, _) = cad_system(b"ISO-10303-21; far too long").await;
        let dest = temp_path("fetch");
        let err = download_with(&format!("{base}/export"), &dest, None, &fetch_opts(Some("Bearer onshape-token"), Some(4)))
            .await
            .err()
            .unwrap();
        assert_eq!((err.status, err.code.as_str()), (413, "LIMIT_EXCEEDED"));
        assert!(!dest.exists());
    }

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
