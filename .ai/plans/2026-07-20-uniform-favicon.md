# Uniform favicon — implementation plan

**Spec:** none (small cross-app fix; scoped from investigation in this session)
**Research:** none
**Branch:** fix/uniform-favicon

## Problem recap (grounded)

The favicon **asset files** are already byte-identical across all five apps
(`erp`, `mes`, `academy`, `starter`, `docs`). The inconsistency users see comes
from **how each surface declares the icon**, and from there being no single
source of truth:

1. **Docs page** — `docs/app/icon.svg` (byte-identical to the fixed dark-fill
   `carbon-mark-light.svg`, **no** `prefers-color-scheme` media query) triggers
   the Next.js `app/icon` file convention, which auto-injects a
   `<link rel="icon" href="/icon.svg?…">`. That competes with the manual,
   theme-aware `<link>`s in `docs/app/layout.tsx`; the non-theme-aware auto icon
   often wins → docs shows the light mark even in dark mode and diverges from ERP/MES.
2. **Declarations are duplicated** — each of the four React Router roots hand-writes
   the same six `<link>` objects, and docs hand-writes an equivalent JSX block.
   Nothing shares a source, so they can drift.
3. **`apps/academy/public/site.webmanifest`** has empty `name`/`short_name`.

**Raw-PDF / non-HTML pages (now understood, IS covered):** raw-PDF routes
(`apps/erp/app/routes/file+/**/*[.]pdf.tsx` via `renderToStream`, and
`file+/preview+/$bucket.$.tsx`) return `application/pdf` with no HTML `<head>`, so
they carry no HTML `<link>`. But the browser still auto-requests **`/favicon.ico`
from the origin** (e.g. `app.carbon.ms` → `apps/erp/public/favicon.ico`) and shows
that in the tab — which is why a PDF page already displays the Carbon mark, not a
generic PDF icon. `favicon.ico` is the same mark and is byte-identical across every
app, so PDF tabs are **already uniform**. No per-route change is possible or needed;
we just make `/favicon.ico` an explicit member of the shared declared set so HTML
and non-HTML surfaces reference one canonical family. The only inherent constraint:
`.ico` is a static raster and cannot theme-switch, so a PDF tab in dark mode shows
the fixed dark-navy mark — a browser behavior of non-HTML pages, not a Carbon bug.

**One mark, two theming mechanisms (verified):** `favicon.svg` and
`carbon-mark-{light,dark}.svg` have **identical path geometry**. `favicon.svg`
self-switches fill via an internal CSS `@media (prefers-color-scheme: dark)` block
(one file); the `carbon-mark-*` pair are two fixed-fill files selected by the
HTML `media` attribute. Same logo — no design divergence anywhere.

## Goal

One shared, dependency-free `faviconLinks` array in `@carbon/utils`, consumed by
all five apps (React Router roots spread it; docs maps it in JSX). Remove the
competing `docs/app/icon.svg`. Fix the academy manifest. Document the single
source + the raw-PDF limitation in a rule.

## Progress
- [x] Task 1: Add shared `faviconLinks` to `@carbon/utils` (+ subpath export)
- [x] Task 2: Point the four React Router roots at `faviconLinks`
- [x] Task 3: Make `docs` consume `faviconLinks` and delete the competing `icon.svg`
- [x] Task 4: Fix `apps/academy/public/site.webmanifest` name/short_name
- [ ] Task 5: Add `.ai/rules/favicon-system.md`
- [ ] Task 6: Browser-verify favicons across apps

## Dependencies
- Task 1 blocks Tasks 2 and 3 (they import the shared array).
- Task 4 is independent (can run anytime).
- Tasks 2 and 3 are independent of each other (parallelizable) once Task 1 lands.
- Task 5 depends on Tasks 1–4 being final (it documents them).
- Task 6 is last (verifies everything).

---

## Task 1: Add shared `faviconLinks` to `@carbon/utils`

