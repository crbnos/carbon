// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! OpenTelemetry tracing, exported over OTLP/HTTP. Traces only.
//!
//! Inert unless `OTEL_EXPORTER_OTLP_ENDPOINT` (or the traces-specific variant)
//! is set — the same switch as the Node apps (`@carbon/logger`), and the same
//! variables: `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_RESOURCE_ATTRIBUTES`,
//! `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER[_ARG]`. With no provider installed
//! every span below is a no-op.
//!
//! One trace per job: the caller's `traceparent` → the request span → a
//! `job <action>` span → `download source` / `compute` / `upload artifact` /
//! `callback`. The job runs detached from the request (and, on Lambda, in
//! another invocation), so its parent travels explicitly: through the spawn
//! (`spawn_job`) in-process, and through the run-job spec (`inject` / `attach`)
//! across the self-invoke.

use std::collections::HashMap;
use std::future::Future;
use std::sync::OnceLock;

use axum::extract::{MatchedPath, Request};
use axum::middleware::Next;
use axum::response::Response;
use opentelemetry::global::{self, BoxedTracer};
use opentelemetry::trace::{FutureExt, SpanKind, Status, TraceContextExt, Tracer};
use opentelemetry::{Context, ContextGuard, KeyValue};
use opentelemetry_http::{Bytes, HeaderExtractor, HttpClient, HttpError};
use opentelemetry_otlp::{SpanExporter, WithHttpConfig};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use serde_json::Value;

use crate::error::ApiError;

static PROVIDER: OnceLock<SdkTracerProvider> = OnceLock::new();

/// The key the parent context travels under in a run-job spec.
const SPEC_KEY: &str = "traceparent";

fn tracer() -> BoxedTracer {
    global::tracer("assembler")
}

/// Install the exporter. Call once, inside the tokio runtime.
pub fn init() {
    let configured = [
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    ]
    .iter()
    .any(|key| std::env::var(key).is_ok_and(|value| !value.is_empty()));
    if !configured {
        return;
    }
    let exporter = match SpanExporter::builder()
        .with_http()
        .with_http_client(ExportClient::new())
        .build()
    {
        Ok(exporter) => exporter,
        Err(e) => {
            eprintln!("assembler: tracing disabled (exporter: {e})");
            return;
        }
    };
    // OTEL_SERVICE_NAME, when set, wins over the default name.
    let mut resource = Resource::builder();
    if std::env::var_os("OTEL_SERVICE_NAME").is_none() {
        resource = resource.with_service_name("assembler");
    }
    let provider = SdkTracerProvider::builder()
        .with_resource(resource.build())
        .with_batch_exporter(exporter)
        .build();
    global::set_text_map_propagator(TraceContextPropagator::new());
    global::set_tracer_provider(provider.clone());
    let _ = PROVIDER.set(provider);
    eprintln!("assembler: tracing enabled");
}

/// Export what is buffered and stop. For every path that ends the process —
/// `process::exit` runs no destructors.
pub fn shutdown() {
    if let Some(provider) = PROVIDER.get() {
        let _ = provider.shutdown();
    }
}

/// Sends export requests with the reqwest already in the binary. The batch
/// processor calls this from its own thread, outside tokio, so the request is
/// handed to the runtime and awaited from there.
#[derive(Debug)]
struct ExportClient {
    client: reqwest::Client,
    runtime: tokio::runtime::Handle,
}

impl ExportClient {
    fn new() -> Self {
        ExportClient {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("reqwest client"),
            runtime: tokio::runtime::Handle::current(),
        }
    }
}

#[async_trait::async_trait]
impl HttpClient for ExportClient {
    async fn send_bytes(
        &self,
        request: axum::http::Request<Bytes>,
    ) -> Result<axum::http::Response<Bytes>, HttpError> {
        let request = reqwest::Request::try_from(request)?;
        let client = self.client.clone();
        self.runtime
            .spawn(async move {
                let response = client.execute(request).await?;
                let status = response.status();
                let headers = response.headers().clone();
                let mut out = axum::http::Response::new(response.bytes().await?);
                *out.status_mut() = status;
                *out.headers_mut() = headers;
                Ok::<_, HttpError>(out)
            })
            .await?
    }
}

