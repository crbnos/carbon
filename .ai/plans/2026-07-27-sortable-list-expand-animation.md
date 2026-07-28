# SortableList expand/collapse animation — implementation plan

**Spec:** none (direct user request — fix the BOP/BOM card expand animation everywhere, verify no regression from the shared-component change)
**Research:** none
**Branch:** main (working tree only — do NOT commit unless explicitly asked)

## Background — what the bug was

`SortableListItem` (`apps/erp/app/components/SortableList.tsx`) is the expandable
card shell used by all six BOM/BOP editors. Expanding a card changed its geometry
**instantly** in two places, and framer-motion's `layout` projection on
`Reorder.Item` animated those jumps:

1. `style={isExpanded ? { marginTop: 10, marginBottom: 10, ... } : { ... }}` — the
   card's top edge dropped 10px the moment it opened.
2. The inner container flipped `block` → `flex flex-col`, activating a dormant
   `gap-2` (+8px between the header row and the detail panel).

On top of that, every caller's `renderExtra` had the same three defects:

- `<div key={`${isOpen}`}>` — the changing key remounted the whole subtree on every
  toggle, so `AnimatePresence` never ran an exit animation (close = instant snap).
- `AnimatePresence mode="popLayout"` around a child with **no** `exit` prop and no
  stable `key`.
- Stacked entrance delays: `DirectionAwareTabs` faded in with `delay: 0.3`, the
  form wrapper with `delay: 0.15`, and the toggle icon used a `1.95s` blur spring.

**Already fixed (do not redo):**

- `apps/erp/app/components/SortableList.tsx` — margin swap removed, container is
  now unconditionally `flex flex-col` with no `gap-2`.
- `apps/erp/app/components/DirectionAwareTabs.tsx` — removed `delay: 0.3`; changed
  `animate={{ height: bounds.height }}` → `animate={{ height: bounds.height || "auto" }}`
  so a parent `height: auto` measurement doesn't read 0 and clip.
- `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` — `renderExtra` rewritten
  to a plain toggle button + `AnimatePresence initial={false}` with
  `height: 0 → auto` and a real `exit`.

This plan extracts that fixed panel into the shared component and applies it to the
**five remaining** callers, then verifies no regression.

## The six callers of `SortableListItem`

| # | File | Panel content |
|---|------|---------------|
| 1 | `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` | `DirectionAwareTabs` (already fixed) |
| 2 | `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx` | `MaterialForm` |
| 3 | `apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx` | `DirectionAwareTabs` |
| 4 | `apps/erp/app/modules/production/ui/Jobs/JobBillOfMaterial.tsx` | `MaterialForm` |
| 5 | `apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx` | `DirectionAwareTabs` |
| 6 | `apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfMaterial.tsx` | `MaterialForm` |

## Progress
- [ ] Task 1: Add `SortableListItemToggle` + `SortableListItemPanel` to SortableList.tsx
- [ ] Task 2: Migrate items/BillOfProcess.tsx to the shared toggle + panel
- [ ] Task 3: Migrate items/BillOfMaterial.tsx
- [ ] Task 4: Migrate production/JobBillOfProcess.tsx
- [ ] Task 5: Migrate production/JobBillOfMaterial.tsx
- [ ] Task 6: Migrate sales/QuoteBillOfProcess.tsx
- [ ] Task 7: Migrate sales/QuoteBillOfMaterial.tsx
- [ ] Task 8: Regression sweep — grep for leftovers, lint, typecheck, unit tests
- [ ] Task 9: Browser verification of one BOP and one BOM screen

## Dependencies
- Tasks 2–7 all need Task 1 (they import the new components).
- **Tasks 2–7 are independent of each other** — one file each, no shared symbols.
  `/execute` may run them as parallel subagents.
- Task 8 needs Tasks 1–7.
- Task 9 needs Task 8.

---

