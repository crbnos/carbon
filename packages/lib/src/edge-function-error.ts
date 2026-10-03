// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Extract the user-facing error message from a Supabase
 * `functions.invoke()` failure.
 *
 * `supabase-js` wraps non-2xx edge-function responses in `FunctionsHttpError`
 * where the response body lives on `error.context: Response`. The body is
 * never parsed by the SDK, so callers that just read `error.message` get the
 * generic wrapper text ("Edge Function returned a non-2xx status code") and
 * lose the real message we set inside the edge function (e.g.
 * `{ success: false, message: "Tracked entity not found" }`).
 *
 * Shared by the apps (`~/utils/error` re-exports it) and the jobs that
 * invoke edge functions unattended.
 */
export async function getEdgeFunctionErrorMessage(
  err: unknown,
  fallback: string
): Promise<string> {
  const ctx = (err as { context?: Response })?.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const body = await ctx.clone().json();
      const bodyMessage = body?.message;
      if (
        typeof bodyMessage === "string" &&
        bodyMessage !== "" &&
        bodyMessage !== "Edge Function returned a non-2xx status code"
      ) {
        return bodyMessage;
      }
    } catch {
      // body wasn't JSON or already consumed — fall through
    }
  }
  const message = (err as { message?: unknown })?.message;
  // FunctionsHttpError.message is always this fixed wrapper text, which says nothing —
  // let the caller's fallback win instead of showing it to the user.
  if (
    typeof message === "string" &&
    message !== "" &&
    message !== "Edge Function returned a non-2xx status code"
  ) {
    return message;
  }
  return fallback;
}
