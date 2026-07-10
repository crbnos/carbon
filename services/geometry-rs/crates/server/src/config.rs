//! Operational limits + URL policy — port of `app/config.py` + `_validate_url`.

use crate::error::ApiError;

fn int_env(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|s| s.parse().ok()).unwrap_or(default)
}

pub fn max_source_bytes() -> usize {
    int_env("GEOMETRY_MAX_SOURCE_MB", 250) * 1024 * 1024
}

pub fn max_parts() -> usize {
    int_env("GEOMETRY_MAX_PARTS", 5000)
}

pub fn max_concurrency() -> usize {
    int_env("GEOMETRY_MAX_CONCURRENCY", 2).max(1)
}

pub fn allowed_url_hosts() -> Vec<String> {
    std::env::var("GEOMETRY_ALLOWED_URL_HOSTS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn require_https() -> bool {
    std::env::var("GEOMETRY_DEV_MODE").as_deref() != Ok("true")
}

pub fn verify_tls() -> bool {
    std::env::var("GEOMETRY_DEV_MODE").as_deref() != Ok("true")
}

pub fn validate_url(url: &str) -> Result<(), ApiError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| ApiError::invalid("invalid URL"))?;
    let scheme = parsed.scheme();
    if require_https() && scheme != "https" {
        return Err(ApiError::invalid("URLs must use https"));
    }
    if scheme != "http" && scheme != "https" {
        return Err(ApiError::invalid(format!("unsupported URL scheme: {scheme}")));
    }
    let allowed = allowed_url_hosts();
    if !allowed.is_empty() {
        let host = parsed.host_str().unwrap_or("").to_lowercase();
        if !allowed.contains(&host) {
            return Err(ApiError::invalid("URL host is not allowed"));
        }
    }
    Ok(())
}
