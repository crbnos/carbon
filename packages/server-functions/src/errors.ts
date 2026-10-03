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
    body: Record<string, unknown> = {}
  ) {
    super(message);
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

/** Structural only: an authored message naming a table is still shown. */
export function isDataLayerError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
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
  if (error.status >= 500) logger.error(`${name} failed`, { error: err });
  else logger.warn(`${name} refused`, { status: error.status, error: err });
  return error;
}

function toError(err: unknown, defaultStatus: number): ServerFnError {
  if (err instanceof ServerFnError) return err;
  if (isZodError(err)) return new InvalidInputError(summarizeIssues(err));

  const { status, message } = (err ?? {}) as {
    status?: unknown;
    message?: unknown;
  };
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
