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
  // Tab icon for modern browsers — one vector file, crisp at every size.
  // `?v=` busts the browser's aggressive favicon cache when the mark changes.
  { rel: "icon", type: "image/svg+xml", href: "/carbon-mark-dark.svg?v=3" },
  // Legacy browsers + non-HTML pages (e.g. raw PDF tabs auto-fetch /favicon.ico).
  { rel: "icon", href: "/favicon.ico?v=3", sizes: "any" }
] as const;
