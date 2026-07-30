import { withContext } from "@logtape/logtape";
import { DEFAULT_REDACT_FIELDS } from "@logtape/redaction";
import { createId } from "@paralleldrive/cuid2";
import {
  createContext,
  type MiddlewareFunction,
  type RouterContextProvider
} from "react-router";
import { getLogger } from "./logger";

export const REQUEST_ID_HEADER = "x-request-id";

/** Only these carry a body worth logging; GET/HEAD/OPTIONS don't. */
const BODY_LOG_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/**
 * Cap on how large a body we'll buffer for logging. Bounds memory: we require a
 * `content-length` at/under this before reading, so a 120MB CAD upload is never
 * pulled into the log path.
 */
const BODY_LOG_MAX_BYTES = 8 * 1024;
const REDACTED = "[REDACTED]";

/** `DEFAULT_REDACT_FIELDS` entries are `string | RegExp`; match either form. */
function isSensitiveKey(key: string): boolean {
  return DEFAULT_REDACT_FIELDS.some((pattern) =>
    typeof pattern === "string"
      ? key.toLowerCase().includes(pattern.toLowerCase())
      : pattern.test(key)
  );
}

/**
 * Mask sensitive query-param values (`?code=…`, `?token=…`, …) while keeping the
 * rest of the query string readable. Returns "" for a bodyless query.
 */
function redactSearch(search: string): string {
  if (!search || search === "?") return "";
  const params = new URLSearchParams(search);
  let changed = false;
  for (const key of params.keys()) {
    if (isSensitiveKey(key)) {
      params.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? `?${params.toString()}` : search;
}

/**
 * Recursively mask values whose key matches a sensitive-field pattern (the same
 * `DEFAULT_REDACT_FIELDS` LogTape's `redactByField` uses: password/token/secret/
 * key/auth/email/phone/address/…). The sink-level redactor only runs in prod
 * (JSONL); debug bodies are captured in dev where it's off, so we redact the
 * body value here directly.
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

export function getRequestId(context: RouterContextProvider): string | null {
  return context.get(requestIdContext);
}

const log = getLogger("http");

/**
 * Assigns a cloud-agnostic request id (reuses an inbound `x-request-id`, else
 * generates one), echoes it on the response, and runs the rest of the request
 * inside a LogTape implicit-context scope so every `getLogger(...)` call in
 * loaders/actions/services during this request carries `{ requestId }`.
 *
 * Register FIRST in an app's `middleware` array so downstream middleware and
 * handlers run inside the context scope.
 */
export const requestIdMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next
) => {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? createId();
  context.set(requestIdContext, requestId);

  const { method } = request;
  const { pathname, search } = new URL(request.url);
  const start = performance.now();

  // Capture the body only when debug is actually enabled — skips the clone +
  // parse entirely at the prod `info` default. Done before `next()` so the
  // clone happens while the stream is untouched.
  const body = log.isEnabledFor("debug")
    ? await captureRequestBody(request)
    : undefined;

  const response = await withContext({ requestId }, async () => {
    const res = await next();
    // Debug-level so it is visible in dev but filtered by the prod `info`
    // default — the pipeline is observable with zero migrated call sites.
    // Rendered as a Morgan "dev"-style colored line in dev (see
    // http-formatter.ts) and as a structured JSONL record in prod. When a
    // request body was captured, it rides on the same record (`body`).
    log.debug("{method} {pathname} → {status} in {responseTime}ms", {
      method,
      pathname,
      search: redactSearch(search),
      status: res.status,
      responseTime: performance.now() - start,
      ...(body === undefined ? {} : { body })
    });
    return res;
  });

  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
};
