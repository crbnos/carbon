paths: ["apps/*/app/root.tsx", "docs/app/layout.tsx", "packages/utils/src/favicon.ts"]

# Favicon / tab-icon system

Every Carbon app shows the same browser tab icon (favicon) from **one shared
declaration** pointing at **one light-colored mark**, the same regardless of OS/
browser theme. Before this was unified, each app hand-wrote its own `<link>`s, the
`docs` app triggered a competing Next.js icon convention, and the kit carried a
zoo of per-size rasters — so tabs diverged across apps, themes, and page types.

## Single source of truth

`packages/utils/src/favicon.ts` exports a framework-neutral `faviconLinks` array.
It is re-exported from the `@carbon/utils` barrel **and** via a dedicated subpath in
`packages/utils/package.json`:

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

The array is deliberately tiny — two entries:

```ts
export const faviconLinks = [
  { rel: "icon", type: "image/svg+xml", href: "/carbon-mark-dark.svg?v=3" }, // tab, all modern browsers
  { rel: "icon", href: "/favicon.ico?v=3", sizes: "any" },                    // legacy + non-HTML (PDF) fallback
] as const;
```

## Consumers

- **React Router apps** (`erp`, `mes`, `academy`, `starter`): each `app/root.tsx`
  `links()` export spreads `...faviconLinks` after its stylesheet links, importing
  `faviconLinks` from `@carbon/utils`.
- **docs** (`docs/app/layout.tsx`, Next.js): imports from `@carbon/utils/favicon`
  and renders `{faviconLinks.map((link) => <link key={link.href} {...link} />)}` in
  `<head>`.

To change the favicon declaration, edit `faviconLinks` **only** — all five apps
follow.

## The two assets (only these)

Each app ships exactly two favicon files in its `public/` dir, **byte-identical
across all five apps**:

- **`carbon-mark-dark.svg`** — the light-colored mark (fill `#E6E6E6`). Despite the
  "-dark" name (it was the dark-*theme* asset), it is the near-white mark. One
  vector file renders crisply at every size, so no per-size PNGs are needed.
- **`favicon.ico`** — the same light mark as a 16/32 raster. Required because
  non-HTML pages (raw PDF routes) and legacy browsers auto-request `/favicon.ico`
  from the origin; this is the only raster we keep.

**Always light, no theme switching.** There is no `prefers-color-scheme` media
query and no dark variant in `faviconLinks` — product decision: the light mark
everywhere. (`carbon-mark-light.svg`, the dark-navy mark, still exists in `public/`
because app UI uses it as an inline `<img>`; it is **not** a favicon.)

## Padding (inset, not edge-to-edge)

The raw mark path fills (slightly overflows) its native `424×480` box, which reads
too heavy in a tab. So the favicon insets it to ~80% with a symmetric transparent
margin:

- **SVG**: same path, but `viewBox="-88 -60 600 600"` (a `600×600` square with the
  `424×480` mark centered → ~10% vertical / ~15% horizontal margin).
- **`favicon.ico`**: regenerated from the *same* inset composite (light mark placed
  on a `600×600` transparent canvas, downscaled to 16/32), so the tab (SVG) and the
  PDF tab (`.ico`) match.

Both are byte-identical across apps. If the mark or inset changes, regenerate
**both** together and bump the `?v=` in `faviconLinks`.

### Regenerating the rasters

There is no committed build step; the `.ico`/inset were produced with a throwaway
Node script (pure `zlib` for PNG decode/recolor/encode + `sips` for downscaling +
manual ICO packing), because the repo has no `sharp`/`rsvg`/ImageMagick. To redo:
recolor/compose the mark PNG onto a transparent square (`offX=(side-424)/2`,
`offY=(side-480)/2`), `sips -z 32 32` / `-z 16 16`, pack the two PNGs into an ICO
(6-byte `ICONDIR` + 16-byte entries + embedded PNG bytes), copy to every app.

## Cache-busting (`?v=`)

Browsers cache favicons per-origin very aggressively — a hard-refresh (and often
Incognito) will not swap them; they frequently update only on a browser restart.
The `?v=N` query on the hrefs forces a re-fetch. **Bump `N` whenever the mark
changes** so users don't keep a stale icon. (The auto-requested `/favicon.ico` for
non-HTML PDF tabs cannot carry a query, so that surface still relies on a normal
cache cycle.)

## Do NOT re-add `docs/app/icon.svg`

Any `app/`-level icon convention file in the Next.js `docs` app
(`app/icon.*`, `app/apple-icon.*`, `app/favicon.ico`) makes Next auto-inject its own
`<link rel="icon">` that competes with the shared links. `app/icon.svg` was removed
on purpose — favicons come solely from `faviconLinks`.

## Removed on purpose (PWA trade-off)

`favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`,
`android-chrome-192x192.png`, `android-chrome-512x512.png`, and
`site.webmanifest` were **deleted** from every app — redundant for a vector mark
and the source of a blank apple-touch (a transparent light mark is invisible on the
opaque tiles iOS/Android expect). This drops "Add to Home Screen" / installed-PWA
icon polish. To restore PWA install: add back a `site.webmanifest` plus a **single
opaque** icon (dark background + light mark) — one image can serve every raster
slot, but it must be opaque or home-screen icons render blank.

## Non-HTML pages (raw PDF, previews)

Raw-file routes (`apps/erp/app/routes/file+/**/*[.]pdf.tsx` via `renderToStream`,
`file+/preview+/$bucket.$.tsx`) return `application/pdf` with no HTML `<head>`, so
they carry no `<link>`. The browser instead auto-requests `/favicon.ico` from the
origin (e.g. `app.carbon.ms` → `apps/erp/public/favicon.ico`) and shows that — now
the same light, inset mark, byte-identical across apps, so these tabs match the
HTML ones. Inherent constraint: `.ico` is a static raster and cannot theme-switch.