## Task 1: Add `SortableListItemToggle` + `SortableListItemPanel` to SortableList.tsx

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/components/SortableList.tsx` — add two exported components
  and export them from the existing `export { ... }` statement at the bottom.
- Copy from (precedent): `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx`
  `renderExtra` (around L713–L748) — this is the already-fixed reference markup.

**Steps:**

1. Add these imports to the existing import block at the top of
   `apps/erp/app/components/SortableList.tsx` (the file already imports
   `{ Checkbox, cn, HStack }` from `@carbon/react`, `{ LayoutGroup, motion, Reorder, useDragControls }`
   from `framer-motion`, `{ LuTrash }` from `react-icons/lu`):
   - add `AnimatePresence` to the `framer-motion` import
   - add `LuSettings2, LuX` to the `react-icons/lu` import

2. Add these two components to the file, immediately **after** the
   `SortableListItem` function and **before** `export type SortableItemRenderProps`:

```tsx
export function SortableListItemToggle({
  isOpen,
  onToggle,
  className
}: {
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn("absolute right-3 top-3 z-10", className)}
    >
      {isOpen ? (
        <LuX className="h-5 w-5 text-foreground" />
      ) : (
        <LuSettings2 className="stroke-1 h-5 w-5 text-foreground/80 hover:stroke-primary/70" />
      )}
    </button>
  );
}

