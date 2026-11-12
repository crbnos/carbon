# Dialog closing animations — implementation plan

**Spec:** none. The design was agreed in conversation on 2026-11-06.
**Research:** none (UI behaviour fix).
**Closest sibling:** the planning order drawer (`useDrawerItem`, `apps/erp/app/hooks/useDrawerItem.ts`). It already stays mounted and closes through `open`.
**Branch:** naveenkash/new-gauge-modal-animation-audit

## Problem

Modals and drawers animate when they open. They do not animate when they close.
Radix plays the closing animation only when the dialog stays on the page and
its `open` prop changes to false. Two patterns remove the dialog in the same
render instead:

1. **Route dialogs.** A route renders a form as a modal or drawer (New Gauge,
   most New/Edit forms). `open` is always true. Closing calls `useCloseRoute()`
   or `navigate(...)`. The navigation removes the route and its dialog at once.
2. **Conditional dialogs.** `{disclosure.isOpen && <ConfirmDelete … />}`.
   Closing clears the flag, and the dialog leaves with it.

Also, the modal backdrop closed in 150ms and the modal box in 200ms. Radix
removes both when the backdrop ends, so the box animation was cut short.

## Design

- `useRouteDialog(to?, options?)` (`@carbon/react`) returns `{ open, close }`.
  `close` sets `open` to false. The hook navigates when the dialog has gone:
  to `to`, or back/parent as `useCloseRoute` does.
- `RecordOutlet` provides a React context, `RouteDialogScopeContext`. The dialog
  content reports its exit to the scope from an effect cleanup. Radix unmounts
  the content when the closing animation ends.
