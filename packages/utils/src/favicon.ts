// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Canonical favicon / touch-icon / manifest <link> descriptors shared by every
 * Carbon app so the browser tab icon is uniform across erp, mes, academy,
 * starter, and docs.
 *
 * Theme-aware through ONE icon: `carbon-mark.svg` recolours itself with an
 * internal `prefers-color-scheme` rule. Not two PNGs switched by `media`:
 * Chrome does not apply `media` to icon links reliably, and showed the mark
 * while loading, then dropped it. The PNG is the fallback for browsers without
 * SVG favicons; its `sizes` lets Chrome still prefer the SVG (`sizes="any"`).
 *
 * The referenced assets (`carbon-mark.svg`, `carbon-mark-light.png`,
 * `apple-touch-icon.png`, `site.webmanifest`) must exist in each app's
 * `public/` dir — static assets are served per-origin, so they are copied into
 * every app rather than imported from here.
 *
 * React Router apps spread `faviconLinks` in their `LinksFunction`; the Next.js
 * docs app maps the same array to `<link>` elements in its <head>.
 */
export type FaviconLink = {
  rel: string;
  href: string;
  type?: string;
  sizes?: string;
};

export const faviconLinks: FaviconLink[] = [
  {
    rel: "icon",
    type: "image/png",
    href: "/carbon-mark-light.png",
    sizes: "480x480"
  },
  {
    rel: "icon",
    type: "image/svg+xml",
    href: "/carbon-mark.svg",
    sizes: "any"
  },
  {
    rel: "apple-touch-icon",
    href: "/apple-touch-icon.png"
  },
  { rel: "manifest", href: "/site.webmanifest" }
];
