# Viewport API — implementation plan

**Spec / source:** `.ai/specs/2026-10-07-viewport-api.md`
**Status:** approved
**Branch:** `feat/mobile-redesign`

## Progress
- [x] Task 1: Viewport constants and hint cookie in `@carbon/utils`
- [x] Task 2: `Viewport.tsx` with `ViewportProvider` and `useViewport` in `@carbon/react`
- [x] Task 3: Migrate every `useCompact` / `useIsMobile` call site
- [x] Task 4: ERP root wiring
- [x] Task 5: CSS — delete the gate, split the global phone block
- [x] Task 6: Rewrite `compact:` classes to `max-md:`
- [x] Task 7: Static verification
- [ ] Task 8: Browser verification (only with the owner's go-ahead)

## Dependencies
Task 2 needs Task 1. Task 3 and Task 4 need Task 2. Task 5 and Task 6 are independent of Tasks 1–4.
Task 7 needs Tasks 1–6. Task 8 needs Task 7.

🛑 Never commit. The owner commits.

---

## Task 1: Viewport constants and hint cookie in `@carbon/utils`

**Depends on:** none
**Files:**
- Modify: `packages/utils/src/viewport.ts` — replace the compact API with the viewport API
- Modify: `packages/utils/src/viewport.test.ts` — test the new API

**Steps:**
1. Replace the exports of `viewport.ts` with:
   - `export type Viewport = "phone" | "tablet" | "desktop";`
   - `export const VIEWPORT_HINT_COOKIE = "viewport";`
   - `export const PHONE_QUERY = "(width < 48rem)";`
   - `export const TABLET_QUERY = "(48rem <= width < 64rem)";`
   - `export function getViewportHint(request: Request): Viewport` — the cookie value if it is one of the three names, else `"phone"` when the user agent matches `/Mobi/i`, else `"desktop"`.
   - `export function viewportHintCookie(viewport: Viewport): string` — same `cookie.serialize` options as today.
2. Delete `COMPACT_HINT_COOKIE`, `COMPACT_QUERY`, `getCompactHint`, `compactHintCookie`.
3. Rewrite `viewport.test.ts` against the new API: the three cookie values round-trip, an unknown value falls back to the UA, the iPhone UA gives `"phone"`, the Mac UA gives `"desktop"`, and the cookie has `Max-Age=31536000` and `Path=/`.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- viewport
# Expected: all viewport tests pass
```

**Out of scope:** any other file in `@carbon/utils`.

## Task 2: `Viewport.tsx` in `@carbon/react`

**Depends on:** Task 1
**Files:**
- Create: `packages/react/src/Viewport.tsx` (via `git mv packages/react/src/Compact.tsx packages/react/src/Viewport.tsx`)
- Delete: `packages/react/src/hooks/useIsMobile.ts`
- Modify: `packages/react/src/hooks/index.ts` — remove `useIsMobile`
- Modify: `packages/react/src/index.tsx` — export `ViewportProvider`, `useViewport` instead of `CompactProvider`, `useCompact`
- Modify: every `packages/react/src/*.tsx` that imports from `./Compact` — import from `./Viewport`

**Steps:**
1. In `Viewport.tsx`, keep the SPDX header and `HitArea`. Change the `HitArea` classes from `compact:` to `max-md:`.
2. Replace the context, provider and hooks with:
   - Context value `{ initialViewport: Viewport } | null`.
   - `ViewportProvider({ initialViewport, children })`. On mount, compute the size from `PHONE_QUERY` and `TABLET_QUERY`, write `viewportHintCookie(size)`, and rewrite it on each `change` event of both queries.
   - `readViewport(): Viewport`: `"phone"` if `PHONE_QUERY` matches, `"tablet"` if `TABLET_QUERY` matches, else `"desktop"`.
   - `subscribe` adds the `change` listener to both media query lists.
   - `useViewport()`: `const size = useSyncExternalStore(subscribe, readViewport, () => context?.initialViewport ?? "desktop")`; return `useMemo(() => ({ isPhone: size === "phone", isTablet: size === "tablet", isDesktop: size === "desktop" }), [size])`.
3. Delete `useCompact`, `useIsMobile`, `CompactProvider`. Update the doc comments: no opt-in remains.
4. Delete `hooks/useIsMobile.ts` and its import and export in `hooks/index.ts`.
5. In `index.tsx`, import and export `ViewportProvider` and `useViewport` from `./Viewport`.
6. In each `packages/react/src` file that imports `useCompact` from `./Compact`, import `useViewport` from `./Viewport`. Task 3 rewrites the calls.

**Verify:** Task 3 verifies (the package does not typecheck until call sites move).

**Out of scope:** `CompactSheet.tsx` and every other `Compact*` component name.

## Task 3: Migrate every `useCompact` / `useIsMobile` call site

**Depends on:** Task 2
**Files:** about 71 files that call `useCompact`, plus `packages/react/src/Sidebar.tsx`, `packages/react/src/FunnelChart.tsx`, `apps/mes/app/routes/x+/active.tsx`, `apps/mes/app/routes/x+/recent.tsx`, `apps/starter/app/components/Breadcrumbs.tsx`.

**Steps:**
1. Replace `const isCompact = useCompact();` with `const { isPhone } = useViewport();` (82 sites). In the same file, rename every `isCompact` identifier to `isPhone`. `CollapsibleSidebar.tsx`'s `wasCompact` ref stays.
2. Replace an inline `useCompact()` (8 sites: `useCompact() ? (` and `useCompact() ? Phone :`) with `useViewport().isPhone`.
3. Replace `const isMobile = useIsMobile();` with `const { isPhone: isMobile } = useViewport();`. Keep the local name so the rest of each file stays as it is.
4. In each file's import from `@carbon/react` (or `./hooks` / `./Compact` inside the package), swap `useCompact` / `useIsMobile` for `useViewport`. Remove duplicates.
5. If a file shadows `isPhone` already, STOP and report — do not improvise.

**Verify:**
```bash
rg -n "useCompact\b|useIsMobile|CompactProvider|initialCompact" apps packages -g '*.{ts,tsx}'
# Expected: only apps/erp/app/root.tsx (Task 4)
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/react --filter=mes --filter=starter --filter=academy
# Expected: all tasks succeed
```

**Out of scope:** props or components named `Compact*`; the `compact` prop of `Table`.

## Task 4: ERP root wiring

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/root.tsx`

**Steps:**
1. Import `getViewportHint` instead of `getCompactHint`, and `ViewportProvider` instead of `CompactProvider`.
2. In the loader, replace `compact: getCompactHint(request)` with `viewport: getViewportHint(request)`.
3. Delete `data-compact-ui=""` and its two comment lines from `<html>`.
4. Replace `<CompactProvider initialCompact={loaderData?.compact ?? false}>` with `<ViewportProvider initialViewport={loaderData?.viewport ?? "desktop"}>`, and the closing tag.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: succeeds (after Task 3)
```

**Out of scope:** the rest of `root.tsx`.

## Task 5: CSS — delete the gate, split the global phone block

**Depends on:** none
**Files:**
- Modify: `packages/config/tailwind/theme.css`
- Modify: `apps/erp/app/styles/tailwind.css`

**Steps:**
1. Delete `@custom-variant compact { … }` and its comment.
2. In `@custom-variant hover`, delete the `:where(html:not([data-compact-ui])) &:hover { @slot; }` block. Update the comment above it.
3. Update the `@utility hit-area` comment: `compact:hit-area` → `max-md:hit-area`.
4. In the `@media (width < 48rem)` phone block, keep only the two shared rules, with new selectors: `html:not(.dark) { --muted-foreground: … !important; }` and `.truncate { white-space: nowrap; }`. Update the block comment.
5. Append to `apps/erp/app/styles/tailwind.css` a `@media (width < 48rem)` block with `html { --topbar-height: calc(52px + env(safe-area-inset-top)); }` and `[data-sonner-toaster][data-y-position="bottom"] { bottom: calc(var(--content-inset, 0px) + 16px); }`, with their comments.

**Verify:**
```bash
rg -n "data-compact-ui|custom-variant compact" packages apps -g '*.{css,ts,tsx}'
# Expected: no output
```

**Out of scope:** every other rule in both files.

## Task 6: Rewrite `compact:` classes to `max-md:`

**Depends on:** none
**Files:** about 270 `.ts` / `.tsx` files under `apps/` and `packages/`.

**Steps:**
1. Run a Perl rewrite over tracked `.ts`/`.tsx` files under `apps` and `packages` that replaces `compact:` with `max-md:` only when the char before is a space, `"`, `'`, `` ` `` or `(`, and the char after is `[a-z[!-]`. This leaves `compact: true` object keys alone.
2. Check `packages/react/src/Card.tsx`: the selector `[class~='compact:hidden']` must now read `[class~='max-md:hidden']`.

**Verify:**
```bash
rg -n -e "[\"' \x60(]compact:[a-z\[!-]" apps packages -g '*.{ts,tsx,css}'
# Expected: no output
git diff --stat | tail -1
# Expected: about 270 files changed
```

**Out of scope:** `compact` props, `compactForLog`, `compactedAt`, the currency compact formatter.

## Task 7: Static verification

**Depends on:** Tasks 1–6
**Steps:**
1. Run the spec's two `rg` acceptance checks.
2. Run the typecheck for all six packages.
3. Run Biome on the changed files.
4. Run the `@carbon/utils` tests.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/react --filter=erp --filter=mes --filter=starter --filter=academy
# Expected: all succeed
pnpm exec biome check $(git diff --name-only | grep -E '\.(ts|tsx|css)$')
# Expected: no errors
```

## Task 8: Browser verification

**Depends on:** Task 7
🛑 Ask the owner first.
**Steps:**
1. Open the ERP at 375px: a list page and a record page. Compare with the pre-change build.
2. Open the same pages at 900px: the desktop layout shows.
3. Reload at 375px with the `viewport=phone` cookie: no flash of the desktop layout.
