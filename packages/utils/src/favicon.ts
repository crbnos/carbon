/**
 * Canonical favicon / touch-icon / manifest <link> descriptors shared by every
 * Carbon app so the browser tab icon is uniform across erp, mes, academy,
 * starter, and docs.
 *
 * Theme-aware: light theme uses the light mark, dark theme uses the dark mark.
 * The referenced assets (`carbon-mark-light.png`, `carbon-mark-dark.png`,
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
  media?: string;
};

export const faviconLinks: FaviconLink[] = [
  {
    rel: "icon",
    type: "image/png",
    href: "/carbon-mark-light.png",
    media: "(prefers-color-scheme: light)"
  },
  {
    rel: "icon",
    type: "image/png",
    href: "/carbon-mark-dark.png",
    media: "(prefers-color-scheme: dark)"
  },
  {
    rel: "apple-touch-icon",
    href: "/apple-touch-icon.png"
  },
  { rel: "manifest", href: "/site.webmanifest" }
];
