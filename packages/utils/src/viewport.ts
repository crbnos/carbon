// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import * as cookie from "cookie";

/**
 * Whether the browser's viewport was compact (below the `md` breakpoint) when
 * it last reported. Written by `CompactProvider` so the server renders the
 * phone layout on the first paint instead of swapping after hydration.
 */
export const COMPACT_HINT_COOKIE = "compact";

/** Compact means below Tailwind `md` (48rem), the same query theme.css uses. */
export const COMPACT_QUERY = "(width < 48rem)";

const COMPACT_HINT_MAX_AGE = 31536000;

/** Server: the compact hint from the cookie, else the UA "Mobi" token. */
export function getCompactHint(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie");
  const cookies = cookieHeader ? cookie.parse(cookieHeader) : {};
  const hint = cookies[COMPACT_HINT_COOKIE];
  if (hint === "1") return true;
  if (hint === "0") return false;
  return /Mobi/i.test(request.headers.get("user-agent") ?? "");
}

/**
 * Client: the `document.cookie` string that records whether the viewport is
 * compact, read by `getCompactHint` on the next request.
 */
export function compactHintCookie(isCompact: boolean): string {
  return cookie.serialize(COMPACT_HINT_COOKIE, isCompact ? "1" : "0", {
    maxAge: COMPACT_HINT_MAX_AGE,
    sameSite: "lax",
    path: "/"
  });
}
