// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Attributes,
  context,
  createContextKey,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import {
  defaultResource,
  resourceFromAttributes
} from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  NodeTracerProvider
} from "@opentelemetry/sdk-trace-node";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_URL_QUERY
} from "@opentelemetry/semantic-conventions";
import { waitUntil } from "@vercel/functions";
import type { ServerInstrumentation } from "react-router";
import { redactSearch } from "./redaction";

const REQUEST_SPAN = createContextKey("carbon.request-span");
const PROVIDER = Symbol.for("carbon.tracing.provider");

export type TracingOptions = {
  serviceName: string;
};

/** Off unless an OTLP endpoint is set; the exporter reads `OTEL_*` itself. */
export function createTracing(
  options: TracingOptions
): ServerInstrumentation[] {
  if (
    !process.env.OTEL_EXPORTER_OTLP_ENDPOINT &&
    !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  ) {
    return [];
  }

  const provider = ensureProvider(options.serviceName);
  return [
    routerInstrumentation(trace.getTracer("carbon"), () => {
      // Vercel can suspend the instance once the response is sent; a
      // long-lived server leaves it to the batch timer.
      if (process.env.VERCEL) {
        waitUntil(provider.forceFlush().catch(() => undefined));
      }
    })
  ];
}

// On `globalThis` because Vite re-evaluates this module in dev.
function ensureProvider(serviceName: string): NodeTracerProvider {
  const g = globalThis as Record<PropertyKey, unknown>;
  const existing = g[PROVIDER] as NodeTracerProvider | undefined;
  if (existing) return existing;

  const provider = new NodeTracerProvider({
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? serviceName,
        [ATTR_SERVICE_VERSION]: process.env.VERCEL_GIT_COMMIT_SHA,
        "deployment.environment.name":
          process.env.VERCEL_ENV ?? process.env.NODE_ENV
      })
    ),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())]
  });
  provider.register();

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new UndiciInstrumentation({
        requireParentforSpans: true,
        startSpanHook: ({ origin, path }) => redactedUrl(origin, path),
        requestHook: (span, { method, origin, path }) => {
          span.updateName(fetchSpanName(method, origin, path));
        }
      })
    ]
  });

  g[PROVIDER] = provider;
  return provider;
}

/** PostgREST calls by table or function; anything else by host, since other paths carry ids. */
export function fetchSpanName(method: string, origin: string, path: string) {
  const pathname = path.split("?")[0] ?? "";
  if (pathname.startsWith("/rest/v1/")) return `${method} ${pathname}`;
  return `${method} ${origin.replace(/^https?:\/\//, "")}`;
}

/** The instrumentation records the query string in both attributes. */
export function redactedUrl(origin: string, path: string) {
  const queryStart = path.indexOf("?");
  const pathname = queryStart === -1 ? path : path.slice(0, queryStart);
  const query = queryStart === -1 ? "" : redactSearch(path.slice(queryStart));
  return {
    [ATTR_URL_FULL]: `${origin}${pathname}${query}`,
    [ATTR_URL_QUERY]: query
  };
}

/** `SELECT item`: the verb and the first table named. */
export function querySpanName(sql: string) {
  const operation =
    sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase() || "QUERY";
  const table = sql.match(/\b(?:from|into|update)\s+(?:"\w+"\.)?"(\w+)"/i)?.[1];
  return table ? `${operation} ${table}` : operation;
}

/** Kysely `log` hook. Kysely reports a query after it ran, so the span is back-dated. */
export function traceQuery(event: {
  level: "query" | "error";
  query: { sql: string };
  queryDurationMillis: number;
  error?: unknown;
}) {
  const endTime = Date.now();
  const span = trace
    .getTracer("carbon")
    .startSpan(querySpanName(event.query.sql), {
      kind: SpanKind.CLIENT,
      startTime: endTime - event.queryDurationMillis,
      attributes: {
        "db.system.name": "postgresql",
        "db.query.text": event.query.sql
      }
    });
  if (event.level === "error") {
    const error =
      event.error instanceof Error
        ? event.error
        : new Error(String(event.error));
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  }
  span.end(endTime);
}

/** No-op when tracing is off or outside a request. */
export function annotateRequestSpan(attributes: Attributes) {
  (context.active().getValue(REQUEST_SPAN) as Span | undefined)?.setAttributes(
    attributes
  );
}

function end(span: Span, error: Error | undefined) {
  if (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  }
  span.end();
}

export function routerInstrumentation(
  tracer: Tracer,
  onRequestEnd?: () => void
): ServerInstrumentation {
  return {
    handler({ instrument }) {
      instrument({
        request(handleRequest, { request }) {
          // Renamed once a route handler reports the matched pattern.
          const span = tracer.startSpan(request.method, {
            kind: SpanKind.SERVER,
            attributes: {
              [ATTR_HTTP_REQUEST_METHOD]: request.method,
              [ATTR_URL_PATH]: new URL(request.url).pathname
            }
          });
          const requestContext = trace
            .setSpan(context.active(), span)
            .setValue(REQUEST_SPAN, span);

          return context.with(requestContext, async () => {
            const { error } = await handleRequest();
            end(span, error);
            onRequestEnd?.();
          });
        }
      });
    },
    route({ id, instrument }) {
      const traced =
        (kind: string) =>
        (
          call: () => Promise<{ error?: Error }>,
          { request, pattern }: { request: { method: string }; pattern: string }
        ) => {
          // React Router's pattern has no leading slash.
          const route = pattern.startsWith("/") ? pattern : `/${pattern}`;
          (context.active().getValue(REQUEST_SPAN) as Span | undefined)
            ?.updateName(`${request.method} ${route}`)
            .setAttribute(ATTR_HTTP_ROUTE, route);

          return tracer.startActiveSpan(`${kind} ${id}`, async (span) => {
            const { error } = await call();
            end(span, error);
          });
        };

      instrument({
        middleware: traced("middleware"),
        loader: traced("loader"),
        action: traced("action")
      });
    }
  };
}