**Depends on:** none
**Files:**
- Create: `packages/utils/src/favicon.ts`
- Modify: `packages/utils/src/index.ts` — add barrel re-export
- Modify: `packages/utils/package.json` — add `./favicon` subpath export
- Copy from (precedent): the six icon `<link>` objects in
  `apps/erp/app/root.tsx:59-88`; the subpath-export pattern already in
  `packages/utils/package.json` (`"./status-colors": "./src/status-colors.ts"`)

**Why a dedicated file + subpath:** `docs` is Next.js and imports `@carbon/utils`
**only** via subpaths (`@carbon/utils/status-colors`) because the barrel `.` entry
pulls in Supabase/Tiptap/Zod, which is too heavy/incompatible for the docs RSC
build. `favicon.ts` must therefore be **plain data with zero imports**.

**Steps:**
1. Create `packages/utils/src/favicon.ts` with exactly this content:
   ```ts
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
       media: "(prefers-color-scheme: light)",
     },
     {
       rel: "icon",
       type: "image/svg+xml",
       href: "/carbon-mark-dark.svg",
       media: "(prefers-color-scheme: dark)",
     },
     { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
     { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
     // Legacy / non-SVG fallback. `sizes: "any"` stops Chrome double-fetching it
     // alongside the SVG icons. This is the SAME file the browser auto-requests at
     // /favicon.ico for non-HTML pages (e.g. raw PDF routes), so declaring it here
     // makes the HTML-declared set match what PDF/non-HTML tabs already fall back to.
     { rel: "icon", href: "/favicon.ico", sizes: "any" },
     { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
     { rel: "manifest", href: "/site.webmanifest" },
   ] as const;
   ```
2. In `packages/utils/src/index.ts`, add the re-export. Insert it in alphabetical
   position (between `./duration` and `./field-registry`):
   ```ts
   export * from "./favicon";
   ```
3. In `packages/utils/package.json`, add a subpath export. Change the `exports`
   block from:
   ```json
   "exports": {
     ".": "./src/index.ts",
     "./status-colors": "./src/status-colors.ts"
   },
   ```
   to:
   ```json
   "exports": {
     ".": "./src/index.ts",
     "./favicon": "./src/favicon.ts",
     "./status-colors": "./src/status-colors.ts"
   },
   ```

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-fix-uniform-favicon
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: task succeeds (no TypeScript errors); "@carbon/utils#typecheck" exits 0
```

**Out of scope:** Do not touch any other file in `packages/utils`. Do not add any
import to `favicon.ts`.

---

## Task 2: Point the four React Router roots at `faviconLinks`

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/root.tsx` — replace the six inline icon links; add import
- Modify: `apps/mes/app/root.tsx` — same
- Modify: `apps/academy/app/root.tsx` — same
- Modify: `apps/starter/app/root.tsx` — same
- Copy from (precedent): existing `links()` exports in these same files

All four files already import from `@carbon/utils` in their `links()` neighborhood
and already contain the identical six icon-link objects. Replace those six objects
with a single `...faviconLinks` spread and import the value.

**Steps (apply to each of the four files):**
1. **ERP** — `apps/erp/app/root.tsx`:
   - Add `faviconLinks` to the existing `@carbon/utils` value import at line 20.
     Change:
     ```ts
     import { getPreferenceHeaders, modeValidator, themes } from "@carbon/utils";
     ```
     to:
     ```ts
     import { faviconLinks, getPreferenceHeaders, modeValidator, themes } from "@carbon/utils";
     ```
   - In the `links` export, replace the six icon objects (the block currently at
     lines 59-88, starting with the first `{ rel: "icon", type: "image/svg+xml",
     href: "/carbon-mark-light.svg", ... }` through
     `{ rel: "manifest", href: "/site.webmanifest" }`) with a single line:
     ```ts
     ...faviconLinks
     ```
     The stylesheet link objects above them stay unchanged; the result is:
     ```ts
     export const links: LinksFunction = () => {
       return [
         { href: Tailwind, rel: "stylesheet" },
         { href: Background, rel: "stylesheet" },
         { href: NProgress, rel: "stylesheet" },
         { href: SonnerStyle, rel: "stylesheet" },
         ...faviconLinks,
       ];
     };
     ```
