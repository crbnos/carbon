// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";

const logger = getLogger("server-functions");

/** `message` is empty when the failure came from the data layer, so raw
 *  constraint text never reaches a toast. `body` carries structured extras. */
export class ServerFnError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(
    message: string,
    status = 500,
    body: Record<string, unknown> = {},
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = new.target.name;
    this.status = status;
    this.body = body;
  }
}

export class InvalidInputError extends ServerFnError {
  constructor(message: string, body?: Record<string, unknown>) {
    super(message, 400, body);
  }
}

export class ForbiddenError extends ServerFnError {
  constructor(message = "Insufficient permissions") {
    super(message, 403);
  }
}

export class NotFoundError extends ServerFnError {
  constructor(message: string) {
    super(message, 404);
  }
}

/** SQLSTATE of a plpgsql `RAISE EXCEPTION`: a message our own SQL wrote for
 *  the person (e.g. "Job J000343 has 6 serial unit(s) left to receive…"). */
export const RAISED_EXCEPTION = "P0001";

/** SQLSTATE classes that are the server's failure, never the request's:
 *  connection, transaction rollback (deadlock, serialization), insufficient
 *  resources, operator intervention, system, internal. */
const SERVER_SQLSTATE_CLASSES = new Set(["08", "40", "53", "57", "58", "XX"]);

/** The plain `Error`s `pg` and `pg-pool` throw when the database cannot be
 *  reached or stops answering. */
const CONNECTION_FAILURES = new Set([
  "timeout exceeded when trying to connect",
  "timeout expired",
  "Connection terminated",
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
  "Cannot use a pool after calling end on the pool",
  "Client has encountered a connection error and is not queryable",
  "Client was closed and is not queryable",
  "Query read timeout",
  "The server does not support SSL connections",
  "There was an error establishing an SSL connection"
]);

/**
 * A failure of the database or the network under it, not of the request: a
 * Node system error (`connect ECONNREFUSED 10.0.0.5:5432`), a `pg` connection
 * failure, a SQLSTATE of a server class, or Kysely's `NoResultError` (a
 * `…OrThrow` read our code expected to find a row). Its text is for the log.
 */
export function isServerFailure(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  // Node's system errors (ECONNREFUSED, ETIMEDOUT, ENOTFOUND, …) name their syscall.
  if (typeof e.syscall === "string") return true;
  // A connect to every address of a host failing at once.
  if (err instanceof AggregateError) return err.errors.some(isServerFailure);
  if (typeof e.code === "string" && typeof e.severity === "string") {
    return SERVER_SQLSTATE_CLASSES.has(e.code.slice(0, 2));
  }
  if (!(err instanceof Error)) return false;
  // Kysely's NoResultError keeps the default name; its query node marks it.
  if (err.message === "no result" && "node" in err) return true;
  return CONNECTION_FAILURES.has(err.message);
}

/** Structural (plus `pg`'s fixed connection messages): an authored message
 *  naming a table is still shown. */
export function isDataLayerError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e.code === RAISED_EXCEPTION) return false;
  if (isServerFailure(err)) return true;
  // supabase-js PostgrestError: exactly these documented keys.
  if (
    typeof e.code === "string" &&
    "details" in e &&
    "hint" in e &&
    "message" in e
  ) {
    return true;
  }
  // node-postgres DatabaseError (SQLSTATE plus protocol fields), thrown by Kysely.
  return typeof e.code === "string" && typeof e.severity === "string";
}

type ZodLikeError = {
  name: "ZodError";
  issues: Array<{ path?: unknown[]; message?: unknown }>;
};

function isZodError(err: unknown): err is ZodLikeError {
  const e = err as { name?: unknown; issues?: unknown } | null;
  return e?.name === "ZodError" && Array.isArray(e.issues);
}

function summarizeIssues({ issues }: ZodLikeError): string {
  const shown = issues.slice(0, 5).map(({ path, message }) => {
    const text = typeof message === "string" ? message : "invalid";
    return Array.isArray(path) && path.length > 0
      ? `${path.join(".")}: ${text}`
      : text;
  });
  const more = issues.length - shown.length;
  return `Invalid input — ${shown.join("; ")}${more > 0 ? `; +${more} more` : ""}`;
}

export function toServerFnError(
  name: string,
  err: unknown,
  defaultStatus = 500
): ServerFnError {
  const error = toError(err, defaultStatus);
  // A refusal the caller caused (bad input, missing record, no permission) is
  // expected traffic; only a server failure is an error.
  if (error.status >= 500) logger.error("{name} failed", { name, error: err });
  else logger.warn(`${name} refused`, { status: error.status, error: err });
  return error;
}

/** A defect, not a refusal: its message is about our code, never the caller's. */
const PROGRAMMING_ERRORS = [TypeError, ReferenceError, RangeError, SyntaxError];

/**
 * A failure that is ours keeps its status and loses its message (logged by
 * `toServerFnError`): a programming error, or a thrown status of 500 or
 * more. A server failure ({@link isServerFailure}) is a 500 with no message,
 * whatever `defaultStatus` says. Any other plain `Error` with no status of its
 * own is an authored refusal and keeps its message at `defaultStatus`, as the
 * engines rely on.
 */
function toError(err: unknown, defaultStatus: number): ServerFnError {
  // The blanked error keeps the original as its `cause`: callers never see
  // it, but the log and an operator's own report can.
  if (err instanceof ServerFnError) {
    return err.status >= 500 && err.message
      ? new ServerFnError("", err.status, err.body, { cause: err })
      : err;
  }
  if (isZodError(err)) return new InvalidInputError(summarizeIssues(err));
  if (
    PROGRAMMING_ERRORS.some((type) => err instanceof type) ||
    isServerFailure(err)
  ) {
    return new ServerFnError("", 500, {}, { cause: err });
  }

  const { status, message } = (err ?? {}) as {
    status?: unknown;
    message?: unknown;
  };
  if (isHttpErrorStatus(status) && status >= 500) {
    return new ServerFnError("", status, {}, { cause: err });
  }
  const text = typeof err === "string" ? err : message;
  return new ServerFnError(
    typeof text === "string" && !isDataLayerError(err) ? text : "",
    isHttpErrorStatus(status) ? status : defaultStatus
  );
}

function isHttpErrorStatus(status: unknown): status is number {
  return (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
  );
}
