# Keyboard-nav polish — implementation plan

**Spec / source:** `.ai/specs/2026-09-29-keyboard-nav-polish.md`
**Branch:** `feat/keyboard-nav-polish` (worktree `/Users/aashu/work/carbon/carbon-feat-keyboard-nav-polish`)
**Commits:** NONE without explicit user permission (user rule overrides ship-it's per-task commit).

> **Revision (2026-09-29):** Delete has no menu key. Everything below about `delete`/Backspace, the Delete confirmation rule, and Delete skips is superseded — see the spec changelog.

## Progress
- [x] Task 1: Workflow Runs record names
- [x] Task 2: Go-to keycaps on sidebar rail items
- [x] Task 3: Pagination tooltip labels
- [x] Task 4: Menu shortcut mechanism in @carbon/react (+ unit tests)
- [x] Task 5: Menu keys in the `?` overlays + UI conventions doc
- [x] Task 6: Roll out `shortcut` props across ERP and MES menus
- [ ] Task 7: End-to-end verification

## Dependencies
Tasks 1, 2, 3, 4 are independent. Task 5 and 6 need Task 4. Task 7 needs all.

---

## Task 1: Workflow Runs record names

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/routes/x+/workflows+/runs.tsx` — loader also returns `recordNames`
- Modify: `apps/erp/app/modules/workflows/ui/Runs/WorkflowRunsTable.tsx` — accept `recordNames`, pass `name` to `EntityRecordLink`, use name in `exportValue`
- Copy from (precedent): `apps/erp/app/routes/x+/workflows+/runs.$runId.tsx:54-57` (calls `getWorkflowRunRecordNames`), `WorkflowRunDetail.tsx:170-177` (passes `name=`)

**Steps:**
1. In the `runs.tsx` loader, after `getWorkflowRuns`, build `refs` = distinct `{ table: triggerTable, id: triggerRecordId }` for rows where both are non-null. Call `getWorkflowRunRecordNames(client, companyId, refs)` once (same client/companyId the loader already uses). Return `recordNames` alongside `data`/`count`. Import it from the same place `runs.$runId.tsx` does.
2. Pass `recordNames` from the route component to `<WorkflowRunsTable>`; add `recordNames: Record<string, string>` to its props.
3. In the Record column cell: `const name = recordNames[`${triggerTable}:${triggerRecordId}`]` → `<EntityRecordLink table={triggerTable} id={triggerRecordId} name={name} />`. The column `useMemo` deps must include `recordNames`.
4. `exportValue`: `name ?? `${row.triggerTable} ${row.triggerRecordId}`` (keep "" when no record).
- If `getWorkflowRunRecordNames`'s return shape is not a `"table:id"`-keyed record, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: ... successful, no errors
```

**Out of scope:** `EntityRecordLink` internals, the run detail drawer, the service function.

## Task 2: Go-to keycaps on sidebar rail items

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/components/Layout/Navigation/PrimaryNavigation.tsx`
- Copy from (precedent): the Search button's ⌘K badge in the same file (`ShortcutKey variant="small"` with `group-data-[state=expanded]:opacity-100`, ~lines 304-311)

**Steps:**
1. Add optional prop `goToKey?: string` to `NavigationIconButtonProps`.
2. Everywhere `NavigationIconLink` is rendered for a module (the `links.map`, the sortable item if it renders `NavigationIconLink`, and Settings), pass `goToKey={MODULE_GO_TO[link.key]}`.
3. In `NavigationIconLink`, when `goToKey` is set, render after the label span:
   ```tsx
   <span aria-hidden className={cn(
     "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5",
     "opacity-0 transition-opacity duration-100",
     "group-data-[state=expanded]:group-hover/item:opacity-100",
     "group-data-[state=expanded]:group-focus-visible/item:opacity-100"
   )}>
     <ShortcutKey shortcut={MODULE_GO_TO_PREFIX} variant="small" className="mx-0" />
     <ShortcutKey shortcut={goToKey} variant="small" className="mx-0" />
   </span>
   ```
   If Tailwind's stacked group variants (`group-data-[...]:group-hover/item:`) don't apply at runtime, use `group-hover/item:opacity-100` alone plus hiding the whole span with `group-data-[state=collapsed]:hidden`.
4. Hide the hints while `editMode.isEditing` (shortcuts are disabled then).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```
Manual (Task 7): hover Items in expanded rail → `G` `T` keycaps on that row only.

**Out of scope:** `MODULE_GO_TO` letters, MES `AppSidebar`, `MobileNavigation`.

## Task 3: Pagination tooltip labels

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/components/Table/components/Pagination/Pagination.tsx`
- Copy from (precedent): `apps/erp/app/components/Layout/Navigation/DetailSidebar.tsx:53-80` (TooltipContent with text + `ShortcutKey`)

**Steps:**
1. In all four `TooltipContent`s (condensed prev/next, full prev/next) render
   `<div className="flex items-center gap-2"><Trans>Previous page</Trans><ShortcutKey shortcut={PAGINATION_SHORTCUTS.previous} variant="small" /></div>` (and `Next page` / `.next`). Match DetailSidebar's markup if it differs.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```

**Out of scope:** the double ←/→ binding (harmless, spec Risks), other prev/next buttons outside `Pagination.tsx`.

## Task 4: Menu shortcut mechanism in @carbon/react

**Depends on:** none
**Files:**
- Modify: `packages/react/src/utils/keyboard.ts` — extract `isTextEntryTarget`
- Create: `packages/react/src/utils/menuShortcut.ts`
- Create: `packages/react/src/__tests__/menuShortcut.test.ts`
- Modify: `packages/react/src/shortcuts.ts` — add `MENU_ITEM_SHORTCUTS`
- Modify: `packages/react/src/Dropdown.tsx` — `shortcut` prop on `DropdownMenuItem`; `onKeyDown` on `DropdownMenuContent` + `DropdownMenuSubContent`
- Modify: `packages/react/src/Context.tsx` — same for `ContextMenuItem`, `ContextMenuContent`, `ContextMenuSubContent`
- Modify: `packages/react/src/Menu.tsx` — `MenuItem` passes `shortcut` through (check its prop type union)
- Modify: `packages/react/src/index.tsx` — export `MENU_ITEM_SHORTCUTS` if `shortcuts.ts` exports aren't already re-exported wholesale
- Copy from (precedent): `packages/react/src/__tests__/useShortcutSequence.test.ts` (pure-function tests, node env — no jsdom)

**Steps:**
1. `keyboard.ts`: add `export function isTextEntryTarget(target)` = the INPUT/TEXTAREA/SELECT/contenteditable part; make `isEditableTarget` call it first. No behavior change for `isEditableTarget`.
2. `shortcuts.ts`:
   ```ts
   /** One-key shortcuts for menu items — active only while their menu is open. */
   export const MENU_ITEM_SHORTCUTS = {
     edit: "e", rename: "r", pin: "p", duplicate: "c", copy: "c",
     download: "d", view: "o", open: "o", delete: "backspace"
   } as const;
   export type MenuItemShortcut = (typeof MENU_ITEM_SHORTCUTS)[keyof typeof MENU_ITEM_SHORTCUTS];
   ```
3. `menuShortcut.ts` (pure, testable):
   - `menuShortcutFromEvent(e: { code: string; key: string; metaKey; ctrlKey; altKey; shiftKey }): string | null` → null if any modifier; `"backspace"` for key `Backspace` or `Delete`; lowercase letter for code `KeyA`–`KeyZ`; else null.
   - `handleMenuShortcutKeyDown(event: React.KeyboardEvent<HTMLElement>)`: returns early if `event.defaultPrevented`, `isTextEntryTarget(event.target)`, or `(event.target as Element).closest("[role=menu]") !== event.currentTarget`. Compute key; query `event.currentTarget.querySelectorAll('[role=menuitem][data-menu-shortcut="<key>"]:not([data-disabled])')`, keep those whose `closest("[role=menu]") === event.currentTarget`; in dev (`process.env.NODE_ENV !== "production"`, match how the package already checks dev — grep `useShortcutKeys.ts` duplicate warning) warn if >1; take the first; `preventDefault()`, `stopPropagation()`, `(item as HTMLElement).click()`.
4. `DropdownMenuItem` / `ContextMenuItem`: add `shortcut?: MenuItemShortcut`. When set: `data-menu-shortcut={shortcut}` and append `<DropdownMenuShortcut><ShortcutKey shortcut={shortcut} variant="small" className="mx-0" /></DropdownMenuShortcut>` after `children` (render children explicitly — destructure `children`). Note: `asChild` items render a single child, so the keycap cannot be appended — for `asChild`, set only the data attribute (key still works) and skip the keycap.
   - If `asChild` + data attribute doesn't land on the rendered element, STOP and report.
5. Content components: compose `onKeyDown={(e) => { props.onKeyDown?.(e); handleMenuShortcutKeyDown(e); }}`.
6. Tests (`menuShortcut.test.ts`): `menuShortcutFromEvent` — KeyE→"e", Backspace→"backspace", Delete→"backspace", ctrl+KeyE→null, Digit1→null, Escape→null, shift+KeyE→null.

**Verify:**
```bash
pnpm --filter @carbon/react exec vitest run src/__tests__/menuShortcut.test.ts src/__tests__/useShortcutKeys.test.ts
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/react
# Expected: success
```

**Out of scope:** Radix typeahead config, `ActionMenu` trigger, Command palette.

## Task 5: Menu keys in the `?` overlays + conventions doc

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/components/ShortcutHelp.tsx`, `apps/mes/app/components/ShortcutHelp.tsx` — "Menus" group
- Modify: `.claude/rules/conventions-ui.md` (§ Keyboard shortcuts), `packages/react/AGENTS.md` (Shortcuts bullet)

**Steps:**
1. Add group `t\`Open menus\`` with entries: Edit (e), Rename (r), Pin (p), Duplicate or copy (c), Download (d), View or open (o), Delete (backspace) — each `shortcut: MENU_ITEM_SHORTCUTS.x`. Import from `~/shortcuts` if the app file re-exports, else `@carbon/react`.
2. Docs: one paragraph — menu items take `shortcut={MENU_ITEM_SHORTCUTS.x}`; key is live only while the menu is open (handled on menu content, not a document listener); Delete is wired only when it confirms first.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: success
```

## Task 6: Roll out `shortcut` props across ERP and MES menus

**Depends on:** 4
**Files:** every `.tsx` in `apps/erp/app` and `apps/mes/app` with a `DropdownMenuItem`, `ContextMenuItem` or `MenuItem` whose visible label starts with Edit, Rename, Pin, Unpin, Duplicate, Copy, Download, View, Open, Delete.

**Steps:**
1. Inventory: `grep -rlE "(DropdownMenuItem|ContextMenuItem|MenuItem)" apps/erp/app apps/mes/app --include=*.tsx`; in each file find items whose label (`<Trans>Verb…`, `t\`Verb…\``, or plain text) starts with a verb above. Write the inventory to `.ai/plans/2026-09-29-keyboard-nav-polish.rollout.md` (file, line, label, key, wired/skipped + reason).
2. Add only `shortcut={MENU_ITEM_SHORTCUTS.<verb>}` to each item. Import `MENU_ITEM_SHORTCUTS` from `@carbon/react`. No other edits.
3. **Delete rule:** wire Delete only if selecting it opens a confirmation (e.g. `ConfirmDelete`, a delete modal/route with a confirm, `disclosure.onOpen` for a confirm dialog). If it fires a fetcher/submit that deletes immediately, skip and record the reason.
4. **Per-menu conflict rule:** if two items in the same menu would get the same key (e.g. Copy + Duplicate, View + Open), wire only the first and record the skip.
5. Items using `DropdownMenuCheckboxItem`/`RadioItem`, or menus inside inputs/comboboxes, are skipped.
6. Can be split by module across parallel subagents (disjoint file sets).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: success
pnpm run lint
# Expected: no new errors
```

**Out of scope:** changing labels, icons, handlers, or menu structure; adding shortcuts to other verbs.

## Task 7: End-to-end verification

**Depends on:** 1–6
**Steps:**
1. `pnpm --filter @carbon/react test` — all pass.
2. Run the ERP app (use the `run` skill / project dev command; needs `.env.local` from dev tooling) and check every acceptance criterion in the spec with agent-browser: runs page names + links, rail keycaps + G T, pager tooltips, row menu E / Backspace, closed-menu no-op, submenu scoping, typeahead fallthrough, `?` overlay group.
3. If the app can't be run (DB/stack not up), report BLOCKED with the exact error — do not claim done.
