import type { ConformanceCheck, Violation } from "../check";

/**
 * The shared gates in functions/lib/supabase.ts. Each one throws for the bare
 * anon key, which verify_jwt alone lets through: it is a validly signed JWT,
 * and the apps publish it in their HTML.
 */
const AUTH_CALL =
  /\b(requirePermissions|requireCaller|requireServiceRole|getSupabaseServiceRole)\s*\(/;

/**
 * Functions that may skip the shared gates. Keep the reason with each entry.
 * A function that SHOULD be gated but cannot be yet belongs in baseline.json,
 * not here — this list is for "correct as it is".
 */
const ALLOWED = new Map<string, string>([
  [
    "logo-resizer",
    "public by design (verify_jwt = false): resizes the company logo shown on unauthenticated pages"
  ],
  [
    "transcription",
    "verifies the bearer itself with auth.getUser(), which rejects the anon key; touches no company data"
  ]
]);

export const edgeFunctionAuthorizesCaller: ConformanceCheck = {
  id: "edge-function-authorizes-caller",
  description:
    "Every edge function authorizes its caller in-function (requirePermissions / requireCaller / requireServiceRole).",
  provenance: {
    deprecates: "relying on verify_jwt, which accepts the published anon key",
    replacedBy: "requirePermissions / requireCaller / requireServiceRole"
  },
  scan(file, contents) {
    const name = file.split("/").pop() ?? file;
    if (ALLOWED.has(name) || AUTH_CALL.test(contents)) return [];
    const violation: Violation = {
      file,
      line: 0,
      snippet: name,
      message:
        "No in-function authorization: verify_jwt accepts the anon key. Call requirePermissions (company data), requireCaller (no company data) or requireServiceRole (servers only)."
    };
    return [violation];
  }
};
