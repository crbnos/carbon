# Keyboard-nav polish: run record names, go-to hints, pager tooltips, menu letter keys

> Status: draft
> Author: Aashu
> Date: 2026-09-29

## TLDR

Four small, independent improvements to the ERP UI:

1. The Workflow Runs list shows each run's record by name, and the name links to the record.
2. The left sidebar shows the G-then-letter shortcut that already exists for each module.
3. The table Previous/Next tooltips say what the buttons do, alongside the key.
4. Menu items get one-key shortcuts that work only while their menu is open.

No schema changes. Research: `.ai/research/keyboard-nav-polish.md`.

## Problem Statement

1. **Workflow Runs → Record** shows "Purchase Order po_01J…" instead of the record's number or name. The list loader never looks names up (`routes/x+/workflows+/runs.tsx`), though the run drawer already does (`getWorkflowRunRecordNames`, `runs.$runId.tsx:54-57`).
2. **Module go-to**: G-then-letter navigation already works (`MODULE_GO_TO`, `apps/erp/app/shortcuts.ts:68-85`; wired in `PrimaryNavigation.tsx:62-80`). But the sidebar never shows the letters, so nobody finds them outside the `?` overlay.
3. **Pagination tooltips**: the Previous/Next tooltip contains only a `ShortcutKey` for ←/→. `ShortcutKey` draws those keys as chevron icons (`ShortcutKey.tsx:36-45`), so the tooltip reads as a bare "chevron arrow" with no words.
4. **Menus**: no menu item has a key of its own. Radix typeahead only moves focus to the first item that starts with the typed letter; it does not run the item. Acting from a More menu therefore always takes a mouse click or arrow keys plus Enter.

## Proposed Solution

### 1. Workflow Runs record names

- **List loader (`runs.tsx`):** after `getWorkflowRuns`, collect the distinct non-null `{table: triggerTable, id: triggerRecordId}` pairs on the page. Call `getWorkflowRunRecordNames(client, companyId, refs)` once; it already makes one query per table, so there is no N+1. Return `recordNames` (a `Record<"table:id", string>`).
- **`WorkflowRunsTable`:**
  - Accept `recordNames`.
  - The Record cell passes `name={recordNames[`${table}:${id}`]}` to the existing `EntityRecordLink`. That component already renders a `Hyperlink` to `getEntityPath(id)`, so the name is the link.
  - When a table isn't in `fkDisplayRegistry` or the record was deleted, the current fallback applies: label plus id.
  - `exportValue` uses the name when one is present (CSV shows what the user sees).

### 2. Go-to hints on the sidebar

- `NavigationIconLink` takes an optional `goToKey` (the letter from `MODULE_GO_TO[link.key]`).
- When the rail is expanded, the hovered or focused item shows two small keycaps on the right edge, `G` and the letter. Hovering is what expands the rail, so this is the moment the user is looking at that item.
- Styling follows the existing ⌘K badge on the Search button (`PrimaryNavigation.tsx:304-311`): `ShortcutKey variant="small"`, `pointer-events-none`, and opacity driven by `group-data-[state=expanded]` plus `group-hover/item` / `group-focus-visible/item`.
- Settings (pinned at the bottom) gets the same hint.
- Shop Floor has no letter and shows nothing.
- The letter map is unchanged.

### 3. Pagination tooltips

- In both modes of `PaginationButtons` (condensed header icons and the full footer buttons), `TooltipContent` becomes a translated label followed by the keycap: **"Previous page ←"** and **"Next page →"**.
- The wording matches the `?` overlay entries (`ShortcutHelp.tsx:78-84`).
- Layout: a flex row with a gap; the text is wrapped in `<Trans>`.

### 4. Menu letter keys

**Mechanism (shared, `packages/react`)**

