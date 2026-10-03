// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export { getEdgeFunctionErrorMessage } from "@carbon/lib/edge-function-error";

/**
 * Parse the full JSON body of a `FunctionsHttpError` (the edge function's
 * `{ message, ...extra }` payload). Use when the edge function returns structured
 * data alongside the message — e.g. `invalidLineIds` for row highlighting.
 * Returns `null` when there is no readable JSON body.
 */
export async function getEdgeFunctionErrorBody(
  err: unknown
): Promise<Record<string, unknown> | null> {
  const ctx = (err as { context?: Response })?.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const body = await ctx.clone().json();
      if (body && typeof body === "object") {
        return body as Record<string, unknown>;
      }
    } catch {
      // body wasn't JSON or already consumed
    }
  }
  return null;
}
