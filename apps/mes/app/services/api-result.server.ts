// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The one result shape the extracted MES server code returns, so a web route
 * and an API endpoint can each render the SAME outcome in their own idiom.
 *
 * The web routes keep returning exactly the redirects, flashes and `data()`
 * bodies they return today; the API maps `kind` to a status code. Nothing in a
 * moved route body changes — that is the whole point, because the extraction is
 * the riskiest step in `.ai/plans/2026-10-02-mes-mobile-app.md` (a behaviour
 * change here reaches every operator on the web MES too).
 */
export type CommandFailure = {
  kind:
    | "validation"
    | "forbidden"
    | "not_found"
    | "conflict"
    /** A sales/storage rule refused it; `details` carries the rule names. */
    | "blocked"
    /** The operator may proceed after confirming; `details` carries what. */
    | "needs_acknowledgement"
    /** The web route throws a redirect for this outcome. */
    | "redirect"
    | "error";
  message: string;
  fields?: Record<string, string[]>;
  redirectTo?: string;
  details?: unknown;
};

export type Ok<T> = { ok: true; data: T };
export type Failed = { ok: false; failure: CommandFailure };
export type CommandResult<T> = Ok<T> | Failed;
export type ScreenResult<T> = CommandResult<T>;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function failed(failure: CommandFailure): Failed {
  return { ok: false, failure };
}

/** The HTTP status each failure kind answers with on `/api/v1`. */
export const FAILURE_STATUS: Record<CommandFailure["kind"], number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  blocked: 409,
  needs_acknowledgement: 409,
  // A redirect is how a web loader reports "you cannot be here, and here is
  // where you belong" — the floor gate, a missing operation, an operation of
  // another type. For an API caller that is a state conflict, and the message
  // is the one the operator would have seen on the web.
  redirect: 409,
  error: 500
};
