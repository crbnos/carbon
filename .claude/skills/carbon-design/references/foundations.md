# Visual foundations — color, surfaces, type, spacing, radius, icons

Read this when you set any class that affects color, size, spacing, radius, border, shadow,
font or icon. Values here were read from source on 2026-09-28; if a primitive changed since,
the primitive wins — re-read it.

## Contents
1. Color tokens and what each is for
2. Semantic color usage (the rules)
3. Surfaces and elevation
4. Typography
5. Spacing and density
6. Radius, borders, shadows
7. Icons
8. Dark mode and themes

---

## 1. Color tokens

Tokens are CSS variables injected on `<html>` per user theme (8 themes in
`packages/utils/src/themes.ts`, default `zinc`/"Modern"), mapped to Tailwind in
`packages/config/tailwind/theme.css`. **Never assume the primary is blue** — themes change it.

| Token (Tailwind) | Light (zinc) | Role |
|---|---|---|
| `bg-background` | gray 95% | app chrome: nav rail, page canvas, secondary-button fill, Properties panel (`bg-background/30`) |
| `bg-card` | white | the content you work in: content panel, `CardContent`, Modal, table, drawer body |
| `bg-popover` | white | dropdowns, popovers, tooltips (primitives set it) |
| `bg-muted` / `/50` `/40` `/30` | gray 93% | trays (Tabs list), row hover/selected, subtle fills, Modal footer bar (`bg-muted/40`) |
| `bg-accent` / `/60` `/30` | gray 96% | `Card` shell tray, dropdown focus, hover fill, selected explorer row (`bg-accent/60`) |
| `bg-active` + `text-active-foreground` | gray 85% | Button `active` variant, selected nav item |
| `text-foreground` | near-black | primary text |
| `text-muted-foreground` | gray 46% | secondary text, labels, metadata, decorative icons |
| `bg-primary` / `text-primary` | ink (theme-dependent) | primary button, count bubbles, links in places, selection tint `bg-primary/10` |
| `destructive` | red | destructive button, form errors, invalid border (`border-destructive`) |
| `border` / `input` | gray 90% | all borders (global `* { border-border }` — plain `border` is enough) |
| `ring` | ink | input focus ring (`focus-visible:ring-ring/50`) |
| `success` | green | **defined but ~unused** — don't build on it; use `Status color="green"` or `text-emerald-500` icons |

There is **no `warning` or `info` token**. Warnings use `Status`/`Badge` yellow/orange,
`Alert variant="warning"|"info"`, or an amber *icon*.

`secondary` (`bg-secondary`) is effectively unused. Don't introduce it.

## 2. Semantic color — the rules

1. **Neutral text:** `text-foreground` or `text-muted-foreground`. Never `text-gray-*`,
   `text-zinc-*`, `text-slate-*`. For slightly-muted in-between, `text-foreground/70-80`.
2. **Status:** only through `<Status color>` or Badge color variants (see
   `status-and-feedback.md`). Seven names: `gray yellow blue orange green red purple`.
3. **Categorical kind (type/entity):** hue identifies *kind* — domain icon maps in
   `apps/erp/app/components/Icons.tsx`, search entity chips; user-defined values via
   `Enumerable` (hash-colored, meaningless by design).
4. **Signed / threshold data:** `text-red-500` for negative, overdue, failed values in cells
   (e.g. overdue due date). Positive is usually just neutral; `text-emerald-500` only when
   "on time/good" genuinely needs affirming next to a red counterpart.
5. **Prose is never colored for status.** No `text-green-*`, `text-emerald-*`,
   `text-amber-*`, `text-yellow-*` sentences ("Planned automatically", "Low confidence").
   Use `text-muted-foreground` + a `Lu*` icon (`LuCircleCheck`, `LuTriangleAlert`) and let the
   words carry the meaning (`.ai/ds-rules.md`). Chips, dots, and severity icons may carry hue.
6. **Charts:** `hsl(var(--chart-1..6))` and theme vars, never hex.
7. **Hue recipe when you truly need a tinted chip or cell** (match `Badge`): light
   `bg-{hue}-100 text-{hue}-800 border-{hue}-500/20`, dark `dark:bg-{hue}-500/15
   dark:text-{hue}-400`. Green is **emerald**, purple is **violet**. A bare 500-level hue
   (`text-red-500`, `bg-emerald-500` dot) reads in both modes without a `dark:` pair.