- If a navigation is already loading (a save's redirect), the hook waits for it.
  It does not navigate over that navigation.
- If a `Submit` in the route has unsaved changes, `close` navigates at once. The
  `Submit` blocker then asks over the open dialog. `Submit` reports its state
  with `useReportUnsavedChanges`.
- A conditional dialog stays mounted. The condition goes to `open` / `isOpen`.
- State that must start fresh on each open goes in a body component inside
  `ModalContent` / `DrawerContent`. Radix unmounts the content on close.
- A `key` that counts opens is the fallback for state that cannot move into the
  content. `.claude/rules/conventions-ui.md` names the two cases.
- A dialog that shows a record keeps the record until the next open
  (`useDrawerItem`).
- The `no-unmounting-dialog` check (`@carbon/checks`) flags the old patterns.

## Progress

- [x] Task 1: Add `useRouteDialog` and the dialog helpers
- [x] Task 2: Match the backdrop and box closing durations
- [x] Task 3: Mark a Submit with unsaved changes
- [x] Task 4: Add the `no-unmounting-dialog` check
- [x] Task 5: Convert the precedents (New Gauge, edit Gauge, CadModel delete)
- [x] Task 6: Convert every group in the worklist (8 groups, parallel)
- [x] Task 7: Typecheck, lint and test everything
- [x] Task 8: Baseline the sites that stay, with reasons
- [x] Task 9: Update docs and lessons
- [x] Task 10: Verify in the browser

## Dependencies

Tasks 1–4 come first. Task 5 needs Tasks 1–4. The 8 groups in Task 6 are
independent. Task 7 needs Task 6. Tasks 8–9 need Task 7. Task 10 needs a
running dev stack (`crbn up`).

---

## Task 1: Add `useRouteDialog` and the dialog helpers

**Depends on:** none
**Files:**
- Create: `packages/react/src/hooks/useRouteDialog.ts`
- Create: `packages/react/src/__tests__/useRouteDialog.test.tsx`
- Create: `packages/react/src/RouteDialogScope.tsx` — the scope context and `useReportUnsavedChanges`.
- Modify: `packages/react/src/utils/dialog.ts` — add `afterDialogCloses`.
- Modify: `packages/react/src/hooks/index.ts` — export `useRouteDialog`.
- Copy from (precedent): `packages/react/src/hooks/useCloseRoute.ts`

**Verify:**
```bash
pnpm --filter @carbon/react exec vitest run src/__tests__/useRouteDialog.test.tsx
# Expected: Tests 4 passed (4)
```

## Task 2: Match the backdrop and box closing durations

**Depends on:** none
**Files:**
- Modify: `packages/react/src/Modal.tsx` — add `duration-200` to `ModalOverlay`.

**Verify:** typecheck in Task 7.

## Task 3: Mark a Submit with unsaved changes

**Depends on:** none
**Files:**
- Modify: `packages/form/src/components/Submit.tsx` — call `useReportUnsavedChanges(withBlocker && isTouched && !isSubmitting)`.

**Verify:** the third test of Task 1 covers the hook side.

## Task 4: Add the `no-unmounting-dialog` check

**Depends on:** none
**Files:**
- Create: `packages/checks/src/conformance/no-unmounting-dialog.ts`
- Create: `packages/checks/src/conformance/no-unmounting-dialog.test.ts`
- Modify: `packages/checks/src/run.ts` — add it to `TS_CHECKS`.
- Copy from (precedent): `packages/checks/src/conformance/no-noop-open-change.ts`

**Verify:**
```bash
pnpm --filter @carbon/checks exec vitest run src/conformance/no-unmounting-dialog.test.ts
# Expected: Tests 4 passed (4)
```

## Task 5: Convert the precedents

**Depends on:** Tasks 1–4
**Files:**
- Modify: `apps/erp/app/routes/x+/quality+/gauges.new.tsx` — route dialog precedent.
- Modify: `apps/erp/app/routes/x+/quality+/gauges.$id.tsx`
- Modify: `apps/erp/app/components/CadModel.tsx` — conditional dialog precedent.

## Task 6: Convert every group in the worklist

**Depends on:** Task 5
**Files:** the sites the `no-unmounting-dialog` check reports, plus the routes
that close with `navigate(...)`. The run split them into 8 module groups
(`sales`, `items`, `inventory-quality`, `people-settings`, `accounting`,
`purchasing`, `production`, `shared`). The worklists were scratch files in the
gitignored `.context/`; run the check to list what is left.

A worklist line is `file:line<TAB>snippet`. The snippet is one of:
- `useCloseRoute(` — a route dialog closed with `useCloseRoute`.
- `navigate-close` — a route that closes with `navigate(...)`. Convert it only
  when it renders a modal or drawer.
- an opening tag — a conditional dialog.

**Steps for a route dialog:**
1. Replace `const closeRoute = useCloseRoute();` with `const dialog = useRouteDialog();`.
2. For `navigate(path.to.x)`, use `useRouteDialog(path.to.x)`. Keep the same navigate options.
3. For `navigate(-1)`, use `useRouteDialog()`.
4. Pass `open={dialog.open}` and the close prop (`onClose={dialog.close}`) to the dialog.
5. Make sure the dialog component takes `open` and passes it to its root `Modal`, `Drawer` or `ModalDrawer`.
6. If the component has no `open` prop, add `open?: boolean` with default `true`.
7. Keep extra logic in a close handler. Call `dialog.close()` at its end.
8. Do not change a navigation that runs after a successful save.

**Steps for a conditional dialog:**
1. Remove the `{condition && …}` wrapper.
2. Pass the condition to the open prop: `isOpen` for `Confirm`/`ConfirmDelete`, `open` for `Modal`/`Drawer`/`ModalDrawer`.
3. Replace a bare `open` or `isOpen` with the condition.
4. When the dialog shows a record, keep `{record && <D isOpen={x.isOpen} />}`.
5. Then remove the code that clears the record on close. The next open sets it.
6. Check the top level of the dialog component for state or effects that must reset per open.
7. If they must reset, move them to a body component inside the content.
8. If a dialog is not a Radix dialog, leave it and report it.

**Verify:**
```bash
sh .context/remaining.sh <group>
# Expected: only the sites the agent reported as left, each with a reason
```

**Out of scope:** `packages/react`, `packages/form`, `packages/checks`. Ternaries (`cond ? <D/> : null`).

## Task 7: Typecheck, lint and test everything

**Depends on:** Task 6

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/react --filter=@carbon/form --filter=@carbon/checks --filter=@carbon/printing
# Expected: all tasks successful
pnpm exec biome check <changed files>
# Expected: no errors
pnpm --filter @carbon/react test && pnpm --filter @carbon/checks test
# Expected: all tests pass
```

## Task 8: Baseline the sites that stay, with reasons

**Depends on:** Task 7
**Files:**
- Modify: `packages/checks/src/conformance/baseline.json` — add one entry per site that stays. Do not regenerate the whole baseline.

**Verify:**
```bash
pnpm --filter @carbon/checks test
# Expected: all tests pass, no new violations
```

## Task 9: Update docs and lessons

**Depends on:** Task 7
**Files:**
- Modify: `packages/react/AGENTS.md` — Overlays: route dialogs use `useRouteDialog`. Drawer closing animation: same rule for every dialog.
- Modify: `packages/checks/AGENTS.md` — add `no-unmounting-dialog`.
- Modify: `.ai/lessons.md` — widen the drawer lesson to every dialog and to route dialogs.

## Task 10: Verify in the browser

**Depends on:** Task 7 and a running dev stack
**Steps:**
1. Open New Gauge. Close it with the X, Escape, Cancel and a click outside.
2. Trace `data-state` and `getBoundingClientRect()` per frame. Closing frames must exist.
3. Change a field, then close. The Unsaved changes prompt must show over the open dialog.
4. Delete a record through `ConfirmDelete`. The modal must animate closed.
