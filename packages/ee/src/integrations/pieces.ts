/**
 * The Activepieces pieces Carbon exposes — the NAMES only, as a type.
 *
 * `PIECE_ALLOWLIST` (@carbon/jobs) stays the single declaration of what each
 * piece exposes (package, version, actions, OAuth); this union is the compile-time
 * key set that allowlist, the settings cards and `pieceLogo` all share, so a
 * misspelled or unsupported piece name is a type error instead of a runtime 404.
 * It lives here rather than in @carbon/jobs because the dependency only runs
 * jobs → ee, and the ee configs need it too.
 *
 * Adding a piece: extend this union first — the allowlist's `Record` then
 * refuses to compile until the new piece has an entry, and vice versa.
 */
export type ActivepiecesPiece = "gmail" | "google-calendar" | "slack";

/**
 * Names `pieceLogo` may fetch: the pieces, plus integrations that are NOT
 * pieces but whose official colored mark the Activepieces CDN also hosts.
 * Each extra slug was verified to resolve at
 * `https://cdn.activepieces.com/pieces/<slug>.png` before being listed —
 * extend only after checking, since the CDN 404s silently as a broken image.
 */
export type PieceLogoSlug =
  | ActivepiecesPiece
  | "jira"
  | "linear"
  | "quickbooks"
  | "stripe"
  | "xero";