/// A SERVER span per request, continuing the caller's trace. `/health` is the
/// load balancer's probe and is left out.
pub async fn http_span(request: Request, next: Next) -> Response {
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str().to_owned());
    if PROVIDER.get().is_none() || route.as_deref() == Some("/health") {
        return next.run(request).await;
    }
    let parent = global::get_text_map_propagator(|propagator| {
        propagator.extract(&HeaderExtractor(request.headers()))
    });
    let method = request.method().as_str().to_owned();
    // The matched route, never the raw path: an unmatched request must not mint
    // a span name per URL.
    let name = match &route {
        Some(route) => format!("{method} {route}"),
        None => method.clone(),
    };
    let mut attributes = vec![
        KeyValue::new("http.request.method", method),
        KeyValue::new("url.path", request.uri().path().to_owned()),
    ];
    if let Some(route) = route {
        attributes.push(KeyValue::new("http.route", route));
    }
    let tracer = tracer();
    let span = tracer
        .span_builder(name)
        .with_kind(SpanKind::Server)
        .with_attributes(attributes)
        .start_with_context(&tracer, &parent);
    let cx = parent.with_span(span);

    let response = next.run(request).with_context(cx.clone()).await;

    let span = cx.span();
    let status = response.status();
    span.set_attribute(KeyValue::new(
        "http.response.status_code",
        i64::from(status.as_u16()),
    ));
    if status.is_server_error() {
        span.set_status(Status::error(""));
    }
    span.end();
    // Lambda freezes the process once the response is sent; whatever is still
    // in the batch would wait for the next invocation, or be lost.
    if std::env::var_os("AWS_LAMBDA_FUNCTION_NAME").is_some() {
        flush().await;
    }
    response
}

/// How long a Lambda response waits for its spans to be exported. A job poll
/// can already hold for the long-poll cap (25 s), and API Gateway gives the
/// whole request 30 s, so a slow collector must cost a trace, not the response.
const LAMBDA_FLUSH_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

async fn flush() {
    if let Some(provider) = PROVIDER.get() {
        // force_flush blocks until the export thread answers.
        let flushed = tokio::task::spawn_blocking(move || provider.force_flush());
        let _ = tokio::time::timeout(LAMBDA_FLUSH_WAIT, flushed).await;
    }
}

/// `tokio::spawn` for a job: the task gets a `job <action>` span under the
/// current context (the request, or the context `attach` restored), and every
/// span the job starts becomes its child.
pub fn spawn_job<F>(job_id: &str, action: &str, job: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    let tracer = tracer();
    let span = tracer
        .span_builder(format!("job {action}"))
        .with_attributes([
            KeyValue::new("carbon.job.id", job_id.to_owned()),
            KeyValue::new("carbon.job.action", action.to_owned()),
        ])
        .start(&tracer);
    let cx = Context::current_with_span(span);
    tokio::spawn(
        async move {
            job.await;
            Context::current().span().end();
        }
        .with_context(cx),
    );
}

/// Mark the current span failed. Called where a job records its error, so the
/// job span carries the same code and message the caller is given.
pub fn record_error(code: &str, message: &str) {
    let cx = Context::current();
    let span = cx.span();
    span.set_attribute(KeyValue::new("error.type", code.to_owned()));
    span.set_status(Status::error(without_urls(message)));
}

/// Error text quotes the URL that failed, and these URLs are signed. Keep the
/// scheme and host, drop the path and query that carry the signature.
fn without_urls(message: &str) -> String {
    let mut out = String::with_capacity(message.len());
    let mut rest = message;
    while let Some(start) = rest.find("http://").or_else(|| rest.find("https://")) {
        let (before, url) = rest.split_at(start);
        let end = url
            .find(|c: char| c.is_whitespace() || matches!(c, ')' | '"' | '\'' | '>'))
            .unwrap_or(url.len());
        out.push_str(before);
        match reqwest::Url::parse(&url[..end]) {
            Ok(parsed) => out.push_str(&parsed.origin().ascii_serialization()),
            Err(_) => out.push_str("<url>"),
        }
        rest = &url[end..];
    }
    out.push_str(rest);
    out
}

