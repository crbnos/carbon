paths: ["apps/*/app/root.tsx", "docs/app/layout.tsx", "packages/utils/src/favicon.ts"]

# Favicon / tab-icon system

Every Carbon app shows the same browser tab icon (favicon) from **one shared
declaration**. Before this was unified, each app hand-wrote its own `<link>`s and
the `docs` app additionally triggered a competing Next.js icon convention, so tabs
diverged across apps and themes.

## Single source of truth

`packages/utils/src/favicon.ts` exports a framework-neutral `faviconLinks` array
(the ordered set of icon `<link>` descriptors). It is re-exported from the
`@carbon/utils` barrel **and** via a dedicated subpath in `packages/utils/package.json`:

```json
"exports": {
  ".": "./src/index.ts",
  "./favicon": "./src/favicon.ts",
  "./status-colors": "./src/status-colors.ts"
}
```

`favicon.ts` must stay **dependency-free** (no imports): the `docs` Next.js build
imports it via the `@carbon/utils/favicon` subpath, and the heavy barrel `.` entry
(Supabase, Tiptap, Zod) is not safe/appropriate for a Next RSC.

## Consumers

- **React Router apps** (`erp`, `mes`, `academy`, `starter`): each `app/root.tsx`
  `links()` export spreads `...faviconLinks` after its stylesheet links, importing
  `faviconLinks` from `@carbon/utils`.
- **docs** (`docs/app/layout.tsx`, Next.js): imports from `@carbon/utils/favicon`
  and renders `{faviconLinks.map((link) => <link key={link.href} {...link} />)}` in
  `<head>`.

To change the favicon declaration, edit `faviconLinks` **only** — all five apps
follow.

## Assets

`faviconLinks` references assets by absolute path; each app still ships its own
byte-identical copies under its `public/` dir: `carbon-mark-light.svg`,
`carbon-mark-dark.svg`, `favicon-32x32.png`, `favicon-16x16.png`, `favicon.ico`,
`apple-touch-icon.png`, `site.webmanifest`, and the `android-chrome-*` PNGs (the
manifest references the latter). The SVG icons are theme-scoped via
`media="(prefers-color-scheme: …)"`.

`favicon.svg` and `carbon-mark-{light,dark}.svg` are the **same mark geometry** —
`favicon.svg` self-switches fill via an internal CSS `@media` block (one file),
while the `carbon-mark-*` pair are two fixed-fill files selected by the HTML `media`
attribute. Same logo; do not treat them as competing marks. The `carbon-mark-*`
pair is what `faviconLinks` declares.

## Do NOT re-add `docs/app/icon.svg`

Any `app/`-level icon convention file in the Next.js `docs` app
(`app/icon.*`, `app/apple-icon.*`, `app/favicon.ico`) makes Next auto-inject its own
`<link rel="icon">`. `app/icon.svg` was byte-identical to the fixed-fill
`carbon-mark-light.svg` (no theme media query), so it competed with the shared
theme-aware links and made the docs tab diverge (light mark even in dark mode). It
was removed on purpose — favicons now come solely from `faviconLinks`.

## Non-HTML pages (raw PDF, previews)

Raw-file routes (`apps/erp/app/routes/file+/**/*[.]pdf.tsx` via `renderToStream`,
`file+/preview+/$bucket.$.tsx`) return `application/pdf`/binary with no HTML
`<head>`, so they carry no `<link>`. The browser instead auto-requests
`/favicon.ico` from the origin (e.g. `app.carbon.ms` → `apps/erp/public/favicon.ico`)
and shows that — the same canonical mark, byte-identical across apps, so these tabs
are already uniform. `favicon.ico` is also declared in `faviconLinks` (with
`sizes: "any"`) so the HTML-declared set matches the auto-served fallback.

Inherent constraint: `.ico` is a static raster and cannot theme-switch, so a PDF tab
in dark mode shows the fixed dark-navy mark. This is browser behavior for non-HTML
pages, not a Carbon bug — there is no HTML to attach a theme-aware favicon to.

## Known out-of-scope item

The `docs` app has both a static `docs/public/site.webmanifest` and a dynamic
`docs/app/manifest.ts` (Next serves the latter at `/manifest.webmanifest`). This
manifest duplication is unrelated to the tab favicon and is a separate future
cleanup, not part of the favicon system.
