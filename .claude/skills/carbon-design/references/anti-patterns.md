# Anti-patterns — what Carbon intentionally does not do

Three kinds:
1. **Generic SaaS reflexes** — technically fine, but they make a screen feel un-Carbon.
2. **Legacy patterns** — Carbon used to do these and deliberately moved away. Some still exist
   in the code; don't copy them.
3. **Carbon's own drift** — places where the codebase is inconsistent today, and what to do.

---

## 1. Generic SaaS reflexes

### Layout and hierarchy
- A hero/page header (title + subtitle + illustration + big CTA) above a list. → The `Table`
  `title` *is* the page title; one "Add X".
- Stacked tables or many widgets on one list page. → One table per list route; dashboards only
  on module landing pages.
- Client-side tabs for record sections. → Route tabs (`DetailsTopbar`) / Explorer / header view
  switcher.
- A detail page as one long form. → Header strip + Explorer | content cards | Properties.
- Metadata mixed into the main form or displayed as a big key/value table in the content. →
  Properties panel.
- Line items as a big editable spreadsheet in the content pane. → Explorer + Summary.
- Wide-screen layouts that stretch forever. → capped `max-w-*`.
- Nested scroll regions inside cards. → the page scrolls.
- Center-aligned content blocks / marketing-style sections in app pages.

### Visual
- Brand-colored primary buttons, colored headings, colored section backgrounds.
- Green/amber/yellow sentences to signal status. → muted text + `Lu*` icon; status chips.
- Big drop shadows, `rounded-2xl`/`3xl` on app boxes, gradients on panels, glassmorphism.
- Borders on top of primitive shadow edges (double lines); hand-rolled cards.
- Bold (`font-bold`/`semibold`) body text for emphasis; `text-lg`+ for card titles.
- Arbitrary sizes (`text-[13px]`, `h-[37px]`), raw grays (`text-gray-500`), hex colors.
- Icons from other sets, colored decorative icons, icon-only buttons for actions that need a word.
- Illustrations or large emoji in empty states; confetti; "🎉" toasts.
- Right-aligned numeric columns in list tables; bold totals.

### Interaction
- "Edit" button → edit mode → Save/Cancel for a document. → always editable, locked by status;
  Properties autosave.
- Autosave on create forms or multi-field edits. → explicit Save.
- Multiple primary buttons; a primary Cancel; a destructive action as a visible one-click button.
- Undo snackbars instead of confirmation. → `ConfirmDelete`; soft delete where reversible.
- `window.confirm`, hand-rolled confirm dialogs.
- Hiding controls a user lacks permission for. → disable.
- Warning banners for decisions. → Modal with explicit choices.
- Separate "View" / "Edit" / "Delete" buttons on every row. → `renderContextMenu`.
- Floating "+" action buttons on desk screens. → "Add X" in the title bar (FAB is MES-only).
- Hover-scale animations, bouncy springs, page transitions, `transition-all`.
- A spinner covering the page for data loads. → skeleton / NProgress / `isLoading` button.
- Toast for validation errors. → inline field errors.
- Required-field asterisks. → "Optional" tag.
- Custom "?" tooltips on labels. → `termId` glossary help.
- Hand-rolled `keydown` listeners, combo string literals at call sites.
- Drawer opening another drawer; modal for long read-only content.
- Holding view state in `useState` that should survive refresh (tab, filter, selected record).
- Records listed as `div` stacks with fixed-width columns inside drawers/modals. → `TableBase`
  primitives with Hyperlink IDs and the entity's Status.
- A drawer/popover that opens before its data and shows the empty message or the previous
  selection's rows while loading. → skeleton, then data or empty.
- Several submits looped on one fetcher; closing the modal immediately after submit. → one
  server-side bulk submission; close on success.
- Trend arrows in green/red text; colored numbers inside sentences. → `Badge green|red`.
- Continuous rainbow/graded heat ramps. → discrete bands, number in every cell.
- Comparison matrices with criteria as rows when users need to pick the best row. → items as
  rows, sortable criteria as columns.
- Native `title=` tooltips. → `Tooltip`.
- Designing against invented APIs (props, route helpers, columns) or restating a sibling's
  constants from memory. → open the source; import the constant.

### Usability and robustness
- A page that only displays: values the sibling lets users change (quantity, price, dates,
  customer, terms) shown as text. → line form card, Properties autosave, form cards
  (`functionality.md`).
- Disabled "not available" placeholders for actions you didn't wire. → wire the real route,
  or leave the capability out and say why.
- Re-implementing a mutation (price resolution, lock checks, status derivation) the record's
  existing route already does. → post to that route.
- Text in flex rows without `min-w-0` + `truncate`: names run under trailing quantities and
  off the panel edge. IDs that wrap ("MTR-" / "9000"). Tables whose last column is clipped
  inside a card. Tooltip wrappers that break a `w-full` button.
- Declaring UI done after typecheck/lint without rendering it at desk and phone widths and
  using it once.

### Copy
- "Oops!", "Successfully saved! 🎉", exclamation marks, marketing voice.
- Sentence-case buttons/headers in ERP; Title Case toasts.
- English literals "for now"; concatenated translated fragments; "(s)" plurals.
- Data-model words where users have their own ("Procedure" for operators, "entity", "record").
- Showing raw UUIDs, raw enum values, or ISO timestamps.

## 2. Legacy patterns — don't copy even if you see them