- `DropdownMenuItem` and `ContextMenuItem` gain an optional `shortcut?: ShortcutInput` prop. `MenuItem` passes it through.
  - When set, the item renders the keycap on its right (`ShortcutKey variant="small"`, inside the existing `DropdownMenuShortcut` / `ContextMenuShortcut` slot).
  - The item also carries a `data-menu-shortcut` attribute holding the normalised key.
- The content components (`DropdownMenuContent`, `DropdownMenuSubContent`, `ContextMenuContent`, `ContextMenuSubContent`) get a composed `onKeyDown`. On keydown it:
  1. Handles the key only when there are no modifiers, the event target is not an input, textarea or contenteditable, and the target's nearest `[role=menu]` is this content element. That last check matters because React portals bubble keydown from a submenu up to its parent content.
  2. Finds an enabled `[role=menuitem][data-menu-shortcut=<key>]` whose nearest `[role=menu]` is this content.
  3. If one is found: `preventDefault`, `stopPropagation` (so Radix typeahead does not also act), then `.click()` the item. Radix runs `onSelect`/`onClick` and closes the menu as it would for a pointer click. `asChild` Link items navigate.
  4. If none is found, the event passes through untouched, so Radix typeahead and arrow keys behave as today.
- **Scoping:** the handler lives on the menu content, which is only mounted while the menu is open. No document listener exists, so keys can never fire from a closed menu. Page-level hotkeys already stand down inside `[role=menu]` (`packages/react/src/utils/keyboard.ts:7-16`), so there are no double fires.
- **Key matching:**
  - Letters match on `event.code` (`KeyE`), the same physical-key matching react-hotkeys-hook uses, so non-Latin layouts work.
- **Duplicate keys in one menu:** a dev-only `console.warn`, and the first item in DOM order wins.

**Shared letter set: `MENU_ITEM_SHORTCUTS` in `packages/react/src/shortcuts.ts`**

| Verb (label starts with) | Key |
|---|---|
| Edit | E |
| Rename | R |
| Pin / Unpin | P |
| Duplicate / Copy | C |
| Download | D |
| View / Open | O |

**Rollout:** every menu item in `apps/erp` and `apps/mes` whose label starts with one of these verbs gets `shortcut={MENU_ITEM_SHORTCUTS.<verb>}`. Items with any other label are left alone.

**Delete key:** Backspace (or Delete) on a Delete item, only when choosing it opens a confirmation first. Items that delete immediately get no key. Items with a keycap never wrap their text.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Go-to letter map | Keep the existing `MODULE_GO_TO` | Already on main, conflict-free (T Items, V Invoicing, I Inventory), and listed in the `?` overlay; the user chose to keep it |
| Where go-to hints show | Keycaps on the hovered/focused rail item while the rail is expanded | The rail expands on hover, so a collapsed-state tooltip would never be seen; showing hints on every row at once would be noisy |
| Record link style | The name is the `Hyperlink` (via `EntityRecordLink`) | Matches the PO/SO tables and this table's own Workflow column; the user's choice |
| Pager tooltip | Label + keycap | The tooltip must say what the button does; the user's choice |
| How menu items get keys | Explicit `shortcut` prop, no auto-assignment | Predictable letters that don't shift when items hide or labels are translated; the user's choice |
| Delete key | Backspace/Delete, confirm-first items only | The key only opens the confirmation, so nothing is removed in one keystroke; the user's call, restoring the original Backspace decision |
| Scoping of menu keys | `onKeyDown` on menu content, not a document listener | Content is mounted only while the menu is open, so scoping comes for free; no global binding to guard |
| react-hotkeys-hook for menu keys | Not used | The convention bans hand-rolled *document* listeners. This is an element-scoped React handler. `useHotkeys` would need a ref per content plus its menu/typeahead suppression, and `isEditableTarget` treats `[role=menu]` as editable, so it would suppress exactly the keys we need |
| Shortcut constants location | `packages/react/src/shortcuts.ts` | Menus are shared parts used by ERP and MES; the convention puts shared combos there |

## Data Model Changes