2. **MES** — `apps/mes/app/root.tsx`: add `faviconLinks` to the `@carbon/utils`
   value import at line 19 (`import { getPreferenceHeaders, modeValidator, themes } from "@carbon/utils";`
   → add `faviconLinks` in alphabetical position). Replace the six icon objects
   (currently lines 52-81, same first→last markers as ERP) with `...faviconLinks`.
   The three stylesheet links above stay. Result:
   ```ts
   export const links: Route.LinksFunction = () => [
     { rel: "stylesheet", href: Tailwind },
     { rel: "stylesheet", href: Background },
     { rel: "stylesheet", href: NProgress },
     ...faviconLinks,
   ];
   ```
3. **Academy** — `apps/academy/app/root.tsx`: Read the file first. It has the same
   six icon objects inside its `links` export and already imports from
   `@carbon/utils`. Add `faviconLinks` to that `@carbon/utils` value import (if the
   file has no value import from `@carbon/utils`, add
   `import { faviconLinks } from "@carbon/utils";` next to the other `@carbon/*`
   imports). Replace the six icon objects (first `rel: "icon"` svg-light through
   `rel: "manifest"`) with `...faviconLinks`, leaving any stylesheet links intact.
4. **Starter** — `apps/starter/app/root.tsx`: same procedure as Academy — read
   first, add `faviconLinks` to the `@carbon/utils` value import (or a new import),
   replace the six icon objects with `...faviconLinks`.

