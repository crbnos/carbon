/**
 * Extract the user-facing error message from a Supabase `functions.invoke()`
 * failure, or from a plain Postgrest-shaped error.
 *
 * `supabase-js` wraps non-2xx edge-function responses in `FunctionsHttpError`
 * where the response body lives on `error.context: Response`. The body is
 * never parsed by the SDK, so callers that just read `error.message` get the
 * generic wrapper text ("Edge Function returned a non-2xx status code") and
 * lose the real message the edge function set (e.g.
 * `{ message: "Job J000344 has 11 serial unit(s) left to receive..." }`).
 *
 * Mirrors `apps/erp/app/utils/error.ts` (`getEdgeFunctionErrorMessage`) and
 * the inline pattern already used in `x+/issue-tracked-entity.tsx`.
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
  // let the caller's fallback win instead of showing it to the user. A plain
  // Postgrest-shaped error (e.g. from a direct `.update()` call) carries its real
  // message here directly.
  if (
    typeof message === "string" &&
    message !== "" &&
    message !== "Edge Function returned a non-2xx status code"
  ) {
    return message;
  }
  return fallback;
}