export function SortableListItemPanel({
  isOpen,
  children
}: {
  isOpen: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {isOpen ? (
        <motion.div
          key="panel"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="flex w-full flex-col overflow-hidden"
        >
          <div className="w-full p-2">{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
```

3. Add both names to the existing bottom export statement so it reads:
   `export { SortableList, SortableListItem, SortableListItemPanel, SortableListItemToggle };`

4. Do NOT change `SortableListItem` itself in this task — its geometry fix is
   already in the working tree.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/components/SortableList.tsx
# Expected: "Checked 1 file" with no errors and no diagnostics.
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: "Tasks:    1 successful, 1 total"
```

**Out of scope:** the `marginTop`/`flex flex-col` geometry fix (already applied);
`Reorder.Item`'s `layout` prop (leave at its default — full `layout` correctly
pins the top edge; switching it to `"position"` would translate by the box-center
delta and reintroduce a slide).

---

## Task 2: Migrate items/BillOfProcess.tsx to the shared toggle + panel

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx` — replace the
  inline button + `AnimatePresence` block inside `renderExtra` (around L711–L748)
  with the shared components.

**Steps:**

1. In the `renderExtra` prop of the `SortableListItem<Operation>` element, replace
   the entire returned JSX with:

```tsx
<div>
  <SortableListItemToggle
    isOpen={isOpen}
    onToggle={() => setSelectedItemId(isOpen ? null : item.id)}
  />
  <SortableListItemPanel isOpen={isOpen}>
    <DirectionAwareTabs
      className="mr-auto"
      tabs={tabs}
      onChange={() => setTabChangeRerender(tabChangeRerender + 1)}
    />
  </SortableListItemPanel>
</div>
```

2. Update the import of `SortableList`/`SortableListItem` in this file to also
   import `SortableListItemPanel` and `SortableListItemToggle` from
   `~/components/SortableList`.

3. Remove now-unused imports (`AnimatePresence`, and `motion`/`cn`/`LuX`/`LuSettings2`
   **only if** no other usage remains in the file — check with grep before removing;
   `motion` is still used elsewhere in this file around L1660).

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx
# Expected: no errors. `noUnusedImports` is set to "error" in biome.jsonc, so a
# leftover import fails this command.
```

**Out of scope:** `OperationForm`, the tabs array, everything outside `renderExtra`.

---

## Task 3: Migrate items/BillOfMaterial.tsx

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx` — replace the
  `renderExtra` body (currently L395–L502).
- Copy from (precedent): the Task 2 result in
  `apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx`'s sibling
  `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx`.

**Steps:**

1. Replace the whole `renderExtra={(item) => (...)}` body with:

```tsx
<div>
  <SortableListItemToggle
    isOpen={isOpen}
    onToggle={() => onSelectItem(isOpen ? null : item.id)}
  />
  <SortableListItemPanel isOpen={isOpen}>
    <MaterialForm ...{keep every existing prop exactly as-is}... />
  </SortableListItemPanel>
</div>
```

   Keep the `MaterialForm` element and **all** of its existing props byte-for-byte
   (`configurable`, `isReadOnly`, `item`, `methodOperations`, `orderState`,
   `temporaryItems`, `rulesByField`, `onConfigure`, `replenishmentSystem`,
   `parentItemId`, `setOrderState`, `setSelectedItemId`, `setTemporaryItems`,
   `onSubmit`). Only the three wrapper `motion.div`s around it are deleted.

2. This file's existing toggle calls `onSelectItem(null)` / `onSelectItem(item.id)`
   (NOT `setSelectedItemId`). Preserve that exact call — do not swap in
   `setSelectedItemId`. If the existing onClick contains any logic beyond those two
   calls, preserve it verbatim inside the `onToggle` callback.

3. Add `SortableListItemPanel, SortableListItemToggle` to the existing
   `~/components/SortableList` import.

4. Remove `LayoutGroup` and `AnimatePresence` from the `framer-motion` import.
   Keep `motion` only if still used elsewhere in the file (grep `motion\.` first).

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx
# Expected: no errors, no diagnostics.
grep -c 'key={`${isOpen}`}\|popLayout\|LayoutGroup' apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx
# Expected: 0
```

**Out of scope:** `MaterialForm` internals; the sourcing/backflush disclosures
lower in the file (they are `useDisclosure`-driven, unrelated to this animation).

---

## Task 4: Migrate production/JobBillOfProcess.tsx

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx` — replace
  the `renderExtra` body (currently L976–L1056).
- Copy from (precedent): `apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx`
  after Task 2.

**Steps:**

1. Same shape as Task 2 — `<div>` + `SortableListItemToggle` +
   `SortableListItemPanel` wrapping the existing `DirectionAwareTabs` element with
   all its current props unchanged.
2. Preserve this file's existing toggle onClick logic verbatim inside `onToggle`
   (read L978–L1017 first; it may do more than set the selected id).
3. Add `SortableListItemPanel, SortableListItemToggle` to the existing
   `~/components/SortableList` import (L124).
4. Remove `LayoutGroup` / `AnimatePresence` from the `framer-motion` import (L58–59)
   if unused after the edit.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx
# Expected: no errors, no diagnostics.
```

**Out of scope:** the operation forms, `disclosure.isOpen` blocks at L1237/L1534/L2021,
and the setup/labor/machine disclosures — all unrelated.

---

## Task 5: Migrate production/JobBillOfMaterial.tsx

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/production/ui/Jobs/JobBillOfMaterial.tsx` — replace
  the `renderExtra` body (currently L484–L602).

**Steps:**

1. Same shape as Task 3.
2. **This file's toggle onClick has real logic** (L488–L511): when `isOpen` and
   `temporaryItems[item.id]` exists it deletes the temporary item and re-orders
   `orderState`, then calls `onSelectItem(null)`. Move that whole body into
   `onToggle` unchanged:

```tsx
onToggle={() => {
  if (isOpen) {
    if (temporaryItems[item.id]) {
      setTemporaryItems((prev) => {
        const { [item.id]: _, ...rest } = prev;
        return rest;
      });
      setOrderState((prev) => {
        const order = prev[item.id];
        const { [item.id]: _, ...rest } = prev;
        return { ...rest, [item.id]: order };
      });
    }
    onSelectItem(null);
  } else {
    onSelectItem(item.id);
  }
}}
```

   If the code at L488–L511 differs from the above, the file wins — copy what is
   actually there. Do not simplify or "clean up" this logic.
3. This file's `LuSettings2` icon carries an extra `mt-3.5` class. Preserve that
   offset by passing `className="mt-3.5"` to `SortableListItemToggle` (the button
   is absolutely positioned, so a top margin on the button offsets it identically).
4. Add the two new imports; remove `LayoutGroup`/`AnimatePresence` if unused.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/production/ui/Jobs/JobBillOfMaterial.tsx
# Expected: no errors, no diagnostics.
```

**Out of scope:** `MaterialForm`, the source/backflush disclosures.

---

## Task 6: Migrate sales/QuoteBillOfProcess.tsx

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx` — replace
  the `renderExtra` body (currently L769–L848).

**Steps:**

1. Same shape as Task 4 (`DirectionAwareTabs` panel content).
2. Preserve this file's existing toggle onClick verbatim inside `onToggle` — read
   L771–L810 first.
3. Add `SortableListItemPanel, SortableListItemToggle` to the `~/components/SortableList`
   import (L95); remove `LayoutGroup`/`AnimatePresence` from `framer-motion` (L42–43)
   if unused after the edit.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx
# Expected: no errors, no diagnostics.
```

**Out of scope:** quote pricing/line logic elsewhere in the file.

---

## Task 7: Migrate sales/QuoteBillOfMaterial.tsx

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfMaterial.tsx` — replace
  the `renderExtra` body (currently L488–L590).

**Steps:**

1. Same shape as Task 3 (`MaterialForm` panel content, all props preserved).
2. Preserve this file's existing toggle onClick verbatim inside `onToggle` — read
   L490–L529 first.
3. Add the two new imports (existing SortableList import is at L67); remove
   `LayoutGroup`/`AnimatePresence` from the `framer-motion` import (L32) if unused.

**Verify:**
```bash
pnpm exec biome check apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfMaterial.tsx
# Expected: no errors, no diagnostics.
```

**Out of scope:** quote line pricing.

---

## Task 8: Regression sweep — grep for leftovers, lint, typecheck, unit tests

**Depends on:** Tasks 1–7
**Files:** none created; fix anything the commands below surface.

**Steps:**

1. Confirm no caller still carries a defect pattern:

```bash
grep -rn 'key={`${isOpen}`}\|mode="popLayout"\|LayoutGroup' \
  apps/erp/app/modules/items/ui/Item/BillOfProcess.tsx \
  apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx \
  apps/erp/app/modules/production/ui/Jobs/JobBillOfProcess.tsx \
  apps/erp/app/modules/production/ui/Jobs/JobBillOfMaterial.tsx \
  apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfProcess.tsx \
  apps/erp/app/modules/sales/ui/Quotes/QuoteBillOfMaterial.tsx
# Expected: no output (exit code 1).
```

2. Confirm `SortableListItem` has exactly one consumer set and nothing else in the
   repo depends on the removed `marginTop`/`gap-2` geometry:

```bash
grep -rn "SortableListItem\|from \"~/components/SortableList\"" apps packages --include=*.tsx | grep -v "components/SortableList.tsx"
# Expected: only the six BOM/BOP files listed in this plan.
```

3. Run lint + typecheck + the ERP unit tests:

```bash
pnpm exec biome check apps/erp/app/components/SortableList.tsx apps/erp/app/components/DirectionAwareTabs.tsx apps/erp/app/modules/items/ui/Item apps/erp/app/modules/production/ui/Jobs apps/erp/app/modules/sales/ui/Quotes
# Expected: "Checked N files" with no errors.
pnpm exec turbo run typecheck --filter=erp 2>&1 | tail -5
# Expected: "Tasks:    1 successful, 1 total"
```

4. ERP tests (per `.ai/lessons.md`: the erp app package is named `erp`, and its
   tests run through vitest directly):

```bash
cd apps/erp && npx vitest run 2>&1 | tail -20
# Expected: no NEW failures vs. the pre-change baseline. If any test fails, first
# run `git stash && npx vitest run` to capture the baseline, then compare.
# If a failure is caused by these changes, STOP and report — do not "fix" a test
# to make it pass.
```

**Verify:** all four commands above produce their stated expected output.

**Out of scope:** unrelated pre-existing test failures; the modified files listed
in `git status` at session start (`items.server.ts`, `tool-metadata.json`,
`packages/database/**`) — those are someone else's in-flight work, leave them.

---

## Task 9: Browser verification of one BOP and one BOM screen

**Depends on:** Task 8
**Files:** none.

**Steps:**

1. Use the `/auth` skill to get an authenticated session, then the `/test` skill to
   drive the browser.
2. Navigate to a Part detail page with a make method
   (`/x/part/{itemId}/manufacturing`) and exercise the **Bill of Process** card:
   - click a card's settings icon → the card's **top border must not move**; the
     panel grows downward smoothly over ~250ms.
   - click the X → the panel collapses smoothly; no instant snap.
   - with card A open, click card B → A collapses while B expands, no jump.
   - drag a collapsed card to reorder → reorder still works.
3. Repeat on the same page's **Bill of Material** card.
4. Repeat step 2 on a Job (`/x/job/{jobId}/method`) to confirm the production
   variant.

**Verify:** each of the four interactions above behaves as described. Capture a
screenshot of an expanded card on both the BOP and BOM screens.

**If the dev stack is not running or auth cannot be obtained, STOP and report that
browser verification was skipped — do not claim the UI was verified.**

**Out of scope:** any data mutation (do not save forms; this is a visual check).
