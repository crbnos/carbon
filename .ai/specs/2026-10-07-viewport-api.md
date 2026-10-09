# Viewport API: `max-md:` and `useViewport()`

> Status: approved
> Date: 2026-10-07
> Extends: `.ai/specs/2026-10-07-mobile-chrome-structure.md` (B3, one compact signal)

## TL;DR

- `compact:` classes become Tailwind's own `max-md:`. The query stays the same (`width < 48rem`).
- `useCompact()` and `useIsMobile()` become one `useViewport()` → `{ isPhone, isTablet, isDesktop }`.
- The ERP-only `data-compact-ui` gate goes away, because MES goes responsive on this branch.
- `Compact*` components keep their names. "Compact" is a shape that phone and tablet can share.
- Tablet is 768–1023px. It keeps the desktop layout for now.
- Phone rendering in the ERP does not change.

## Problem

The phone layout is switched by a custom Tailwind variant (`compact:`) and a hook
(`useCompact()`). Both only work in apps that set `data-compact-ui` on `<html>`.
Today that is only the ERP. The variant is a yes/no switch, so it has no room for
a tablet size.

MES will get its responsive pass on this branch before the PR. After that, both
main apps use the phone layout and the per-app gate has no job left. This change:

- replaces `compact:` with Tailwind's own `max-md:` (the same `width < 48rem` query);
- replaces `useCompact()` and `useIsMobile()` with one `useViewport()` that returns
  `{ isPhone, isTablet, isDesktop }`;
- removes the `data-compact-ui` gate.

"Compact" stays as the name of the **component shape** (`CompactToolbar`,
`CompactSheet`, `CompactList` …). A compact component can later serve phone and
tablet both; the device choice is made at the call site with `useViewport()`.

Research: N/A. This is an internal rename. The only external fact it depends on is
Tailwind's own `max-md:` output. Tailwind 4.3.0 compiles `max-*` to
`@media (width < var(--breakpoint-*))` (`tailwindcss/dist`), and its default
`--breakpoint-md` is `48rem` and `--breakpoint-lg` is `64rem`
(`tailwindcss/theme.css:328-329`). The repo does not override them.

## Goals

- One device API in JS: `useViewport()` with three booleans.
- Standard Tailwind prefixes in CSS, so nobody has to learn a custom variant.
- Phone rendering in the ERP stays the same, pixel for pixel.
- A tablet size exists in the hook, ready for a later tablet pass.

## Non-goals

- No tablet layout. At 768–1023px the ERP keeps the desktop layout, as today.
- No `tablet:` custom variant. Tablet styles use `md:max-lg:` when they are needed.
- No rename of compact components or their shape props (`CompactToolbar`,
  `CompactSheet`, `CompactTabRow`, `stackOnCompact`, `compactFooterClassName`,
  `useCompactCssVar`, `useCompactModuleSidebar` …).
- No `ViewportProvider` in MES, academy or starter. The MES responsive pass adds
  it to MES.
- Unrelated "compact" names stay: `compactForLog`, `compactedAt`, the compact
  currency formatter, and so on.

## Design

### CSS (`packages/config/tailwind/theme.css`)

- Delete `@custom-variant compact`.
- Every `compact:` class becomes `max-md:` (about 1,400 classes in about 270 files). This includes
  the class-name selector in `Card.tsx` (`[class~='compact:hidden']` →
  `[class~='max-md:hidden']`). TS object keys such as `compact: true` stay as they are.
- `@utility hit-area` stays; its uses become `max-md:hit-area`. Update its comment.
- `@custom-variant hover`: remove the `:where(html:not([data-compact-ui]))` branch. Hover
  then applies where the pointer can hover, or at 48rem and wider, in every app.
- The global phone block (`@media (width < 48rem)`, `theme.css:445-463`) splits in two:

  | Rule | Goes to | Why |
  |---|---|---|
  | Darker `--muted-foreground` in light mode | `theme.css`, selector `html:not(.dark)` | Contrast fix, good for every app |
  | `.truncate` keeps `white-space: nowrap` | `theme.css`, selector `.truncate` | Ellipsis fix, good for every app |
  | `--topbar-height: 52px + safe area` | `apps/erp/app/styles/tailwind.css`, selector `html` | Only the ERP reads `--topbar-height` |
  | Sonner toast offset from `--content-inset` | `apps/erp/app/styles/tailwind.css` | Only the ERP sets `--content-inset` |

  Both new blocks keep the `@media (width < 48rem)` wrapper.

### Viewport constants (`packages/utils/src/viewport.ts`)

```ts
export type Viewport = "phone" | "tablet" | "desktop";
export const PHONE_QUERY = "(width < 48rem)";
export const TABLET_QUERY = "(48rem <= width < 64rem)";
export const VIEWPORT_HINT_COOKIE = "viewport";
export function getViewportHint(request: Request): Viewport;  // cookie, else UA "Mobi" → phone, else desktop
export function viewportHintCookie(viewport: Viewport): string;
```

These replace `COMPACT_QUERY`, `COMPACT_HINT_COOKIE`, `getCompactHint` and
`compactHintCookie`. The cookie value is the size name. The old `compact` cookie
is never read: this branch has not shipped, so no browser has it.

### Hook and provider (`packages/react/src/Viewport.tsx`, was `Compact.tsx`)

