import { PostgresError } from "pg";
import { corsHeaders } from "./headers.ts";

/**
 * Shared HTTP response construction for Supabase edge functions.
 *
 * ERROR BODY CONTRACT — the apps read `body.message` and nothing else. See
 * `apps/erp/app/utils/error.ts`. `supabase-js` wraps non-2xx responses in a
 * `FunctionsHttpError` whose own `.message` is the useless fixed string
 * "Edge Function returned a non-2xx status code", so the real reason has to
 * travel in the body under `message`. Do not add `error` or `success: false`
 * to error bodies — no consumer reads them.
 */

/** `corsHeaders` plus the JSON content type. For responses this module can't build (binary bodies). */
export const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

/**
 * Handles the CORS preflight. Returns `null` for every other method:
 *
 *   const preflight = corsPreflight(req);
 *   if (preflight) return preflight;
 */
export function corsPreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response("ok", { headers: corsHeaders });
}

/** JSON response with CORS headers. `status` defaults to 200 — pass it only when it is not 200. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: jsonHeaders, status });
}

/**
 * True when `err` came from the data layer rather than from our own `throw`.
 *
 * Classification is STRUCTURAL — an `instanceof` against a real imported class, or the
 * presence of a documented set of keys. It never inspects message TEXT, so it cannot
 * misfire on an authored message that happens to mention a table or a constraint.
 *
 * Unknown shapes return `false` (treated as authored, message surfaced). That is
 * deliberate: the ~541 `throw new Error("...")` sites in this directory are the dominant
 * case, and defaulting to "surface" preserves their behavior exactly.
 */
export function isDataLayerError(err: unknown): boolean {
  // 1. deno.land/x/postgres — thrown by the Kysely pool via lib/driver.ts.
  //    Real imported class, so this is an exact check with no duck-typing.
  if (err instanceof PostgresError) return true;

  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;

  // 2. supabase-js PostgrestError, rethrown directly by e.g. convert/index.ts:1056-1059,
  //    mrp/index.ts:95. Its documented shape is exactly these four keys.
  if (
    typeof e.code === "string" &&
    "details" in e &&
    "hint" in e &&
    "message" in e
  ) {
    return true;
  }

  // 3. node-postgres-shaped errors (SQLSTATE + protocol fields on the error itself).
  if (typeof e.code === "string" && typeof e.severity === "string") return true;

  // 4. ZodError — `.message` is a multi-line JSON dump of `issues`, never user-facing.
  if (e.name === "ZodError" && Array.isArray(e.issues)) return true;

  return false;
}

/**
 * Compact, surfaceable summary of a ZodError's issues (`path: message; …`).
 *
 * A payload-validation failure is the CALLER's input contract, not a data-layer
 * leak — but the raw `.message` is a JSON dump, so `isDataLayerError` rightly
 * blocks it. Suppressing it entirely was worse: an API caller sending an
 * unsupported `adjustmentType` got only the service's generic fallback string,
 * with nothing to converge on. The issue text names payload fields and expected
 * values only — never table or constraint names.
 */
function zodIssueSummary(err: unknown): string | null {
  const e = err as { name?: unknown; issues?: unknown };
  if (e?.name !== "ZodError" || !Array.isArray(e.issues)) return null;
  const parts = (
    e.issues as Array<{ path?: unknown[]; message?: unknown }>
  )
    .slice(0, 5)
    .map((issue) => {
      const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
      const message =
        typeof issue.message === "string" ? issue.message : "invalid";
      return path ? `${path}: ${message}` : message;
    });
  if (parts.length === 0) return null;
  const more = e.issues.length - parts.length;
  return `Invalid payload — ${parts.join("; ")}${more > 0 ? `; +${more} more` : ""}`;
}

/**
 * JSON error response built from a thrown value.
 *
 * - Duck-types `.message` (so `Error` and any `{ message }` object work) and accepts a
 *   raw `string` for call-site literals.
 * - SANITIZES: when `isDataLayerError(err)`, the message is dropped from the body and only
 *   logged. Raw text like `duplicate key value violates unique constraint "receiptLine_pkey"`
 *   must never reach a toast. The caller's fallback string wins instead.
 * - OMITS the `message` key entirely when there is no usable message. Load-bearing —
 *   `getEdgeFunctionErrorMessage(err, fallback)` falls back to the caller's own copy.
 * - `console.error`s the ORIGINAL value (not the extracted string) so the stack and the
 *   sanitized detail both survive into the Supabase log drain.
 * - `extra` merges additional top-level keys — currently only `invalidLineIds` from
 *   `post-inventory-count`. `undefined` values are dropped so callers can pass optionals
 *   without conditional spreads.
 */
export function errorResponse(
  err: unknown,
  status = 500,
  extra?: Record<string, unknown>
): Response {
  console.error(err);

  const raw =
    typeof err === "string"
      ? err
      : (err as { message?: unknown } | null | undefined)?.message;

  const body: Record<string, unknown> = {};
  if (typeof raw === "string" && raw !== "" && !isDataLayerError(err)) {
    body.message = raw;
  } else {
    const zodSummary = zodIssueSummary(err);
    if (zodSummary) body.message = zodSummary;
  }

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) body[key] = value;
    }
  }

  return jsonResponse(body, status);
}
