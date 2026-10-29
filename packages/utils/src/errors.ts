// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The message to show for a failed call: the error's own message when it has
 * one, else `fallback`. Server functions leave `message` empty for data-layer
 * failures precisely so the caller's copy wins.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  const message =
    typeof error === "string"
      ? error
      : (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message !== "" ? message : fallback;
}

// Postgres SQLSTATE codes. PostgREST and node-postgres both report them on
// `error.code`, so one check covers a Supabase result and a thrown Kysely error.
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function hasCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null | undefined)?.code === code;
}

/** The write was refused because a unique constraint already holds that row. */
export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, UNIQUE_VIOLATION);
}

/** The write was refused because another record still references the row. */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, FOREIGN_KEY_VIOLATION);
}

/**
 * The message to show for a refused write: the caller's own copy for the
 * constraint Postgres named, else `fallback`. The copy stays at the call site
 * because only the route knows what a duplicate or a reference means there.
 */
export function getDatabaseErrorMessage(
  error: unknown,
  fallback: string,
  messages: { duplicate?: string; referenced?: string }
): string {
  if (isUniqueViolation(error)) return messages.duplicate ?? fallback;
  if (isForeignKeyViolation(error)) return messages.referenced ?? fallback;
  return fallback;
}
