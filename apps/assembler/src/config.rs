//! Operational limits + URL policy — port of `app/config.py` + `_validate_url`.

use crate::error::ApiError;

fn int_env(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(default)
}

pub fn max_source_bytes() -> usize {
    int_env("ASSEMBLER_MAX_SOURCE_MB", 250) * 1024 * 1024
}

pub fn max_parts() -> usize {
    int_env("ASSEMBLER_MAX_PARTS", 5000)
}

/// How long shutdown waits for running plan tasks after the HTTP listener
/// drains. Match the orchestrator's termination grace period.
pub fn shutdown_grace() -> std::time::Duration {
    std::time::Duration::from_secs(int_env("ASSEMBLER_SHUTDOWN_GRACE_S", 600) as u64)
}

/// Result-cache budget (bytes). 0 disables the cache.
pub fn cache_bytes() -> usize {
    int_env("ASSEMBLER_CACHE_MB", 512) * 1024 * 1024
}

pub fn max_concurrency() -> usize {
    int_env("ASSEMBLER_MAX_CONCURRENCY", 2).max(1)
}

/// Redis URL for the shared job/result store. Unset => in-process backend (the
/// single-process default). A set-but-unreachable URL falls back to memory at
/// boot rather than refusing to start (mirrors @carbon/kv's soft-fail).
pub fn redis_url() -> Option<String> {
    std::env::var("ASSEMBLER_REDIS_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// TTL (seconds) for a Redis job-status entry — long enough to outlive any poll
/// window, short enough that abandoned jobs self-evict. Default 24h.
pub fn job_ttl_secs() -> u64 {
    int_env("ASSEMBLER_JOB_TTL_SECS", 86400) as u64
}

/// TTL (seconds) for a Redis content-hash result-pointer entry. Default 24h.
pub fn result_ttl_secs() -> u64 {
    int_env("ASSEMBLER_RESULT_TTL_SECS", 86400) as u64
}

/// TTL (seconds) for a computed-but-unuploaded plan held in Redis for hand-off
/// (compute -> the poll that uploads it). Short: a plan not drained within this
/// window is abandoned and the job re-plans. Default 5 min.
pub fn pending_ttl_secs() -> u64 {
    int_env("ASSEMBLER_PENDING_TTL_SECS", 300) as u64
}

/// Server-side cap on the `?wait=` long-poll hold (seconds). Kept under typical
/// proxy/LB idle timeouts so a held request never trips them.
pub fn max_long_poll_secs() -> u64 {
    int_env("ASSEMBLER_MAX_LONG_POLL_S", 25) as u64
}

/// Cap on tokio's blocking pool — the implicit convert queue. OCCT scales to
/// ~core count; beyond that extra blocking threads just oversubscribe (c=64
/// measured: p99 7.2s uncapped). Excess spawn_blocking tasks queue inside the
/// pool, so overload degrades to waiting, never to 429s. +2 headroom keeps
/// tokio::fs ops from starving behind long converts.
pub fn blocking_threads() -> usize {
    let cores = std::thread::available_parallelism().map_or(8, |n| n.get());
    int_env("ASSEMBLER_BLOCKING_THREADS", cores + 2).max(2)
}

pub fn allowed_url_hosts() -> Vec<String> {
    std::env::var("ASSEMBLER_ALLOWED_URL_HOSTS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn require_https() -> bool {
    std::env::var("ASSEMBLER_DEV_MODE").as_deref() != Ok("true")
}

pub fn verify_tls() -> bool {
    std::env::var("ASSEMBLER_DEV_MODE").as_deref() != Ok("true")
}

pub fn validate_url(url: &str) -> Result<(), ApiError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| ApiError::invalid("invalid URL"))?;
    let scheme = parsed.scheme();
    if require_https() && scheme != "https" {
        return Err(ApiError::invalid("URLs must use https"));
    }
    if scheme != "http" && scheme != "https" {
        return Err(ApiError::invalid(format!(
            "unsupported URL scheme: {scheme}"
        )));
    }
    let allowed = allowed_url_hosts();
    if !allowed.is_empty() {
        let host = parsed.host_str().unwrap_or("").to_lowercase();
        if !allowed.contains(&host) {
            return Err(ApiError::invalid("URL host is not allowed"));
        }
    } else if require_https() {
        // No explicit allowlist, and not dev mode: default-deny SSRF against
        // internal targets by rejecting private/loopback/link-local IP literals.
        // (Dev fetches source URLs from local storage over portless, so this
        // only applies when ASSEMBLER_DEV_MODE != "true".) Set
        // ASSEMBLER_ALLOWED_URL_HOSTS in production for a positive allowlist.
        if let Some(host) = parsed.host_str() {
            let literal = host.trim_start_matches('[').trim_end_matches(']');
            if let Ok(ip) = literal.parse::<std::net::IpAddr>() {
                let blocked = match ip {
                    std::net::IpAddr::V4(v4) => {
                        v4.is_private() || v4.is_loopback() || v4.is_link_local()
                    }
                    std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
                };
                if blocked {
                    return Err(ApiError::invalid("URL host is not allowed"));
                }
            }
        }
    }
    Ok(())
}
