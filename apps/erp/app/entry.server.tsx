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
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    // @ts-expect-error
    _loadContext // Vercel's handler still expecting AppLoadContext type
  );
}
