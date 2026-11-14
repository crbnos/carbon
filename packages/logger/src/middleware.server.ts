// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createId } from "@paralleldrive/cuid2";
import {
  createContext,
  isRouteErrorResponse,
  type MiddlewareFunction,
  type RouterContextProvider
} from "react-router";
import {
  addLogContext,
  getRequestContext,
  isReadRequest,
  requestContextMiddleware,
  requestDetailContext
} from "./context.server";
import { ACCESS_LOG_CATEGORY, getLogger } from "./logger";
import { isSensitiveKey, REDACTED, redactSearch } from "./redaction";
import { annotateRequestSpan } from "./span";

export const REQUEST_ID_HEADER = "x-request-id";

/** Only these carry a body worth logging; GET/HEAD/OPTIONS don't. */
const BODY_LOG_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/**
 * Cap on how large a body we'll buffer for logging. Bounds memory: we require a
 * `content-length` at/under this before reading, so a 120MB CAD upload is never
 * pulled into the log path.
 */
const BODY_LOG_MAX_BYTES = 8 * 1024;

/**
 * Recursively mask values whose key matches a sensitive-field pattern (the same
 * `REDACT_FIELD_PATTERNS` the prod sink's `redactByField` uses: password/token/
 * secret/key/auth/…). The sink-level redactor only runs in prod (JSONL); debug
 * bodies are captured in dev where it's off, so we redact the body value here
 * directly.
 */
function redactBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBody);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redactBody(v);
    }
    return out;
  }
  return value;
}

/**
 * Best-effort capture of a request body for debug logging. Returns a redacted
 * object for JSON / form-urlencoded bodies, a short marker string for skipped
 * ones (multipart, oversized, unknown length), or `undefined` for methods /
 * content-types we don't log. Never throws — a parse failure yields a marker.
 *
 * Reads a clone so the route handler's body stream stays intact.
 */
async function captureRequestBody(request: Request): Promise<unknown> {
  if (!BODY_LOG_METHODS.has(request.method)) return undefined;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return "<multipart form-data not captured>";
  }

  const isJson = contentType.includes("application/json");
  const isForm = contentType.includes("application/x-www-form-urlencoded");
  if (!isJson && !isForm) return undefined;

  // Require a known, bounded length so we never buffer an unbounded stream.
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader === null) return "<unknown length not captured>";
  const length = Number(lengthHeader);
  if (!Number.isFinite(length)) return "<unknown length not captured>";
  if (length > BODY_LOG_MAX_BYTES) return `<${length} bytes not captured>`;
  if (length === 0) return undefined;

  try {
    if (isForm) {
      const form = await request.clone().formData();
      const obj: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) {
        obj[k] = typeof v === "string" ? v : "<file>";
      }
      return redactBody(obj);
    }
    const text = await request.clone().text();
    return redactBody(JSON.parse(text));
  } catch {
    return "<unparseable body>";
  }
}

/** Request-scoped correlation id, readable in loaders/actions via `getRequestId`. */
export const requestIdContext = createContext<string | null>(null);

/**
 * The current request's correlation id: from `context` in a loader or action,
 * or from the ambient request context anywhere else in the request.
 */
export function getRequestId(context?: RouterContextProvider): string | null {
  if (context) return context.get(requestIdContext);
  return getRequestContext(requestIdContext) ?? null;
}

const log = getLogger(ACCESS_LOG_CATEGORY);

/**
 * Assigns a cloud-agnostic request id (an inbound `x-request-id`, else a new
 * one), puts it on every log line of the request and on the response, and
 * writes the access log. Runs inside `requestContextMiddleware`'s scope.
 */
const requestIdMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next
) => {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? createId();
  context.set(requestIdContext, requestId);
  addLogContext({ requestId });

  const { method } = request;
  const { pathname, search } = new URL(request.url);
  const start = performance.now();

  // Before `next()`, while the body stream is untouched.
  const body = log.isEnabledFor("debug")
    ? await captureRequestBody(request)
    : undefined;

  const response = await next();
  annotateRequestSpan({
    "http.response.status_code": response.status,
    "carbon.request_id": requestId,
    // The client left before the response was ready, so a read's queries
    // were cancelled and its status says nothing about the server.
    ...(request.signal.aborted && { "carbon.request.abandoned": true })
  });
  // Debug, so the production `info` default leaves it out.
  const detail = context.get(requestDetailContext);
  log.debug(
    detail
      ? "{method} {pathname} {detail} → {status} in {responseTime}ms"
      : "{method} {pathname} → {status} in {responseTime}ms",
    {
      method,
      pathname,
      ...(detail ? { detail } : {}),
      search: redactSearch(search),
      status: response.status,
      responseTime: performance.now() - start,
      ...(body === undefined ? {} : { body })
    }
  );

  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
};

/**
 * The request scope: the request context, the request id on every log line,
 * and the access log. Register FIRST in an app's root `middleware`, so
 * everything downstream runs inside it.
 */
export const requestMiddleware: MiddlewareFunction<Response> = (args, next) =>
  requestContextMiddleware(
    args,
    () => requestIdMiddleware(args, next) as Promise<Response>
  );

const serverLog = getLogger("logger", "server");

/**
 * React Router's `handleError`: every app's `entry.server.tsx` re-exports it.
 * A thrown `Response` or `data()` is control flow, logged (if at all) by the
 * code that threw it. A read the client abandoned is not a failure; a write
 * that failed after the client left still is. React Router may call it outside
 * the request scope, so the request id is read from `context`.
 */
export function handleServerError(
  error: unknown,
  { request, context }: { request: Request; context?: RouterContextProvider }
): void {
  if (error instanceof Response || isRouteErrorResponse(error)) return;
  if (request.signal.aborted && isReadRequest(request)) return;
  const { pathname } = new URL(request.url);
  serverLog.error("Unhandled error in {method} {pathname}", {
    method: request.method,
    pathname,
    requestId: context?.get(requestIdContext) ?? undefined,
    error
  });
}
