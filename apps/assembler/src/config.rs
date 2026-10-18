// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Operational limits + URL policy — port of `app/config.py` + `_validate_url`.

use crate::error::ApiError;

// Fixed, sane defaults — deliberately NOT env-tunable. Every knob here had a
// plausible-sounding env var and no deployment that ever needed a different
// value; unused knobs are just misconfiguration surface. Revisit a constant
// when a real deployment proves it wrong, not before.

/// The tessellation every nodeId derives from. nodeIds hash the tessellated
/// vertex positions, so convert's graph.json and plan's plan.json must use the
/// same one or their nodeIds disagree. 0.5 rad is what every stored plan used.
pub const TESSELLATION_LINEAR: f64 = 0.1;
pub const TESSELLATION_ANGULAR: f64 = 0.5;

/// Max source-download size: unlimited. The download streams to a temp file and
/// the storage bucket already bounds upload size — no in-service cap.
pub fn max_source_bytes() -> usize {
    0
}

/// Assembly part-instance ceiling (guards the planner's O(parts²) sweeps).
pub fn max_parts() -> usize {
    5000
}

/// How long shutdown waits for running tasks after the HTTP listener drains.
/// Matches the orchestrator's termination grace period.
pub fn shutdown_grace() -> std::time::Duration {
    std::time::Duration::from_secs(600)
}

/// Convert result-cache budget, on disk under [`cache_dir`]. Off on Lambda: a
/// worker invocation runs one job, and its /tmp is small and also holds the
/// downloaded source.
pub fn cache_bytes() -> u64 {
    if std::env::var("AWS_LAMBDA_FUNCTION_NAME").is_ok() {
        0
    } else {
        2 * 1024 * 1024 * 1024
    }
}

pub fn cache_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("asm-cache")
}

/// Wall-clock budget (seconds) for the optimize simplify ladder. When active, a
/// job running past it jumps straight to the coarsest rung instead of grinding
/// every middle pass. Auto-derived: 720s on Lambda (lands under the 900s hard
/// timeout), unbounded elsewhere (the standing service has no cap). Per-request
/// `quality.time_budget_secs` overrides.
pub fn optimize_budget_secs() -> Option<u64> {
    std::env::var("AWS_LAMBDA_FUNCTION_NAME")
        .is_ok()
        .then_some(720)
}

/// Redis URL for the shared job/result store. REQUIRED — the store refuses to
/// boot without it (see `JobStore::from_env`); job state must be shared so any
/// replica / Lambda invocation can answer a poll. One `REDIS_URL` for the
/// (prod, where the assembler's Redis must be reachable from Lambda and may
/// differ from the app's), falling back to the stack-wide `REDIS_URL` so local
/// dev reuses the crbn stack's Redis with zero extra config.
pub fn redis_url() -> Option<String> {
    std::env::var("REDIS_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// TTL (seconds) for a Redis job-status entry — long enough to outlive any poll
/// window, short enough that abandoned jobs self-evict. Default 24h.
pub fn job_ttl_secs() -> u64 {
    86400
}

/// TTL (seconds) for a Redis content-hash result-pointer entry. Default 24h.
pub fn result_ttl_secs() -> u64 {
    86400
}

/// Server-side cap on the `?wait=` long-poll hold (seconds). Kept under typical
/// proxy/LB idle timeouts so a held request never trips them.
pub fn max_long_poll_secs() -> u64 {
    25
}

/// Cap on tokio's blocking pool — the CPU half of admission (`admission.rs` is
/// the memory half). OCCT scales to ~core count; beyond that extra blocking
/// threads just oversubscribe (c=64 measured: p99 7.2s uncapped). Excess
/// spawn_blocking tasks queue inside the pool, so overload degrades to waiting,
/// never to 429s. +2 headroom keeps tokio::fs ops from starving behind long
/// converts.
pub fn blocking_threads() -> usize {
    let cores = std::thread::available_parallelism().map_or(8, |n| n.get());
    (cores + 2).max(2)
}

/// How many downloaded sources may sit on disk at once (see `source.rs`): one
/// per compute the blocking pool can run, so a queue past it waits without a
/// file of its own.
pub fn source_slots() -> usize {
    blocking_threads()
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
    if require_https() {
        // Not dev mode: default-deny SSRF against internal targets by rejecting
        // private/loopback/link-local IP literals. Sufficient because every URL
        // reaching here was minted by our own bearer-authenticated jobs layer —
        // a positive hostname allowlist added config surface, not security.
        if let Some(host) = parsed.host_str() {
            let literal = host.trim_start_matches('[').trim_end_matches(']');
            if let Ok(ip) = literal.parse::<std::net::IpAddr>() {
                if !is_public_ip(ip) {
                    return Err(ApiError::invalid("URL host is not allowed"));
                }
            }
        }
    }
    Ok(())
}

/// Whether an address is on the public internet: not loopback, private,
/// link-local, unspecified, broadcast, CGNAT (100.64/10) or IPv6 unique-local,
/// and an IPv4-mapped IPv6 address is judged as the IPv4 it maps.
pub fn is_public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || a == 0
                || (a == 100 && (64..128).contains(&b)))
        }
        std::net::IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_ip(std::net::IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || (first & 0xfe00) == 0xfc00 // unique local, fc00::/7
                || (first & 0xffc0) == 0xfe80) // link local, fe80::/10
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_public_ip;

    #[test]
    fn only_public_addresses_pass() {
        for blocked in [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254",
            "0.0.0.0", "100.64.0.1", "255.255.255.255", "::1", "::", "fd00::1",
            "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
        ] {
            assert!(!is_public_ip(blocked.parse().unwrap()), "{blocked}");
        }
        for public in ["8.8.8.8", "100.128.0.1", "2606:4700::1111", "::ffff:1.1.1.1"] {
            assert!(is_public_ip(public.parse().unwrap()), "{public}");
        }
    }
}
