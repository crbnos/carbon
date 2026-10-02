// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/mes-core";
import { HEADERS, serverSpeaksApiVersion } from "@carbon/mes-core";

/**
 * Every failure the app can get from `/api/v1`, in one shape, plus the two
 * decisions the rest of the app makes from it: may this be retried with the
 * SAME idempotency key, and is this server simply too old to talk to.
 */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | "server_too_old" | "network",
    message: string,
    readonly fields?: Record<string, string[]>,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export function networkError(message = "No connection"): ApiClientError {
  return new ApiClientError(0, "network", message);
}

export function serverTooOld(): ApiClientError {
  return new ApiClientError(
    0,
    "server_too_old",
    "This Carbon server needs an update before the app can sign in"
  );
}

type ErrorBody = {
  error?: {
    code?: string;
    message?: string;
    fields?: unknown;
    details?: unknown;
  };
};

/**
 * Turn a non-2xx response into an `ApiClientError`.
 *
 * `path` matters for one case: a 404 from `auth/code` means the server predates
 * the mobile API entirely, which is a different message from "not found".
 */
export function mapErrorResponse(
  status: number,
  body: unknown,
  headers: { get(name: string): string | null },
  path: string
): ApiClientError {
  if (status === 404 && path.includes("auth/code")) return serverTooOld();

  // A server that does not announce a version we speak cannot be trusted to
  // answer the rest of the API, whatever this particular status was.
  if (!serverSpeaksApiVersion(headers.get(HEADERS.apiVersions))) {
    return serverTooOld();
  }

  const parsed = (body ?? {}) as ErrorBody;
  const code = (parsed.error?.code ?? "internal") as ApiErrorCode;
  const message =
    parsed.error?.message ?? "Something went wrong. Try again in a moment.";
  const fields =
    parsed.error?.fields && typeof parsed.error.fields === "object"
      ? (parsed.error.fields as Record<string, string[]>)
      : undefined;

  return new ApiClientError(
    status,
    code,
    message,
    fields,
    parsed.error?.details
  );
}

/**
 * May the outbox resend this with the SAME idempotency key?
 *
 * Only when the command provably did NOT run, or the server de-duplicates it:
 *   - a network failure or timeout — the request may never have arrived;
 *   - `503 retry_later` — the server refused before running anything;
 *   - `409 request_in_progress` — the first attempt is still running.
 *
 * Everything else, a stored 5xx included, needs a NEW key, which only the
 * operator's own Retry creates. That is what stops a partly-applied command
 * from being re-run (`.ai/lessons.md`: "Retrying a 5xx from a non-idempotent
 * Edge Function multiplies its side effects").
 */
export function isRetrySameKey(err: ApiClientError): boolean {
  if (err.code === "network") return true;
  if (err.status === 503 && err.code === "retry_later") return true;
  if (err.status === 409 && err.code === "request_in_progress") return true;
  return false;
}

/** The session needs refreshing once, then the call can be repeated. */
export function isExpiredSession(err: ApiClientError): boolean {
  return err.status === 401 && err.code === "token_expired";
}

/** The operator must pin in again on a shared tablet. */
export function isOperatorExpired(err: ApiClientError): boolean {
  return err.status === 401 && err.code === "operator_expired";
}

/** The app build is older than this server will talk to. */
export function needsAppUpdate(err: ApiClientError): boolean {
  return err.status === 426 || err.code === "update_required";
}

export function isServerTooOld(err: ApiClientError): boolean {
  return err.code === "server_too_old";
}
