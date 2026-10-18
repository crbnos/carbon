// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Canonical favicon / touch-icon / manifest <link> descriptors shared by every
 * Carbon app so the browser tab icon is uniform across erp, mes, academy,
 * starter, and docs.
 *
 * One icon for every background: a dark mark with an opaque white glyph
 * (`carbon-favicon.svg`, and `carbon-favicon.png` for browsers without SVG
 * favicons). It does not follow `prefers-color-scheme`. That follows the OS,
 * not the tab strip: Arc's sidebar and a dark Chrome theme on a light OS are
 * dark while the scheme says light, and an adaptive mark drew dark on dark
 * there. Nor two PNGs switched by `media`: Chrome does not apply `media` to
 * icon links reliably, and dropped the mark after loading. A new file name is
 * also what makes browsers drop an icon they cached.
 *
 * The referenced assets (`carbon-favicon.svg`, `carbon-favicon.png`,
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
    href: "/carbon-favicon.png",
    sizes: "480x480"
  },
  {
    rel: "icon",
    type: "image/svg+xml",
    href: "/carbon-favicon.svg",
    sizes: "any"
  },
  {
    rel: "apple-touch-icon",
    href: "/apple-touch-icon.png"
  },
  { rel: "manifest", href: "/site.webmanifest" }
];
