# 004 — One set of easing tokens; give drawers the drawer curve

- **Status**: DONE
- **Commit**: 2089c5b
- **Severity**: MEDIUM
- **Category**: Easing & duration / Cohesion & tokens
- **Estimated scope**: 1 token file + 7 component files, class-string edits only

## Problem

1. There are no motion tokens. The strong ease-out curve `cubic-bezier(0.23,1,0.32,1)`
   is hand-typed 9 times as an arbitrary Tailwind value:
   `packages/react/src/NavRail.tsx:272, :282, :331`, `packages/react/src/Sidebar.tsx:246, :257, :466`,
   `apps/erp/app/components/Layout/Navigation/CollapsibleSidebar.tsx:141`,
   `apps/erp/app/components/Layout/Navigation/DetailsTopbar.tsx:120`
   (find each with `rg -n "ease-\[cubic-bezier\(0.23,1,0.32,1\)\]"`). The iOS drawer curve is typed
   in `packages/react/src/BottomSheet.tsx:60` (`SHEET_SPRING`) and `:128`.
2. The side/top/bottom `Drawer` enters with the built-in `ease-out`, which is too weak
   for a 300ms panel slide — it starts slower than the user expects:

```tsx
// packages/react/src/Drawer.tsx:105-110 — current (one of four positions)
right: "data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-200 h-full duration-300 ease-out"
```

## Target

Add tokens to the shared theme (`packages/config/tailwind/theme.css`, inside the
second `@theme inline { … }` block (opens ≈ line 223), next to the `--animate-*` entries ≈ line 316):

```css
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);        /* strong ease-out for UI */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* strong ease-in-out for on-screen movement */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);     /* iOS-like drawer curve */
```

In Tailwind v4, `--ease-*` theme variables generate `ease-out`, `ease-in-out` and
`ease-drawer` utilities — note this **redefines** the built-in `ease-out` and
`ease-in-out` utilities to the strong curves app-wide, which is the intent (every
`ease-out` in the codebase gets the stronger curve).

Then:
- Replace every `ease-[cubic-bezier(0.23,1,0.32,1)]` with `ease-out`.
- Replace `max-md:ease-[cubic-bezier(0.32,0.72,0,1)]` in `BottomSheet.tsx:128` with `max-md:ease-drawer`.
  Leave `SHEET_SPRING` (`BottomSheet.tsx:60`) as a literal: it is an inline style, and
  because the block is `@theme inline`, a `var(--ease-drawer)` reference is not
  guaranteed to resolve at runtime.
- In `Drawer.tsx` (all four positions) replace `duration-300 ease-out` with `duration-300 ease-drawer`.

## Repo conventions to follow

- Theme tokens live in `packages/config/tailwind/theme.css` `@theme` (see `--animate-accordion-down`, ≈ line 316).
- Tailwind v4 CSS-variable syntax is already used (`origin-(--radix-…)`).

## Steps

1. Add the three `--ease-*` lines to `@theme` in `packages/config/tailwind/theme.css`.
2. `rg -l "ease-\[cubic-bezier\(0.23,1,0.32,1\)\]" packages/react/src apps` → in each hit, replace that arbitrary value with `ease-out`.
3. Edit `BottomSheet.tsx:128` as in Target.
4. Edit the four `position` variants in `Drawer.tsx` as in Target.

## Boundaries

- Do NOT change durations.
- Do NOT touch `packages/config/tailwind/theme.css` `.scroll-fade` (its `1ms ease-in-out` is a scroll timeline, not a curve that matters).
- Do NOT touch the academy or starter apps' own CSS.
- If a cited line does not match (drift since 2089c5b), STOP and report.

## Verification

- **Mechanical**: `pnpm exec turbo run typecheck --filter=@carbon/react --filter=erp --filter=mes`;
  `pnpm run lint`; `rg "cubic-bezier\(0.23,1,0.32,1\)" packages/react/src apps/erp/app apps/mes/app` → no hits.
  Build the ERP CSS once (`pnpm --filter erp build` or the dev server) and confirm the
  generated `.ease-out` rule's `transition-timing-function` is `cubic-bezier(0.23, 1, 0.32, 1)`
  (inlined, because the block is `@theme inline`).
- **Feel check**:
  - Open a record's side drawer: at 10% playback it leaves the edge fast and settles
    softly (drawer curve), with no slow start.
  - Hover the NavRail and the module sidebar: the sliding hover card moves exactly as before.
  - Open any dropdown: it still feels crisp (tailwindcss-animate uses its own timing, unchanged).
- **Done when**: the three tokens exist and no hand-typed copy of either curve remains in `packages/react/src`, `apps/erp/app`, `apps/mes/app`.

## Verified

Compiled `apps/erp/app/styles/tailwind.css` with `@tailwindcss/node`. Each
`ease-*` class emits two rules: Tailwind's (`transition-timing-function` and
`--tw-ease`) and `tailwindcss-animate`'s (`animation-timing-function`), both
with the token's curve inlined. So `ease-drawer` sets the curve of the Drawer's
`animate-in` / `animate-out` slide and of BottomSheet's keyframes, and
`ease-out` / `ease-in-out` now give the strong curves to every transition and
`tailwindcss-animate` animation that uses them.