| Legacy | Use instead | Moved in |
|---|---|---|
| `hover:scale-95` on buttons, `transition-all` | `active:scale-[0.96]`, scoped transitions | `6ac029e9d3`, `099ff087c2` |
| `shadow-sm` on inputs/selects | flat bordered fields | `fb5a23f67c` |
| Card with `border` + dark gradient; hand-rolled `rounded-lg border bg-card` cards | `Card > CardHeader + CardContent` | `4d7500407a`, `c238af5f5a` |
| Modal as a gray tray with an inset white body; Modal on `bg-background` | single `bg-card` modal + muted footer bar | `3afa609c17`, `920b207e92` |
| Edge-attached drawer | floating drawer (primitive) | `30fd547b16` |
| `bg-muted` app-shell/entity layouts | `bg-card` content on `bg-background` chrome | `8aa53b0439`, `3237d6a639` |
| Ad-hoc uppercase eyebrow labels (`text-xxs uppercase tracking-wide …`) | `Subheading` | `6409f4bc4e` |
| Raw `<h1 className="text-xl font-semibold">` titles; `font-headline` on card/modal titles | `Heading`; sans titles | `2fffd20eab` |
| Amber/green status text | `Badge`/`Status`, or muted text + icon | `c10513d5c9` |
| Loud `Alert variant="warning"` for context | calm Card with one accent icon / `Alert info` | `b15cb4e9f2` |
| Solid colored Badges for flags | outline Badge / dot + label | `e984069683` |
| Plain Badge for lookup values; non-wrapping chip rows | `Enumerable` / `EnumerableGroup` +N | `fb87a5ac41`, `4634b460f0` |
| Local status color maps; Status without icon | `status-colors.ts` + `Status` | `771e6b5069`, `ba3a286b5c` |
| `toLocaleString`, `new Date()` display | `DateTime`, formatter hooks | `c0f5783516` |
| `LoadingBars` | `CarbonPulse` | `2fffd20eab` |
| `useKeyboardShortcuts`, `usePrettifyShortcut` | `Button shortcut`, `useShortcutKeyMap` | `c1d997d77e` |
| `Progress` | `BarProgress` | `fe93c3c0b1` |
| Pill (`rounded-full`) tabs | `Tabs` primitive | `409850aab5` |
| Capped `max-h` + inner scroll on card lists | natural height | `a277baeadd` |
| Hard-coded `h-[50px]` headers; `100dvh` calcs without the inset | `h-[var(--header-height)]`, subtract `--content-inset` | `7f5f1d2145`, `6409f4bc4e` |
| Auth screens inside a bordered card | form directly on background | `c249b2fe76` |
| Selection ring on read-only cells | ring only on editable cells | `6ea9142601` |
| "No results / Remove Filters" for pre-filtered tables | `emptyState` neutral sentence | `678cf28e16` |
| Combobox "Add X" button empty state | inline sentence link (`useEmptyState`) | `ce5aa7d0d8` |
| Tables for small rich config sets | cards + drawer | `ad9e436003` |
| Posting-group-style N×M config matrices | flat defaults + per-entity override | `.ai/lessons.md` |
| Collapsed line-item forms when editing | expanded by default | `540abad96d` |
| Emoji in CTAs/confirmations | plain copy | `1640fdd35e` |
| `Spinner className="h-8 w-8"` | `Spinner size={32}` | — |
| Non-Lucide icons (`BsThreeDotsVertical`, `IoMdAdd`, `RxCheck`, `FaTrash`) | `LuEllipsisVertical`, `LuPlus`, `LuCheck`, `LuTrash` | — |

## 3. Carbon's own drift — what to do today

| Where Carbon is inconsistent | Do this |
|---|---|
| Detail content pane background: `6409f4bc4e` moved it to `bg-card`, the Returns PR `9b26ab2dc1` put `bg-muted dark:bg-card` back; all 23 3-pane routes use the latter today | Copy the sibling route shell verbatim for consistency; mention it in your summary as an open question — don't introduce a third value |
| Card radius: docs say `rounded-2xl`/`rounded-lg`, code is `rounded-xl` | Trust the primitive; never override Card radius |
| "Shadows over borders" (conventions-ui) vs borders dominant in app code | Shadows belong to primitives; app inner boxes use `border rounded-lg` |
| Header transitions: show-all-disabled (Quote) vs show-only-valid (RMA) | Either, consistently within the header; next step always visible and primary |
| Button/menu casing drift to sentence case in Aug–Sep 2026 features | Title Case, unless the same module is consistently sentence case |
| Status word colors (`Closed`, `Pending`, `In Progress`) | Choose by lifecycle position; follow the entity family's existing map |
| Success toast grammar mixed | "Updated X" / "X created" / "X deleted" |
| Arbitrary micro text sizes (~170 uses) | `text-xs`, or `text-xxs` if you must |
| `text-amber-*` (~50 uses) | amber only as an icon/dot accent |
| Raw status enums in ~26 wrappers | translate in the wrapper |
| Hover reveals without focus reveals | add `focus-visible`/`group-focus-within` |
| Ellipsis aria-labels vary | "More options" |
| Focus ring: Button blue halo vs fields `ring-ring` | reuse the primitive; for new field-like elements use the `ring-ring/50` recipe |
| `.claude/rules/conventions-ui.md` / `packages/react/AGENTS.md` claims that disagree with code | code wins; note the discrepancy in your summary |

Rule of thumb from `principles.md` §4: majority in code → newest canonical module (Sales Return
Orders) → written rule — and never copy anything in section 2.
