import { getLogger } from "@carbon/logger";
import { ensureLoggingConfigured } from "@carbon/logger/config.server";
import { getRequestId } from "@carbon/logger/middleware.server";
import { handleRequest as vercelHandleRequest } from "@vercel/react-router/entry.server";
import type { EntryContext, RouterContextProvider } from "react-router";
import { isRouteErrorResponse } from "react-router";

ensureLoggingConfigured();

const log = getLogger("erp");

// Process-level safety net: errors that escape the request lifecycle entirely
// (background promises, timers, event emitters) never reach React Router's
// `handleError`, so without this they crash or vanish with no context. Log them
// with a stack. Guarded on a global so HMR/re-import doesn't stack duplicate
// listeners (which would trip Node's MaxListeners warning).
const globalForProcessHandlers = globalThis as typeof globalThis & {
  __carbonProcessErrorHandlers?: boolean;
};
if (
  typeof process !== "undefined" &&
  !globalForProcessHandlers.__carbonProcessErrorHandlers
) {
  globalForProcessHandlers.__carbonProcessErrorHandlers = true;
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection: {message}", {
      message: reason instanceof Error ? reason.message : String(reason),
      error: reason
    });
  });
  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception: {message}", {
      message: error.message,
      error
    });
    // An uncaught exception leaves the process in an undefined, possibly
    // corrupted state. These apps are long-lived services, so we exit and let
    // the supervisor restart a clean worker rather than serving from a broken
    // one. (unhandledRejection is left log-only: a stray rejection is usually
    // recoverable and crashing the whole server on each one is worse.)
    process.exit(1);
  });
}

export const streamTimeout = 60_000;

// Baseline security response headers (NIST 800-171 3.13.13 control-of-mobile-code
// + SC-7/SC-8 hardening). The CSP is a deliberately SAFE SUBSET: it omits
// default-src/script-src so it cannot break the SPA's script/style/connect
// loading, and sets only mobile-code / injection-vector controls — object-src
// 'none' (no plugins), base-uri 'self', frame-ancestors 'self' (no cross-origin
// framing/clickjacking while still allowing same-origin embeds like previews).
const BASELINE_CSP_DIRECTIVES = [
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'"
];

// Compose the baseline CSP with any route-set policy rather than replacing it:
// a route may attach its own directives (script-src with a nonce/hash, etc.)
// that must survive. Keep the route's policy intact and append only the
// baseline directives it omits (matched by directive name).
function composeContentSecurityPolicy(existing: string | null): string {
  if (!existing?.trim()) return BASELINE_CSP_DIRECTIVES.join("; ");
  const present = new Set(
    existing
      .split(";")
      .map((directive) => directive.trim().split(/\s+/)[0]?.toLowerCase())
      .filter(Boolean)
  );
  const additions = BASELINE_CSP_DIRECTIVES.filter(
    (directive) => !present.has(directive.split(/\s+/)[0].toLowerCase())
  );
  return additions.length
    ? `${existing.replace(/;\s*$/, "")}; ${additions.join("; ")}`
    : existing;
}

function applySecurityHeaders(headers: Headers) {
  headers.set(
    "Content-Security-Policy",
    composeContentSecurityPolicy(headers.get("Content-Security-Policy"))
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
}

/**
 * React Router v7 server error hook: fires with the actual error thrown by any
 * loader/action/render that RR catches — the "why" behind a `GET 500 …` line
 * that the access-log middleware (which only sees the final status) can't.
 *
 * We skip control-flow throws (redirects, and intentional Response throws like
 * 401/403/404 from `requirePermissions`) and client-aborted requests, logging
 * only genuine 5xx server failures. `requestId` correlates with the `[http]`
 * access-log line for the same request.
 */
export function handleError(
  error: unknown,
  {
    request,
    context
  }: { request: Request; params: unknown; context: RouterContextProvider }
) {
  // Client navigated away / cancelled mid-flight — not a real failure.
  if (request.signal.aborted) return;
  // Redirects and intentional Response throws are control flow, not errors.
  if (error instanceof Response && error.status < 500) return;
  if (isRouteErrorResponse(error) && error.status < 500) return;

  const { pathname } = new URL(request.url);
  log.error("Unhandled error in {method} {pathname}: {message}", {
    method: request.method,
    pathname,
    requestId: getRequestId(context),
    message: error instanceof Error ? error.message : String(error),
    error
  });
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider // RouterContextProvider when v8_middleware is turned on
) {
  applySecurityHeaders(responseHeaders);
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    // @ts-expect-error
    _loadContext // Vercel's handler still expecting AppLoadContext type
  );
}