N/A: no schema changes. Item 1 reads existing columns through an existing service function.

## API / Service Changes

- `routes/x+/workflows+/runs.tsx` loader also returns `recordNames`. There is no new service function (it reuses `getWorkflowRunRecordNames`).

## UI Changes

- `apps/erp/app/modules/workflows/ui/Runs/WorkflowRunsTable.tsx`: Record cell name and export value.
- `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx`: go-to keycaps on rail items and Settings.
- `apps/erp/app/components/Table/components/Pagination/Pagination.tsx`: tooltip text.
- `packages/react/src/Dropdown.tsx`, `Context.tsx`, `Menu.tsx`, `shortcuts.ts`: the menu shortcut mechanism and constants.
- Menu call sites across `apps/erp` and `apps/mes` get `shortcut` props (the mechanical rollout).
- `apps/erp/app/components/ShortcutHelp.tsx` (and the MES equivalent) gain a "Menus" group listing the letter set.
- `.claude/rules/conventions-ui.md` § Keyboard shortcuts gains a paragraph on menu item keys.
- All new copy is Lingui-translated.

## Acceptance Criteria

- [ ] On `/x/workflows/runs`, a run triggered by a purchase order shows the PO number (e.g. "PO000123"), not the `po_…` id. Clicking it opens that PO.
- [ ] A run whose record table isn't in `fkDisplayRegistry` still shows the label plus id, and still links when a route exists.
- [ ] CSV export of the runs table contains the same record text as the cell.
- [ ] With the rail expanded, hovering Items shows `G` `T` keycaps on that row only. Pressing G then T goes to Items. Shop Floor shows no keycaps.
- [ ] Hovering the table header's Previous icon shows "Previous page" with a ← keycap; the footer's Next button shows "Next page" with a → keycap. ← and → still page.
- [ ] Opening a table row's action menu (three-dot or right-click) that has "Edit …" and "Delete …": pressing E runs Edit and closes the menu; Backspace opens the Delete confirmation.
- [ ] With no menu open, pressing E on the page does nothing menu-related.
- [ ] In a menu with a submenu open, a letter pressed inside the submenu runs only the submenu's matching item.
- [ ] Typing in a NumberField inside a menu (Quote line pricing) never triggers a menu key.
- [ ] Typing a letter that no item owns still moves focus the Radix typeahead way.
- [ ] Every wired item shows its keycap; the `?` overlay lists the menu keys.
- [ ] `pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/react` and `pnpm run lint` pass; the new keydown logic has unit tests.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Large mechanical rollout touches many files and invites merge conflicts | Med | Change only the `shortcut` prop, one commit per module, no other edits |
| Letter keys steal Radix typeahead for that letter | Low | Only for letters an item owns; others fall through unchanged |
| Header and footer pagination both bind ←/→ | Low | Already the case on main, and harmless: both call `gotoPage(pageIndex + 1)` with the same value (`usePagination.ts:37-39`). Out of scope |

## Open Questions

- [x] G-then-letter scope: redesign or keep? — **Answer:** keep the existing map and add sidebar hints.
- [x] How do menu items get letters? — **Answer:** an explicit `shortcut` prop; no auto-assignment.
- [x] Workflow run record opening style? — **Answer:** the name is the Hyperlink (existing `EntityRecordLink`).
- [x] Pager tooltip content? — **Answer:** label plus keycap ("Previous page ←").
- [x] Delete key in menus? — **Answer:** Backspace/Delete on confirm-first items (briefly dropped, then restored).
- [x] Rollout scope? — **Answer:** the mechanism plus every menu item starting with a common verb (Edit, Rename, Pin, Duplicate/Copy, Download, View/Open, Delete) across ERP and MES.

## Changelog

- 2026-09-29: Created
- 2026-09-29: Dropped the Delete menu key (user decision); Delete items get no shortcut
- 2026-09-30: Restored the Delete menu key (Backspace/Delete, confirm-first items only); keycap items no longer wrap
