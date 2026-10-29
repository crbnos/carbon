// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import * as cookie from "cookie";

/** The three layout sizes, split at Tailwind `md` (48rem) and `lg` (64rem). */
export type Viewport = "phone" | "tablet" | "desktop";

const VIEWPORTS: readonly Viewport[] = ["phone", "tablet", "desktop"];

/**
 * The browser's viewport size when it last reported. Written by
 * `ViewportProvider` so the server renders the right layout on the first paint
 * instead of swapping after hydration.
 */
export const VIEWPORT_HINT_COOKIE = "viewport";

/** Phone: below Tailwind `md`, the same query as `max-md:`. */
export const PHONE_QUERY = "(width < 48rem)";

/** Tablet: from Tailwind `md` up to `lg`, the same query as `md:max-lg:`. */
export const TABLET_QUERY = "(48rem <= width < 64rem)";

const VIEWPORT_HINT_MAX_AGE = 31536000;

function isViewport(value: string | undefined): value is Viewport {
  return VIEWPORTS.includes(value as Viewport);
}

/** Server: the viewport from the cookie, else the UA "Mobi" token, else desktop. */
export function getViewportHint(request: Request): Viewport {
  const cookieHeader = request.headers.get("cookie");
  const cookies = cookieHeader ? cookie.parse(cookieHeader) : {};
  const hint = cookies[VIEWPORT_HINT_COOKIE];
  if (isViewport(hint)) return hint;
  return /Mobi/i.test(request.headers.get("user-agent") ?? "")
    ? "phone"
    : "desktop";
}

/**
 * Client: the `document.cookie` string that records the viewport, read by
 * `getViewportHint` on the next request.
 */
export function viewportHintCookie(viewport: Viewport): string {
  return cookie.serialize(VIEWPORT_HINT_COOKIE, viewport, {
    maxAge: VIEWPORT_HINT_MAX_AGE,
    sameSite: "lax",
    path: "/"
  });
}
