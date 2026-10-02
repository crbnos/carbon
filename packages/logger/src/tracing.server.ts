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
  detectResources,
  envDetector,
  resourceFromAttributes
} from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  type SpanProcessor
} from "@opentelemetry/sdk-trace-node";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
  ATTR_SERVICE_NAME,
  ATTR_URL_FULL,
  ATTR_URL_PATH,
  ATTR_URL_QUERY
} from "@opentelemetry/semantic-conventions";
import type { ServerInstrumentation } from "react-router";
import { REDACTED, redactSearch } from "./redaction";

const REQUEST_SPAN = createContextKey("carbon.request-span");
const PROVIDER = Symbol.for("carbon.tracing.provider");

// Everything below is inert unless an OTLP endpoint is configured.
const enabled = Boolean(
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
);

export type TracingOptions = {
  serviceName: string;
  /**
   * For hosts that suspend the process once a response is sent: called after
   * each request with a flush to keep alive. Elsewhere the batch timer exports.
   */
  afterRequest?: (flush: () => Promise<void>) => void;
  /** Extra processors beside the OTLP exporter, e.g. Inngest's. */
  spanProcessors?: SpanProcessor[];
};

export function createTracing({
  serviceName,
  afterRequest,
  spanProcessors = []
}: TracingOptions): ServerInstrumentation[] {
  if (!enabled) return [];

  const provider = ensureProvider(serviceName, spanProcessors);
  const flush = () => provider.forceFlush().catch(() => undefined);
  return [
    routerInstrumentation(
      trace.getTracer("carbon"),
      afterRequest && (() => afterRequest(flush))
    )
  ];
}

// On `globalThis` because Vite re-evaluates this module in dev.
function ensureProvider(
  serviceName: string,
  spanProcessors: SpanProcessor[]
): NodeTracerProvider {
  const g = globalThis as Record<PropertyKey, unknown>;
  const existing = g[PROVIDER] as NodeTracerProvider | undefined;
  if (existing) return existing;

  const provider = new NodeTracerProvider({
    // OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES override the default.
    resource: defaultResource()
      .merge(resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }))
      .merge(detectResources({ detectors: [envDetector] })),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter()),
      ...spanProcessors
    ]
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

const STORAGE_OPERATIONS: [prefix: string, operation: string][] = [
  ["object/list", "list"],
  ["object/info", "info"],
  ["object/sign", "sign"],
  ["object/upload/sign", "sign upload"],
  ["object/copy", "copy"],
  ["object/move", "move"],
  ["render", "transform"],
  ["bucket", "bucket"]
];

const STORAGE_OBJECT_METHODS: Record<string, string> = {
  GET: "download",
  HEAD: "exists",
  DELETE: "delete"
};

function storageOperation(method: string, rest: string) {
  const named = STORAGE_OPERATIONS.find(([prefix]) => rest.startsWith(prefix));
  return named?.[1] ?? STORAGE_OBJECT_METHODS[method] ?? "upload";
}

/**
 * Supabase calls by what they do (`GET /rest/v1/item`, `storage download`,
 * `auth GET user`, `function get-method`); anything else by host. Names stay
 * free of ids, bucket names and file paths, which are on `url.path`.
 */
export function fetchSpanName(method: string, origin: string, path: string) {
  const pathname = path.split("?")[0] ?? "";
  if (pathname.startsWith("/rest/v1/")) return `${method} ${pathname}`;

  const [, service, rest = ""] =
    pathname.match(/^\/(storage|auth|functions)\/v1\/(.*)$/) ?? [];
  if (service === "storage") {
    return `storage ${storageOperation(method, rest)}`;
  }
  if (service === "functions") return `function ${rest.split("/")[0]}`;
  if (service === "auth") {
    // Leading lowercase words only: `admin/users/<uuid>` is `admin/users`.
    const segments = rest.split("/");
    const end = segments.findIndex((segment) => !/^[a-z_]+$/.test(segment));
    const words = segments.slice(0, end === -1 ? 2 : Math.min(end, 2));
    return `auth ${method} ${words.join("/")}`;
  }

  return `${method} ${origin.replace(/^https?:\/\//, "")}`;
}

/**
 * React Router reports a middleware by its route alone, so four root
 * middleware are four spans named `middleware root`. Wrapping the list names
 * each span after its function.
 */
export function namedMiddleware<
  Middleware extends (...args: never[]) => unknown
>(middleware: Middleware[]): Middleware[] {
  if (!enabled) return middleware;
  return middleware.map(
    (run) =>
      ((...args) => {
        if (run.name)
          trace.getActiveSpan()?.updateName(`middleware ${run.name}`);
        return run(...args);
      }) as Middleware
  );
}

// Inngest's event API takes the event key as a path segment (`POST /e/<key>`),
// so the path is a secret there and must not reach the trace backend. A
// configured base URL may carry a path prefix (`/prefix/e/<key>`).
const INNGEST_EVENT_PATH = /\/e\/[^/]+/;

function originOf(url: string | undefined) {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isInngestEventApi(origin: string) {
  const configured = [
    process.env.INNGEST_EVENT_API_BASE_URL,
    process.env.INNGEST_BASE_URL
  ].map(originOf);
  return origin === "https://inn.gs" || configured.includes(origin);
}

/** The instrumentation records the path and the query string unredacted. */
export function redactedUrl(origin: string, path: string) {
  const queryStart = path.indexOf("?");
  const rawPathname = queryStart === -1 ? path : path.slice(0, queryStart);
  const pathname = isInngestEventApi(origin)
    ? rawPathname.replace(INNGEST_EVENT_PATH, `/e/${REDACTED}`)
    : rawPathname;
  const query = queryStart === -1 ? "" : redactSearch(path.slice(queryStart));
  return {
    [ATTR_URL_FULL]: `${origin}${pathname}${query}`,
    [ATTR_URL_PATH]: pathname,
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
function traceQuery(event: {
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

/** Pass as Kysely's `log`; undefined when tracing is off, so Kysely installs no hook. */
export const queryLog = enabled ? traceQuery : undefined;

/** No-op when tracing is off or outside a request. */
export function annotateRequestSpan(attributes: Attributes) {
  if (!enabled) return;
  (context.active().getValue(REQUEST_SPAN) as Span | undefined)?.setAttributes(
    attributes
  );
}

/**
 * For a route that serves many things on one path (`/api/inngest`, `/api/mcp`):
 * say which one in the request span's name. Keep it to a bounded set of values.
 */
export function nameRequestSpan(name: string) {
  if (!enabled) return;
  (context.active().getValue(REQUEST_SPAN) as Span | undefined)?.updateName(
    name
  );
}

function end(span: Span, error: Error | undefined) {
  if (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  }
  span.end();
}

/** Runs `run` in a child span of whatever is active; a plain call when tracing is off. */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  run: () => Promise<T>
): Promise<T> {
  if (!enabled) return run();
  return trace
    .getTracer("carbon")
    .startActiveSpan(name, { attributes }, async (span) => {
      try {
        const result = await run();
        span.end();
        return result;
      } catch (error) {
        end(span, error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    });
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
