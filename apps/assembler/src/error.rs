//! Error contract — `{ok:false, error, code}` with the status codes from
//! `app/errors.py` / `app/main.py`.

use axum::{http::StatusCode, response::IntoResponse, Json};
use serde_json::json;

pub struct ApiError {
    pub status: u16,
    pub code: String,
    pub message: String,
}

impl ApiError {
    pub fn new(status: u16, code: &str, message: impl Into<String>) -> Self {
        ApiError {
            status,
            code: code.to_string(),
            message: message.into(),
        }
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        ApiError::new(400, "INVALID_INPUT", message)
    }
    pub fn unauthorized(message: impl Into<String>) -> Self {
        ApiError::new(401, "UNAUTHORIZED", message)
    }
}

impl From<converter::convert::ConvertError> for ApiError {
    fn from(e: converter::convert::ConvertError) -> Self {
        let status = match e.code.as_str() {
            "READ_FAILED" => 422,
            "TESSELLATION_FAILED" => 500,
            "UPLOAD_FAILED" => 502,
            "INVALID_INPUT" => 400,
            "LIMIT_EXCEEDED" => 413,
            "BUSY" => 429,
            _ => 500,
        };
        ApiError::new(status, &e.code, e.message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let mut resp = (
            status,
            Json(json!({"ok": false, "error": self.message, "code": self.code})),
        )
            .into_response();
        // 429s tell callers when to come back so their retries don't hammer
        // the concurrency semaphore (the app honors this with backoff).
        if self.status == 429 {
            resp.headers_mut()
                .insert("Retry-After", axum::http::HeaderValue::from_static("15"));
        }
        resp
    }
}
