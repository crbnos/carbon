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
 * Mirrors the pattern in
 * `apps/mes/app/routes/x+/issue-tracked-entity.tsx` so error surfacing is
 * consistent across the two apps.
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
