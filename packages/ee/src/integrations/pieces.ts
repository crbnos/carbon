// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The Activepieces pieces Carbon exposes — the NAMES only.
 *
 * `PIECE_ALLOWLIST` (@carbon/jobs) stays the single declaration of what each
 * piece exposes (package, version, actions, OAuth); this list is the key set that
 * allowlist, the settings cards, the uninstall hooks and `pieceLogo` all share, so
 * a misspelled or unsupported piece name is a type error instead of a runtime 404.
 * It lives here rather than in @carbon/jobs because the dependency only runs
 * jobs → ee, and the ee configs need it too.
 *
 * Adding a piece: extend this list first — the allowlist's `Record` then
 * refuses to compile until the new piece has an entry, and vice versa.
 */
export const ACTIVEPIECES_PIECES = [
  "gmail",
  "google-calendar",
  "slack"
] as const;

export type ActivepiecesPiece = (typeof ACTIVEPIECES_PIECES)[number];

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