8. **Trends and deltas** ("+12% vs last month", "3 fewer late receipts"): a `Badge
   variant="green"|"red"` next to the value, as the purchasing dashboard does
   (`apps/erp/app/routes/x+/purchasing+/_index.tsx`) — not colored text, not colored arrows.
9. **Numbers inside sentences are never colored** ("82% loaded · 40h of 48h"): keep the
   sentence muted; if the value is a problem, put a red `Badge` or a `LuTriangleAlert` icon
   beside it.
10. **Magnitude encodings (heatmaps, load grids, density):** use **a few discrete bands, never
    a continuous multi-hue ramp** or graded opacity steps, and show the number in every cell
    (`tabular-nums`) so color is never the only signal.
    - If a sibling view already encodes the same measure, **reuse its exact bands** — same
      thresholds, same classes, ideally the same exported function/constants — so two views
      never disagree. Work-center load today: `loadCellClass` in
      `apps/erp/app/modules/production/ui/Schedule/People/PeopleCapacity.tsx` (> 120% red,
      > 100% amber, else emerald, all as `bg-{hue}-500/15 text-{hue}-700 dark:text-{hue}-400`).
      If it isn't exported, propose exporting it rather than copying the numbers.
    - With no sibling, healthy values stay **neutral** and hue appears only at problem
      thresholds (near → yellow/amber tint, over → red tint).
11. **Accent for "the thing that is selected/focused":** `bg-accent/60`, `bg-muted`,
   `bg-primary/10`, `border-primary ring-2 ring-primary/20` for selected cards/choices — never
   a saturated fill.

## 3. Surfaces and elevation

```
body / nav rail .......................... bg-background (gray)
 └ content panel (md+: inset, rounded-2xl) bg-card (white)
    ├ Card shell ......................... bg-accent + shadow-button-base + rounded-xl  (the tray)
    │  ├ CardHeader ...................... transparent, px-6 py-4, text-muted-foreground
    │  └ CardContent ..................... bg-card + border + rounded-xl + p-6        (the paper)
    ├ Tabs list .......................... bg-muted tray; active tab bg-background + shadow
    ├ Table .............................. bg-card; row hover bg-muted
    └ inner boxes ........................ rounded-lg border p-3|p-4 (bg-card or bg-muted/40)
overlays: Modal bg-card rounded-2xl, footer bar border-t bg-muted/40
          Drawer floats inset p-3, shell bg-accent > DrawerBody bg-card rounded-xl
          Popover / Dropdown / Tooltip bg-popover rounded-md border shadow-md
Properties panel ......................... bg-background/30 border-l, w-96
```

Rules:
- **Compose `Card > CardHeader + CardContent`.** Content placed directly in `<Card>` reads gray.
  Never hand-roll a top-level card from `rounded-lg border bg-card`.
