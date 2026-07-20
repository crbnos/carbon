/**
 * Single source of truth for the browser tab icon (favicon) across every
 * Carbon app: erp, mes, academy, starter (React Router `links()` exports) and
 * docs (Next.js, maps these into <link> JSX). Each app serves byte-identical
 * assets from its own /public dir; this array is the one declaration they share.
 *
 * Keep this framework-neutral (no imports): the docs Next.js build imports it
 * via the `@carbon/utils/favicon` subpath, which must stay dependency-free.
 */
export const faviconLinks = [
  {
    rel: "icon",
    type: "image/svg+xml",
    href: "/carbon-mark-light.svg",
    media: "(prefers-color-scheme: light)"
  },
  {
    rel: "icon",
    type: "image/svg+xml",
    href: "/carbon-mark-dark.svg",
    media: "(prefers-color-scheme: dark)"
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "32x32",
    href: "/favicon-32x32.png"
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "16x16",
    href: "/favicon-16x16.png"
  },
  // Legacy / non-SVG fallback. `sizes: "any"` stops Chrome double-fetching it
  // alongside the SVG icons. This is the SAME file the browser auto-requests at
  // /favicon.ico for non-HTML pages (e.g. raw PDF routes), so declaring it here
  // makes the HTML-declared set match what PDF/non-HTML tabs already fall back to.
  { rel: "icon", href: "/favicon.ico", sizes: "any" },
  { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" }
] as const;