If any of these four files turns out NOT to contain the exact six icon objects
described (e.g. an app already diverged), STOP and report — do not improvise a
different replacement.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-fix-uniform-favicon
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=academy --filter=starter
# Expected: all four typecheck tasks exit 0. (Package filter for the ERP app is
# `erp`, NOT `@carbon/erp`.)
grep -rn "carbon-mark-light.svg" apps/*/app/root.tsx
# Expected: NO matches (all four now use ...faviconLinks instead of inline hrefs)
```
If ERP typecheck fails with a TS2589 "excessively deep" / instantiation-budget
error unrelated to this change (known chronic issue on this repo), STOP and report
rather than widening the change.

**Out of scope:** Do not change the stylesheet links, the `meta` export, or any
loader/component logic in these roots. Do not edit the `/public` asset files.

---

## Task 3: Make `docs` consume `faviconLinks` and delete the competing `icon.svg`

**Depends on:** Task 1
**Files:**
- Delete: `docs/app/icon.svg` — removes the Next.js `app/icon` auto-injected,
  non-theme-aware competing favicon (the root cause of the docs divergence)
- Modify: `docs/app/layout.tsx` — replace the six hand-written favicon `<link>`s
  with a map over `faviconLinks`; fix the stale comment at line 47
- Copy from (precedent): the existing favicon `<link>` block in
  `docs/app/layout.tsx:122-151`; the subpath-import style already used in
  `docs/components/editorial/status-flow.tsx:22` (`from "@carbon/utils/status-colors"`)

**Steps:**
1. Delete the file `docs/app/icon.svg`.
   ```bash
   cd /Users/aashu/work/carbon/carbon-fix-uniform-favicon
   git rm docs/app/icon.svg
   ```
   Rationale: it is byte-identical to `docs/public/carbon-mark-light.svg` and only
   exists to trigger the Next.js file convention, which fights the theme-aware
   `<link>`s. The theme-aware SVG favicon is preserved via
   `docs/public/carbon-mark-light.svg` + `carbon-mark-dark.svg`, referenced by
   `faviconLinks`.
2. In `docs/app/layout.tsx`, add the import near the other `@carbon/*` / `@/`
   imports at the top (use the **subpath**, not the barrel):
   ```ts
   import { faviconLinks } from "@carbon/utils/favicon";
   ```
3. Replace the stale comment at line 47:
   ```ts
   // Favicon comes from the app/icon.svg file convention.
   ```
   with:
   ```ts
   // Favicon links come from the shared @carbon/utils faviconLinks (single source
   // of truth across all Carbon apps); rendered in <head> below.
   ```
4. Replace the six hand-written favicon `<link>` elements in `<head>`
   (`docs/app/layout.tsx:122-151`, from the first
   `<link rel="icon" type="image/svg+xml" href="/carbon-mark-light.svg" .../>`
   through `<link rel="manifest" href="/site.webmanifest" />`) with a single map:
   ```tsx
   {faviconLinks.map((link) => (
     <link key={link.href} {...link} />
   ))}
   ```
   Leave the `<script type="application/ld+json">` above and the
   `<link rel="preconnect" ...>` font links below unchanged.

If deleting `docs/app/icon.svg` surfaces another `app/`-level icon convention file
(`docs/app/favicon.ico`, `docs/app/apple-icon.*`, `docs/app/icon.*`) that also
auto-injects an icon, STOP and report — the current tree has only `icon.svg`, so
this should not happen.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-fix-uniform-favicon
test ! -e docs/app/icon.svg && echo "icon.svg removed"
# Expected: prints "icon.svg removed"
pnpm exec turbo run typecheck --filter=docs
# Expected: docs typecheck exits 0
grep -n "app/icon.svg file convention" docs/app/layout.tsx || echo "stale comment gone"
# Expected: prints "stale comment gone"
```

**Out of scope:** Do not touch `docs/app/manifest.ts` or `docs/public/site.webmanifest`
(the dynamic-vs-static manifest duplication is a separate, non-favicon concern —
note it in Task 5, do not fix here). Do not delete any file in `docs/public/`.

---

## Task 4: Fix `apps/academy/public/site.webmanifest` name/short_name

**Depends on:** none
**Files:**
- Modify: `apps/academy/public/site.webmanifest` — fill empty `name`/`short_name`
- Copy from (precedent): `apps/erp/public/site.webmanifest`
  (`"name":"Carbon ERP","short_name":"ERP"`),
  `apps/mes/public/site.webmanifest` (`"name":"Carbon MES","short_name":"MES"`)

**Steps:**
1. The current file is:
   ```json
   {"name":"","short_name":"","icons":[{"src":"/android-chrome-192x192.png","sizes":"192x192","type":"image/png"},{"src":"/android-chrome-512x512.png","sizes":"512x512","type":"image/png"}],"theme_color":"#ffffff","background_color":"#ffffff","display":"standalone"}
   ```
   Replace `"name":""` with `"name":"Carbon Academy"` and `"short_name":""` with
   `"short_name":"Academy"`, following the `Carbon <App>` / `<App>` pattern the
   other apps use. Leave `icons`, `theme_color`, `background_color`, and `display`
   exactly as they are.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-fix-uniform-favicon
grep -o '"name":"[^"]*"' apps/academy/public/site.webmanifest
# Expected: "name":"Carbon Academy"
```

**Out of scope:** Do not change other apps' manifests. Do not add/remove icon
entries. This only affects the PWA install name, not the tab favicon.

---

## Task 5: Add `.ai/rules/favicon-system.md`

**Depends on:** Tasks 1–4 (documents their final state)
**Files:**
- Create: `.ai/rules/favicon-system.md`
- Copy from (precedent): any existing rule with `paths:` frontmatter, e.g.
  `.ai/rules/flash-system.md` (frontmatter + prose style)

**Steps:**
1. Create `.ai/rules/favicon-system.md` documenting the single source of truth.
   Include, in prose grounded against the code you just wrote:
   - `paths:` frontmatter targeting the roots and the shared file:
     ```
     paths: ["apps/*/app/root.tsx", "docs/app/layout.tsx", "packages/utils/src/favicon.ts"]
     ```
   - The single source: `packages/utils/src/favicon.ts` exports `faviconLinks`;
     barrel re-export + `@carbon/utils/favicon` subpath (docs uses the subpath
     because the barrel pulls in heavy deps).
   - Consumers: the four React Router roots spread `...faviconLinks` in their
     `links()` export; `docs/app/layout.tsx` maps it into `<head>` `<link>`s.
   - Each app still ships its own byte-identical `/public` assets
     (`carbon-mark-light.svg`, `carbon-mark-dark.svg`, `favicon-32x32.png`,
     `favicon-16x16.png`, `apple-touch-icon.png`, `site.webmanifest`,
     `android-chrome-*`); `faviconLinks` references them by absolute path.
   - **Do not re-add `docs/app/icon.svg`** (or any `app/`-level Next icon
     convention file) — it auto-injects a non-theme-aware favicon that competes
     with the shared links.
   - Non-HTML pages (raw-PDF routes `apps/erp/app/routes/file+/**/*[.]pdf.tsx`,
     `file+/preview+/$bucket.$.tsx`) carry no HTML `<link>`, so the browser
     auto-requests `/favicon.ico` from the origin and shows that — the same
     canonical mark, byte-identical across apps, so PDF tabs are already uniform.
     `favicon.ico` is included in `faviconLinks` too, so the declared set matches
     the auto-served fallback. Inherent constraint: `.ico` is a static raster and
     cannot theme-switch (PDF dark-mode shows the fixed dark-navy mark).
   - `favicon.svg` and `carbon-mark-{light,dark}.svg` are the SAME mark geometry;
     the difference is only the theming mechanism (self-switching single file vs
     two fixed-fill files). Do not treat them as competing logos.
   - Note the still-open, out-of-scope item: docs has both a static
     `docs/public/site.webmanifest` and a dynamic `docs/app/manifest.ts` — a
     future cleanup, not a favicon bug.
2. Add a one-line entry to the root `AGENTS.md` Task Router under
   **Infrastructure** (or the closest existing group), pointing to the new rule,
   e.g.:
   ```
   | Favicon / tab icon (single source) | `.ai/rules/favicon-system.md` |
   ```

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-fix-uniform-favicon
test -f .ai/rules/favicon-system.md && head -1 .ai/rules/favicon-system.md
# Expected: file exists and first line is the `paths:` frontmatter
grep -q "favicon-system.md" AGENTS.md && echo "router updated"
# Expected: prints "router updated"
```