- **One edge per surface.** Don't put a border on something whose primitive already draws a
  shadow edge (a bordered `CardContent` under a `CardHeader` → `CardContent className="border-0"`
  with `CardHeader className="border-b border-border"`, per `.ai/lessons.md` "The design-system
  `Card` is a gray tray").
- **Tinting a Card shell** requires the `dark:` twin (`bg-emerald-500/5 dark:bg-emerald-500/5`)
  or the base `dark:bg-card` silently wins in dark mode.
- **Detail content area:** copy the background class of the sibling 3-pane route verbatim
  (currently `bg-muted dark:bg-card` on all 23 of them — see `anti-patterns.md` §Carbon's own
  drift). Don't invent a third option.
- **Scroll:** the page (or the content pane) is the only scroll surface. No `max-h` +
  `overflow-y-auto` regions inside cards (`.ai/lessons.md` "Card lists never get their own
  scroll region").
- **Full-height calcs** inside the content panel subtract `var(--topbar-height)`,
  `var(--header-height)` and `var(--content-inset)`; prefer `h-full` inheritance for new pages.

## 4. Typography

Fonts: Geist (sans, everything), Geist Mono (`font-mono`, ids/codes/system text), Hedvig
Letters Serif (`font-headline`, **page titles only via `Heading` display/h1/h2/h3**).

| Role | Use | Resulting style |
|---|---|---|
| Public / onboarding / greeting title | `Heading size="display"` or `"h1"` | serif |
| List page title | `Table title=…` (renders `Heading h2`) | serif `md:text-2xl` |
| Settings page / section title / DocumentHeader | `Heading size="h3"` | serif `md:text-xl` |
| Record header ID (SO-000123) | `Heading size="h4"` | **sans** `md:text-base text-sm font-medium` |
| Card / Modal / Drawer title | `CardTitle` / `ModalTitle` / `DrawerTitle` | sans `text-base font-medium tracking-tight` |
| Card / Modal description | `CardDescription` / `ModalDescription` | `text-xs` / `text-sm` muted |
| Eyebrow / group label | `Subheading variant="heavy"` (reports) or `"light"` (Properties, sidebars); `as="h3"` when it's a real heading | uppercase, tracked, small |
| Settings group label | `SettingsSectionHeader` | wraps `Subheading light` |
| Body / cells / inputs / menu items | — | `text-sm` |
| Labels, metadata, helper, errors | — | `text-xs` (labels `font-medium text-muted-foreground`) |
| Micro meta | `text-xxs` (10.8px token) | only when `text-xs` truly won't fit |
| IDs, codes, JSON, serials | `font-mono text-xs` (often `text-muted-foreground`) | |
| Any number that changes or aligns | `tabular-nums` | |
| KPI value | `MetricCard` (`text-4xl tabular-nums`) | |

Rules:
- Weight: `font-medium` is the emphasis weight (71%). `font-semibold` for totals rows and KPI
  numbers. `font-bold` only inside Badge and document-summary line totals. Never
  `font-extrabold`/`font-black`.
- **No arbitrary sizes** (`text-[11px]`, `text-[13px]`) in new code even though ~170 exist.
- **Uppercase is component-owned** (Badge/Status, `Subheading`, the mono empty-state label).
  Don't hand-write `uppercase tracking-wide` labels — use `Subheading`.
- Never a raw `<h1 className="text-xl font-semibold">` page title — use `Heading`.
- Wrapping: `text-balance` on titles, `text-pretty` on body (Tailwind v4 names), `truncate` /
  `line-clamp-1` in dense rows; `min-w-0` on flex children that must truncate. `truncate` is
  inert on `Heading` (it sets `text-balance`) — wrap it or use `noOfLines`.
- Page-level serif is a **brand moment**; never use `font-headline` on card, drawer, modal or
  record-header titles. A component rendered *inside* a page (a view, a panel, a section)
  never renders `Heading` h1–h3 — it titles itself with `CardTitle`, `Subheading`, or the
  host page's existing title (e.g. the `Table` title).
- Hover detail uses `Tooltip`, never the native `title=` attribute.

## 5. Spacing and density

Scale is 4px-based and dominated by **4 / 8 / 16**, with 6px for icon-text pairs.

| Use | Value |
|---|---|
| Icon + text in a chip/meta row | `gap-1` / `gap-1.5` |
| Default gap between siblings | `gap-2` (most used utility) |
| Between blocks / cards on a page | `gap-4`, `VStack spacing={4}` |
| Form grid | `grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4` (edit), `md:grid-cols-2` (create) |
| Drawer form fields | `VStack spacing={4}` single column |
| Detail content pane | `VStack spacing={4} className="p-4"` |
| Card internals | `CardHeader px-6 py-4`, `CardContent p-6` (from the primitive — don't override) |
| Inner bordered box | `p-3` or `p-4` |
| Page-level / empty-state breathing | `py-8`–`py-16`, settings page `py-12 px-4` |

Controls (heights): Button `sm h-6 · md h-8 (default) · lg h-11`; IconButton 24/32/44;
Input/Select `sm h-8 · md h-10 (default) · lg h-12`; table rows 44px. **Same-row buttons share a
size.** ERP uses md/sm; MES uses lg (see `shop-floor-mes.md`).

`VStack`/`HStack` take `spacing` (VStack 0,1,2,3,4,8; HStack 0,1,2,3,4,6,8), are
`space-y/x-*` based and `VStack` is `w-full`. Prefer `gap-*` when a child may inject siblings at
runtime (e.g. `Hyperlink` prefetch links) — `space-*` then adds a phantom margin
(`.ai/lessons.md` "`space-x-*` gives a phantom margin"). A flex child that fills the rest of a
row is `flex-1 min-w-0`, never `w-full`; fixed siblings get `shrink-0`.

Content widths are capped: full-page create `max-w-4xl`, posting documents `max-w-5xl`,
settings `max-w-[60rem]`, party records `max-w-[80rem]`. `2xl:` is never used; `xl:` rarely.

## 6. Radius, borders, shadows

`--radius` = 7px. `rounded-sm` 3 · `rounded-md` 5 · `rounded-lg` 7 · `rounded-xl` 11 ·
`rounded-2xl` 15 · `rounded-full` pills/avatars/dots.

| Element | Radius |
|---|---|
| App content panel, Modal | `rounded-2xl` (primitive) |
| Card shell, CardContent, Drawer body | `rounded-xl` (primitive) |
| Buttons, inputs, badges, popovers, dropdowns, tooltips | `rounded-md` (primitive) |
| **App-built inner boxes, list items, tiles** | `rounded-lg` |
| Dropdown items, small buttons | `rounded-sm` |

App code uses `rounded-lg`/`rounded-md`; `xl`/`2xl` belong to primitive shells. No `rounded-3xl`.

Borders: 1px `border` (color is global). Dividers `border-b` / `divide-y`, faded
`border-border/60`. Drop zones and "add" placeholders `border-dashed`. Inputs are **flat
bordered fields with no shadow** (`fb5a23f67c`).

Shadows: recipe shadows (`shadow-button-base`, dark inset stacks) live in primitives. App code
uses at most `shadow-sm` for small floating chips/drag previews; overlays get theirs from the
primitive. No `shadow-2xl`. Don't use the defined-but-dead tokens `shadow-popover`,
`shadow-dropdown-item`, `shadow-select-item`, `shadow-button-danger`.

## 7. Icons

- **Library: Lucide via `react-icons/lu` only** (`Lu*`, ~96% of icons). No other react-icons
  sets, no `lucide-react`, no inline `<svg>` for new work. A missing glyph is added the way
  `apps/erp/app/assets/icons/BanknoteArrows.tsx` does it (GenIcon with Lucide path data, stroke 2).
- **Sizing:** bare `<LuX />` renders at 1em and inherits size from text; `Button leftIcon` /
  `rightIcon` and `IconButton` size icons themselves (don't add classes). Explicit sizes:
  `size-4` (16px) standard, `size-3.5`/`size-3` in dense meta rows and chips, `size-6`/`size-8`
  only for empty-state or hero icons. Prefer `size-*` over `h-4 w-4` in new code.
- **Color:** inherit, or `text-muted-foreground`. Hue only when the icon *is* the status or
  type signal (`LuTriangleAlert text-red-500` for overdue, domain type icons).
- **Icon + text vs icon-only:** actions with a visible label use `leftIcon`. Icon-only is for
  universally understood, repeated, space-constrained actions (⋮, copy, link, close, panel
  toggles, drag handle, chevrons) and must be an `IconButton` with a translated `aria-label`,
  usually wrapped in a `Tooltip`. If the action needs a word to be understood, it gets a word.
- **Shared icon vocabulary** — reuse, don't re-pick:

| Meaning | Icon |
|---|---|
| Record ID column | `LuBookMarked` |
| Status column | `LuStar` |
| Dates (created, due, order) | `LuCalendar` |
| Person (created by, assignee) | `LuUser`; customer `LuSquareUser`; supplier `LuContainer` |
| Quantity / number | `LuHash` |
| Location | `LuMapPin`; tags `LuTag`; item group `LuGroup`; email `LuMail` |
| Edit / Delete | `LuPencil` / `LuTrash` |
| Add | `LuCirclePlus` (buttons), `LuPlus` (compact) |
| More options | `LuEllipsisVertical` (never horizontal) |
| Explorer / Properties toggles | `LuPanelLeft` / `LuPanelRight` |
| Warning / error inline | `LuTriangleAlert`; confirmed `LuCircleCheck`; copy `LuCopy`; link `LuLink` |
| Domain types | `MethodIcon`, `MethodItemTypeIcon`, `TrackingTypeIcon`, `TimeTypeIcon`, `OperationStatusIcon` from `apps/erp/app/components/Icons.tsx` |
| Module icons | `apps/erp/app/hooks/useModules.tsx` |

## 8. Dark mode and themes

`.dark` class on `<html>` swaps every variable, so **token-only UI needs no `dark:` classes**.
You need `dark:` only when you use a raw palette hue (then use the Badge recipe in §2) or tint
a primitive shell. In dark mode `card` is *darker* than `background` — never assume "card is
lighter". Test both modes and at least one non-zinc theme (e.g. `blue`) when you introduce any
color.