```ts
export const ViewportProvider: (p: { initialViewport: Viewport; children }) => JSX.Element;
export function useViewport(): { isPhone: boolean; isTablet: boolean; isDesktop: boolean };
export const HitArea: () => JSX.Element; // unchanged, its classes move to max-md:
```

- One `useSyncExternalStore`. It subscribes to both media queries, and its snapshot is the
  `Viewport` string, a stable primitive. The hook derives the three booleans from that one
  value, so they can never disagree.
- Server snapshot: the provider's `initialViewport`, else `"desktop"`. That is the old
  `false` for apps with no provider.
- `ViewportProvider` writes the hint cookie on mount and on every size change, as
  `CompactProvider` does now.
- Deleted: `useCompact`, `useIsMobile`, `CompactProvider`, `hooks/useIsMobile.ts` and
  its export from `hooks/index.ts`.

### Call sites

- `const isCompact = useCompact()` becomes `const { isPhone } = useViewport()`, and the
  local `isCompact` references become `isPhone`. Props named `isCompact` that describe a
  component's shape keep their name.
- `useIsMobile()` callers (`Sidebar`, `FunnelChart`, MES `active.tsx`/`recent.tsx`,
  starter `Breadcrumbs.tsx`) become `useViewport().isPhone`.
- ERP `root.tsx`: remove `data-compact-ui`; `getCompactHint` → `getViewportHint`;
  `CompactProvider initialCompact` → `ViewportProvider initialViewport`.

### Behaviour changes (accepted)

- In MES, academy and starter, shared components now take their phone form below 48rem.
  `Popover` becomes a bottom sheet, and `Tabs`, `Card`, `Input` and others restyle.
  Academy uses `Input`/`Popover`/`Tooltip`; starter uses `Input`.
- In those apps, sticky hover highlights no longer show after a tap on phones.
- In those apps, phones also get the darker muted text and the `.truncate` ellipsis fix.
- MES phones show the ERP phone styling until the MES responsive pass.

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| CSS prefix | Tailwind `max-md:` | Same query as `compact:`. With no gate there is nothing custom left |
| Tablet in CSS | `md:max-lg:`, no custom variant | Standard Tailwind. Add a variant only if it is used a lot |
| Hook shape | `{ isPhone, isTablet, isDesktop }`, from one size value | Owner's call: booleans read best in JSX, and one source means no conflicts |
| Tablet range | 48rem ≤ width < 64rem | Tailwind md→lg; iPad portrait is tablet, landscape is desktop |
| Per-app gate | Removed | MES goes responsive on this branch before the PR |
| Component names | Keep `Compact*` | "Compact" is a shape that phone and tablet can share; the device choice stays at the call site |
| Cookie value | Size name (`phone`/`tablet`/`desktop`) | The hook has three sizes; a 1/0 value cannot carry them |
| UA fallback | `Mobi` → phone, else desktop | Same as today; tablet uses the desktop layout anyway |
| Legacy `compact` cookie | Not read | The branch has not shipped |
| File name | `Compact.tsx` → `Viewport.tsx` | The file now holds the device API, not a component shape |

## Acceptance criteria

- [ ] `rg -e "[\"' \x60]compact:[a-z\[!-]" apps packages -g '*.{ts,tsx,css}'` returns nothing.
- [ ] `rg "useCompact\b|useIsMobile|CompactProvider|data-compact-ui|COMPACT_QUERY|COMPACT_HINT|getCompactHint|compactHintCookie|initialCompact" apps packages` returns nothing.
- [ ] Typecheck passes for `@carbon/utils`, `@carbon/react`, `erp`, `mes`, `starter` and `academy`; Biome passes.
- [ ] The ERP at 375px: a list page (for example Sales Orders) and a record page match the
      pre-change screenshots. At 1280px they also match. (Browser check, only with the owner's go-ahead.)
- [ ] The ERP at 900px renders the desktop layout, and `useViewport()` reports `isTablet: true`.
- [ ] A first load with the cookie `viewport=phone` server-renders the phone layout, with no
      flash of the desktop layout.

## Open questions (resolved)

- [x] Rename `compact:` to `phone:`, or use Tailwind's `max-md:`? — **Answer:** `max-md:`. The
      gate goes away once MES is responsive on this branch, and then `compact:` is just `max-md:`.
- [x] What happens to the `data-compact-ui` gate? — **Answer:** Remove it. Academy/starter
      side effects and the interim MES styling are accepted.
- [x] Hook return shape? — **Answer:** Booleans `{ isPhone, isTablet, isDesktop }`, derived from
      one size value inside the hook.
- [x] Tablet width range? — **Answer:** 48rem–64rem.
- [x] Rename `Compact*` components to Phone/Mobile? — **Answer:** No. "Compact" names the
      shape and can cover phone and tablet; only the device API is renamed.
- [x] The gate also wraps a global phone CSS block. Where does each rule go? — **Answer:** The
      contrast and truncate fixes apply in every app. The top bar height and the toast offset
      move to ERP's `tailwind.css`, because only the ERP uses their variables.
- [x] Sequencing with the chrome-structure work? — **Answer:** The owner committed it first; the tree is clean.

## Changelog

- 2026-10-07: Draft written after the design discussion.