**Out of scope:** Do not restructure the Task Router or other rules.

---

## Task 6: Browser-verify favicons across apps

**Depends on:** Tasks 1–5
**Files:** none (verification only)

**Steps:**
1. Ensure a dev stack is running (`crbn up`) — if not, ask the user to start it;
   do not rebuild anything.
2. Use the `/test` skill (which builds on `/auth`) to load, for each running app,
   a normal page and inspect the rendered `<head>`:
   - ERP (`apps/erp`), MES (`apps/mes`), and docs. Confirm each `<head>` contains
     exactly the `faviconLinks` set: two theme-scoped SVG icons, two PNG icons,
     one apple-touch-icon, one manifest — and **no** extra `/icon.svg?…` link on docs.
   - Toggle light/dark and confirm the correct `carbon-mark-{light,dark}.svg` is
     selected, consistently, on ERP and docs.
3. Report the observed `<head>` favicon links per app as evidence (not just "looks
   fine"). If docs still emits an auto `/icon` link, STOP — Task 3's deletion did
   not take effect; re-check.

**Verify:** Manual/browser evidence captured in the run log. No single command;
the acceptance criterion is: identical favicon `<link>` set in every app's `<head>`,
theme-aware selection working, and no competing auto-injected icon on docs.

Also load a raw-PDF route (e.g. `/file/sales-invoice/<id>.pdf`) and confirm the tab
shows the Carbon mark served via the origin's `/favicon.ico` (no HTML change makes
this happen — it's the auto-served fallback; just confirm it renders the mark).

**Out of scope:** Do not attempt to inject an HTML favicon into the PDF response —
non-HTML pages get the tab icon from `/favicon.ico` and that already shows the mark.
