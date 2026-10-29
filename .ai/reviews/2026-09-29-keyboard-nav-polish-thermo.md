# Thermo-nuclear review — feat/keyboard-nav-polish

Scope: full uncommitted diff (230 files). Core logic in 10 files; the other 220 carry the mechanical `shortcut={MENU_ITEM_SHORTCUTS.x}` rollout.

**Verdict: not approved yet.** There are no correctness regressions, and no file crossed 1,000 lines (checked every changed file against HEAD). But five behavior-preserving restructures would each delete a moving part rather than move it. Findings 1 and 2 are the big ones.

---

## 1. Workflow Runs: attach the name to the row in the loader; drop the map prop and the ref (code judo)

`runs.tsx` returns a separate `recordNames` map. `WorkflowRunsTable` then:
- takes it as a new prop,
- mirrors it into `recordNamesRef` (so the `[t]`-memoised columns can read it),
- rebuilds the `${triggerTable}:${triggerRecordId}` key twice (once in the cell, once in `exportValue`).

Adding the prop to the `memo(({ data, count }) =>` signature also made biome re-indent the whole component, which is why a ~10-line change shows as **270 changed lines** (`WorkflowRunsTable.tsx`).

**Remedy.** In the loader, map the name onto each row once:

```ts
data: data.map((run) => ({
  ...run,
  recordName: run.triggerTable && run.triggerRecordId
    ? recordNames[`${run.triggerTable}:${run.triggerRecordId}`]
    : undefined
}))
```

The table then reads `row.original.recordName`. This deletes:
- the prop,
- the ref,
- both client-side key builds,
- the reformat noise.

The `table:id` key stays inside the loader, next to the service that defines it.

## 2. Menu keys in the `?` overlay are copy-pasted into both apps; the shared overlay should own them (SSOT)

`apps/erp/.../ShortcutHelp.tsx` and `apps/mes/.../ShortcutHelp.tsx` each gained the same 35-line block of 7 entries. Menu keys are behaviour of `@carbon/react`'s shared menu parts. `ShortcutHelpOverlay` also lives in `@carbon/react` and already uses Lingui (`ShortcutHelpOverlay.tsx:1,47`).

**Remedy.** Build the "In an open menu" group inside `ShortcutHelpOverlay` from `MENU_ITEM_SHORTCUTS`. Revert both app files. That removes 70 duplicated lines and a second source of truth that will drift the first time a verb is added.

## 3. Dropdown and Context carry four copies of the same keydown composition and two copies of the item-body logic

- `DropdownMenuContent`, `DropdownMenuSubContent`, `ContextMenuContent` and `ContextMenuSubContent` each inline the same composition: `onKeyDown={(event) => { onKeyDown?.(event); handleMenuShortcutKeyDown(event); }}`.
- `DropdownMenuItem` and `ContextMenuItem` each inline the same `asChild || !shortcut ? children : <>{children}<Shortcut>…` branch, with a duplicated JSX comment.

**Remedy.** In `utils/menuShortcut.ts`:
- Export `withMenuShortcuts(onKeyDown?)`, which returns the composed handler. Each content component then becomes a one-liner.
- Export a tiny `MenuItemShortcutKey` (the keycap with `mx-0`). Both items render `{children}{shortcut && !asChild && <XShortcut className="pl-4"><MenuItemShortcutKey …/></XShortcut>}`.

The asChild rule is then stated once, in `menuShortcut.ts`, instead of in two JSX comments.

## 4. Sidebar hint: `goToKey` is a pass-through prop the component can derive itself

`NavigationIconLink` already receives `link`, and every caller passes `goToKey={MODULE_GO_TO[link.key]}`. The implementation link (`get-started`) has no entry, so a lookup inside the component yields `undefined`, which is the same as not passing the prop. Changing the `forwardRef` signature also caused another re-indent (`PrimaryNavigation.tsx` shows 126 changed lines).

**Remedy.** Compute `const goToKey = MODULE_GO_TO[link.key]` inside `NavigationIconLink`. Delete the prop, the two call-site edits and the reformat.

## 5. Pagination: four identical tooltip bodies

`Pagination.tsx` now has the same `<TooltipContent><HStack><span><Trans>…</Trans></span><ShortcutKey …/></HStack></TooltipContent>` shape four times (condensed/full × previous/next). The duplication was there before the change, but this diff doubled the size of each copy.

**Remedy.** Add a local `PaginationTooltip({ label, shortcut, children })` that wraps `Tooltip`/`TooltipTrigger asChild`/`TooltipContent`. That cuts about 40 lines, and the four call sites then read as what they are.

---

## Checked and fine

- **Menu handler scoping is correct.**
  - Radix composes `props.onKeyDown` before its own handler and skips it when `defaultPrevented`, so typeahead can't double-act.
  - `stopPropagation` stops the portal bubble into the parent menu.
  - The `closest("[role='menu']") === menu` filter keeps submenu items separate.
- `isTextEntryTarget` is split out of `isEditableTarget` rather than re-implemented, as the conventions require.
- `MenuItemShortcut` is typed to the constant's values, so a combo like `mod+e` (which the bare-key parser would never match) cannot be passed.
- **Rollout diff is clean.** Every non-`shortcut` line in the 220 rollout files is a biome reflow or import-list change; no logic was touched. Conditional keys (`cond ? edit : view`) follow the label's own condition.
- **Delete safety:** 20 non-confirming Delete items are skipped, each with a recorded reason (`.ai/plans/2026-09-29-keyboard-nav-polish.rollout.md`).
- No file crossed 1,000 lines.

## Not flagged (considered)

- `MENU_ITEM_SHORTCUTS` has alias keys (`copy`/`duplicate`, `view`/`open`). They make call sites read by their own verb; collapsing them would save two lines and cost clarity.
- The DOM-query dispatch (`data-menu-shortcut` + `querySelectorAll`) versus a React context registry. The registry would need register/unregister effects per item across four content types. The DOM query is smaller and has no lifecycle.

---

## Outcome (applied 2026-09-29)

1. **Fixed.** The loader maps `recordName` onto each row, and the table uses a `WorkflowRunListItem` type. The prop, the ref and the client-side keys are gone. The `WorkflowRunsTable.tsx` diff went from 270 changed lines to 30.
2. **Fixed.** `ShortcutHelpOverlay` appends the "In an open menu" group itself. Both app `ShortcutHelp.tsx` files are back to their HEAD versions.
3. **Fixed.** `withMenuShortcuts(onKeyDown)` in `utils/menuShortcut.ts` replaces the four inline compositions. The asChild note now lives once, in each item's `shortcut` prop docs. The item-body ternary stays: an `asChild` Slot must get exactly one child, so `{children}{false}` is not safe.
4. **Reverted: the finding was wrong.** The implementation nav item is typed `Authenticated<NavItem>`, which has no `key`; only `ModuleDefinition` adds it. Deriving the letter inside the component would need a cast or an optional `key`. The caller-supplied `goToKey` prop is the honest boundary, so it stays.
5. **Fixed.** A local `PaginationTooltip({ direction })` replaces the four copies.

Verification: typecheck for erp, mes and @carbon/react passes. `@carbon/react` vitest: 42/42. Biome: 0 errors; the 10 warnings are pre-existing, in lines this diff doesn't touch.