/// Run `work` in a child span of the current one.
pub async fn in_span<T>(name: &'static str, work: impl Future<Output = T>) -> T {
    let tracer = tracer();
    let cx = Context::current_with_span(tracer.start(name));
    let out = work.with_context(cx.clone()).await;
    cx.span().end();
    out
}

/// An outbound request as a CLIENT span. Records the host only: these URLs are
/// signed, and the signature is in the path and query.
pub async fn outbound<T>(
    name: &'static str,
    url: &str,
    request: impl Future<Output = Result<T, ApiError>>,
) -> Result<T, ApiError> {
    let tracer = tracer();
    let mut builder = tracer.span_builder(name).with_kind(SpanKind::Client);
    if let Some(host) = reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
    {
        builder = builder.with_attributes([KeyValue::new("server.address", host)]);
    }
    let cx = Context::current_with_span(builder.start(&tracer));
    let out = request.with_context(cx.clone()).await;
    let span = cx.span();
    if let Err(e) = &out {
        span.set_attribute(KeyValue::new("error.type", e.code.clone()));
        span.set_status(Status::error(without_urls(&e.message)));
    }
    span.end();
    out
}

/// Write the current context into a run-job spec, so the worker invocation
/// that runs it continues this trace.
pub fn inject(spec: &mut Value) {
    let mut carrier = HashMap::new();
    global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&Context::current(), &mut carrier)
    });
    if let Some(traceparent) = carrier.remove(SPEC_KEY) {
        spec[SPEC_KEY] = traceparent.into();
    }
}

/// Make the context a run-job spec carries current until the guard drops. The
/// guard is not `Send`: hold it across the spawn only, never across an await.
pub fn attach(spec: &Value) -> Option<ContextGuard> {
    let traceparent = spec[SPEC_KEY].as_str()?;
    let carrier = HashMap::from([(SPEC_KEY.to_owned(), traceparent.to_owned())]);
    let cx = global::get_text_map_propagator(|propagator| propagator.extract(&carrier));
    Some(cx.attach())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_text_keeps_the_host_and_drops_the_signed_part() {
        assert_eq!(
            without_urls(
                "could not download source: error sending request for url \
                 (https://x.supabase.co/storage/v1/object/sign/private/a.step?token=SECRET)"
            ),
            "could not download source: error sending request for url (https://x.supabase.co)"
        );
        assert_eq!(
            without_urls("PUT http://127.0.0.1:9000/b/k?sig=1 then https://s3.aws/x?y=2 failed"),
            "PUT http://127.0.0.1:9000 then https://s3.aws failed"
        );
        assert_eq!(without_urls("tessellation failed"), "tessellation failed");
    }
    use opentelemetry::trace::{SpanContext, SpanId, TraceFlags, TraceId, TraceState};

    const TRACEPARENT: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    #[test]
    fn a_spec_carries_the_trace_across_the_self_invoke() {
        global::set_text_map_propagator(TraceContextPropagator::new());

        // Nothing to carry: the spec is left alone.
        let mut spec = serde_json::json!({ "action": "convert" });
        inject(&mut spec);
        assert!(spec.get(SPEC_KEY).is_none());
        assert!(attach(&spec).is_none());

        let parent = SpanContext::new(
            TraceId::from_hex("4bf92f3577b34da6a3ce929d0e0e4736").unwrap(),
            SpanId::from_hex("00f067aa0ba902b7").unwrap(),
            TraceFlags::SAMPLED,
            true,
            TraceState::default(),
        );
        {
            let _guard = Context::current().with_remote_span_context(parent).attach();
            inject(&mut spec);
        }
        assert_eq!(spec[SPEC_KEY], TRACEPARENT);

        // The worker side: the spec's context is current while the guard lives.
        let guard = attach(&spec);
        let cx = Context::current();
        let restored = cx.span().span_context().clone();
        assert_eq!(
            restored.trace_id().to_string(),
            "4bf92f3577b34da6a3ce929d0e0e4736"
        );
        assert_eq!(restored.span_id().to_string(), "00f067aa0ba902b7");
        drop(guard);
        assert!(!Context::current().span().span_context().is_valid());
    }
}
