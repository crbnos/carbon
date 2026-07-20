//! Where the compute for a created job runs.
//!
//! `Local` (default): `tokio::spawn` in this process — correct for the ECS
//! service, local dev, and the CLI, where the process outlives the request.
//!
//! `Lambda` (auto-detected via `AWS_LAMBDA_FUNCTION_NAME`): an instance FREEZES after the
//! HTTP response, so an in-process spawn would never finish. Instead the create
//! handler fires the job as a separate **Event-type self-invocation** of this
//! same function (own 900s window). The Lambda Web Adapter delivers that
//! non-HTTP event to `POST /events` (`AWS_LWA_PASS_THROUGH_PATH`), where the
//! worker runs the exact `spawn` + `run_to_completion` path the CLI uses, and
//! job state flows through the shared Redis `JobStore` so any instance's poll
//! can answer. Requires `lambda:InvokeFunction` on itself (exec role) and
//! `REDIS_URL` (a Memory store is invisible across instances).
//!
//! The Invoke call is SigV4-signed by hand: it is a single fixed-shape POST,
//! the aws-sdk dependency tree needs a newer rustc than this workspace pins,
//! and inside Lambda the credentials are simply env vars — no chain needed.

use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, PartialEq)]
pub enum Dispatch {
    Local,
    Lambda,
}

/// Auto-detected: the Lambda runtime always sets `AWS_LAMBDA_FUNCTION_NAME`,
/// and there is no legitimate cross-configuration (local dispatch inside Lambda
/// dies at the post-response freeze; lambda dispatch outside has no invoke
/// permission). Deriving it removes the knob AND its failure mode.
pub fn from_env() -> Dispatch {
    if std::env::var("AWS_LAMBDA_FUNCTION_NAME").is_ok() {
        Dispatch::Lambda
    } else {
        Dispatch::Local
    }
}

/// Fire-and-forget the job spec at this same function (`X-Amz-Invocation-Type:
/// Event` → 202 + async retry semantics). Errors bubble to the create handler,
/// which fails the job loudly — a spec that was never dispatched must not sit
/// "pending" forever.
pub async fn self_invoke(spec: &Value) -> Result<(), String> {
    let env = |k: &str| std::env::var(k).map_err(|_| format!("{k} is not set"));
    let fn_name = env("AWS_LAMBDA_FUNCTION_NAME")?;
    let region = env("AWS_REGION").or_else(|_| env("AWS_DEFAULT_REGION"))?;
    let access_key = env("AWS_ACCESS_KEY_ID")?;
    let secret_key = env("AWS_SECRET_ACCESS_KEY")?;
    let session_token = std::env::var("AWS_SESSION_TOKEN").ok();

    let host = format!("lambda.{region}.amazonaws.com");
    let path = format!("/2015-03-31/functions/{fn_name}/invocations");
    let body = spec.to_string();
    let (amz_date, date) = amz_timestamp();
    let payload_hash = hex::encode(Sha256::digest(body.as_bytes()));

    // Canonical request: sorted lowercase headers; no query string.
    let mut headers: Vec<(String, String)> = vec![
        ("content-type".into(), "application/json".into()),
        ("host".into(), host.clone()),
        ("x-amz-date".into(), amz_date.clone()),
        ("x-amz-invocation-type".into(), "Event".into()),
    ];
    if let Some(t) = &session_token {
        headers.push(("x-amz-security-token".into(), t.clone()));
    }
    headers.sort();
    let canonical_headers: String = headers
        .iter()
        .map(|(k, v)| format!("{k}:{}\n", v.trim()))
        .collect();
    let signed_headers = headers
        .iter()
        .map(|(k, _)| k.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_request =
        format!("POST\n{path}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}");

    let scope = format!("{date}/{region}/lambda/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );
    let k_date = hmac_sha256(format!("AWS4{secret_key}").as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, b"lambda");
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );

    let client = reqwest::Client::new();
    let mut req = client
        .post(format!("https://{host}{path}"))
        .header("content-type", "application/json")
        .header("x-amz-date", &amz_date)
        .header("x-amz-invocation-type", "Event")
        .header("authorization", authorization)
        .body(body);
    if let Some(t) = &session_token {
        req = req.header("x-amz-security-token", t);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("lambda invoke request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("lambda invoke returned {status}: {text}"));
    }
    Ok(())
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// Current UTC time as SigV4's (`YYYYMMDD'T'HHMMSS'Z'`, `YYYYMMDD`). Civil-date
/// math (Hinnant's algorithm) instead of a chrono/time dependency.
fn amz_timestamp() -> (String, String) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock before epoch")
        .as_secs() as i64;
    let days = secs.div_euclid(86400);
    let sod = secs.rem_euclid(86400);
    let (h, mi, s) = (sod / 3600, (sod % 3600) / 60, sod % 60);

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    let date = format!("{y:04}{m:02}{d:02}");
    (format!("{date}T{h:02}{mi:02}{s:02}Z"), date)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Signing-key derivation checked against the worked example in AWS's SigV4
    // documentation (the canonical "AWS4-HMAC-SHA256" example secret + scope).
    #[test]
    fn sigv4_signing_key_matches_aws_example() {
        let secret = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
        let k_date = hmac_sha256(format!("AWS4{secret}").as_bytes(), b"20150830");
        let k_region = hmac_sha256(&k_date, b"us-east-1");
        let k_service = hmac_sha256(&k_region, b"iam");
        let k_signing = hmac_sha256(&k_service, b"aws4_request");
        assert_eq!(
            hex::encode(k_signing),
            "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9"
        );
    }

    #[test]
    fn timestamp_shape() {
        let (ts, d) = amz_timestamp();
        assert_eq!(ts.len(), 16);
        assert!(ts.ends_with('Z') && ts.as_bytes()[8] == b'T');
        assert_eq!(&ts[..8], d.as_str());
    }
}
