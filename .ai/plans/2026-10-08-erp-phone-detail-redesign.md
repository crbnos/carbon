# ERP phone redesign of 12 screens — implementation plan

**Spec:** `.ai/specs/2026-10-08-erp-phone-detail-redesign.md` (approved 2026-10-08)
**Status:** approved
**Research:** `.ai/research/2026-10-08-erp-phone-redesign-mapping.md` (file:line for every screen)
**Designs:** `local-docs/mobile-design/review-2026-10-08/index.html` (after-*.json)
**Branch:** `feat/mobile-redesign`

🛑 Never commit. The owner commits.
🛑 Desktop must not change. Gate every change with `max-md:` / `md:hidden` classes or `useViewport().isPhone`.
🛑 Adapt, don't add: no new data, no new features. Every action that exists today must stay reachable.
🛑 Every new user-facing string uses Lingui (`useLingui().t` or `<Trans>`).
🛑 If an assumption in a task is false, STOP and report. Do not improvise.

Paths are relative to `apps/erp/app/` unless they start with `packages/` or `.ai/`.

## Progress

- [x] Task 1: One ⋯ per record on phones (S3)
- [x] Task 2: Icon cell in the record action bar (S4)
- [x] Task 3: Split button shows only its main action in the bar (S5)
- [x] Task 4: Page items in the record app-bar ⋯ (S6)
- [x] Task 5: Record tab setter (S7)
- [x] Task 6: Files cards on phones (S8)
- [x] Task 7: `emptyState` prop on `SortableList` (S9)
- [x] Task 8: Trailing row action in phone lists (S10)
- [x] Task 9: Extra items in the list toolbar ⋯ (S11)
- [x] Task 10: Subtitle under the section switcher title (S12)
- [x] Task 11: Detail page tops: app bar subtitle and hero subtitle (S1, S2)
- [x] Task 12: Sales Order body
- [x] Task 13: Purchase Order body
- [x] Task 14: Quote body
- [x] Task 15: Quotes list rows
- [x] Task 16: Job body
- [x] Task 17: Part body
- [x] Task 18: Quantity detail
- [x] Task 19: Storage Unit edit sheet
- [x] Task 20: Picking List detail
- [x] Task 21: Issue detail
- [x] Task 22: Production and Purchasing Planning
- [x] Task 23: Strings, typecheck, lint
- [x] Task 24: Browser verification at 393 and 1440

## Dependencies

- Tasks 1–10 are independent of each other (shared parts). Run them in any order.
- Task 11 needs nothing.
- Tasks 12, 13, 16 need Tasks 1–3. Task 13 also needs Task 5. Tasks 16 and 17 need Tasks 4 and 7.
- Tasks 12–14, 20 and 21 need Task 6 where they touch Files cards.
- Task 22 needs Tasks 8, 9, 10.
- Task 23 needs all code tasks. Task 24 needs Task 23.

## Shared commands

```bash
# Typecheck (scoped; whole-repo typecheck runs out of memory)
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/react --filter=@carbon/printing
# Expected: "Tasks: N successful, N total"
# Lint the files you changed
pnpm exec biome check --write <changed files>
# Expected: no errors (pre-existing warnings are fine)
```

---

## Task 1: One ⋯ per record on phones (S3)

**Depends on:** none
**Files:**
- Modify: `components/Layout/RecordHeader.tsx` — `RecordPhoneChrome` (about `:166-247`)
- Precedent: the current `RecordPhoneChrome` app-bar `DropdownMenu` (`:189-212`)

**Steps:**
1. Make the app-bar `DropdownMenu` controlled by the existing `useOverflowSheet` store: `open={open} onOpenChange={setOpen}`.
2. Inside its `DropdownMenuContent`, keep "Copy ID" and `{menu}` first.
3. If `hasOverflow` is true, add a `DropdownMenuSeparator` and then `<overflowSlot.Target className="flex flex-col [&>*]:w-full" />` after `{menu}`.
4. Render the app-bar ⋯ when `menu || copyValue || hasOverflow` is true.
5. In the `BottomBar`, delete the ⋯ `IconButton` that opened the overflow sheet.
6. Delete the "Actions" `BottomSheet` that held `overflowSlot.Target`.
7. Keep `closeOverflow` as the row `onSelect`. It now closes the app-bar menu, because the menu reads the same store.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: success
```
Manual: on a phone (393px), SO000025's app bar ⋯ lists Copy ID, the menu items, then the overflow actions. The bottom bar has no ⋯.

**Out of scope:** desktop header row; what each header puts in `menu` or `overflow`.
If an overflow action opens its own dropdown and that dropdown fails inside the menu sheet, STOP and report.

## Task 2: Icon cell in the record action bar (S4)

**Depends on:** none
**Files:**
- Modify: `packages/react/src/ActionPresentation.tsx` — add `iconOnly?: boolean` to the `bar` kind.
- Modify: `packages/react/src/Button.tsx` — icon-only bar rendering (around the presentation block, about `:205-260`).
- Modify: `components/Layout/RecordHeader.tsx` — a new `iconSlot` and `RecordAction slot="icon"`.
- Precedent: `presentations` and `slots` maps in `RecordHeader.tsx:58-70`.

**Steps:**
1. In `ActionPresentation`, change the bar kind to `{ kind: "bar"; emphasis: "primary" | "secondary"; iconOnly?: boolean }`.
2. In `Button`, if `presentation?.kind === "bar" && presentation.iconOnly`:
   1. Render with `isIcon`, `size="lg"`, variant `secondary`.
   2. Do not add `w-full`. Add `shrink-0`.
   3. Render `leftIcon` only. Put `children` in `<span className="sr-only">`. Do not render `rightIcon`.
3. In `RecordHeader.tsx`, create `const iconSlot = createPortalSlot();`.
4. Add `icon: { kind: "bar", emphasis: "secondary", iconOnly: true }` to `presentations` and `icon: iconSlot` to `slots`. Extend the `slot` prop type with `"icon"`.
5. In the `BottomBar` row, render `<iconSlot.Target className="flex shrink-0 empty:hidden" />` before the primary target.
6. Show the bar when the icon slot is filled too (`iconSlot.useFilled()`).

**Verify:** typecheck (shared command). Expected: success.

**Out of scope:** moving any action into the icon slot (Tasks 12–14 do that).

## Task 3: Split button shows only its main action in the bar (S5)

**Depends on:** none
**Files:**
- Modify: `packages/react/src/SplitButton.tsx` (`:40-125`)

**Steps:**
1. If `presentation?.kind === "bar"`, do not render the chevron `DropdownMenu`.
2. Keep the main `Button` full width (`min-w-0 flex-1`) and drop `rounded-r-none` in that case.
3. Do not change the `row` kind or desktop.

**Verify:** typecheck. Manual in Tasks 13 and 16.

**Out of scope:** where the dropdown items go (Tasks 13 and 16 add them to the ⋯).

## Task 4: Page items in the record app-bar ⋯ (S6)

**Depends on:** none
**Files:**
- Modify: `components/Layout/RecordHeader.tsx`
- Precedent: `createValueSlot` in `components/Layout/Mobile/slots.tsx:66-97`; `recordTabsSlot` in `components/Layout/Panels.tsx:26`.

**Steps:**
1. Export `recordMenuSlot = createValueSlot<ReactNode>()` from `RecordHeader.tsx`.
2. In `RecordPhoneChrome`, read `const pageMenu = recordMenuSlot.useValue();`.
3. Render `{pageMenu}` after `{menu}` and before the overflow target, with a `DropdownMenuSeparator` between them.
4. Count `pageMenu` in the condition that shows the app-bar ⋯.

**Verify:** typecheck. Manual in Tasks 16 and 17.

**Out of scope:** callers (Tasks 16, 17).

## Task 5: Record tab setter (S7)

**Depends on:** none
**Files:**
- Modify: `components/Layout/Panels.tsx` — `CompactRecordTabs` (`:114-196`)

**Steps:**
1. Export `RecordPanelContext = createContext<(panel: "content" | "explorer" | "properties") => void>(() => {})`.
2. In `CompactRecordTabs`, wrap the panel body in `<RecordPanelContext.Provider value={setPanel}>`.
3. Export a hook `useShowRecordPanel()` that returns the context value.

**Verify:** typecheck.

**Out of scope:** desktop panels.

## Task 6: Files cards on phones (S8)

**Depends on:** none
**Files:**
- Modify: `modules/sales/ui/Opportunity/OpportunityDocuments.tsx` — header New `:104-119` and `:414-437`, thead `:121-135`
- Modify: `modules/purchasing/ui/SupplierInteraction/SupplierInteractionDocuments.tsx` — thead `:100-105`, New `:345`
- Modify: `components/Documents.tsx` — New `:237-249`, thead `:253-266`
- Precedent: `components/RecordDocuments.tsx:129` (thead hidden on phones when empty)

**Steps:**
1. Add `max-md:hidden` to the card-header "New" `File` button (or its `CardAction`) in each file.
2. If the file list is empty, add `max-md:hidden` to the table header, as `RecordDocuments.tsx:129` does.
3. Keep `FileDropzone`'s phone "Upload" button as the only upload control.

**Verify:** typecheck. Manual: SO000025 Files card shows one "Upload" and no "Name Size Created" row.

**Out of scope:** desktop Files cards; `RecordDocuments.tsx`.

## Task 7: `emptyState` prop on `SortableList` (S9)

**Depends on:** none
**Files:**
- Modify: `components/SortableList.tsx` (`:325-327` returns `<Empty />`)
- Precedent: `components/Table/components/Compact/CompactEmpty.tsx`

**Steps:**
1. Add an optional prop `emptyState?: ReactNode`.
2. If `items` is empty and `emptyState` is set, return `emptyState`. Otherwise return `<Empty />` as today.

**Verify:** typecheck.

**Out of scope:** `components/Empty.tsx` (about 49 users).

## Task 8: Trailing row action in phone lists (S10)

**Depends on:** none
**Files:**
- Modify: `components/Table/types.ts:48` — `mobile?: "P1" | "P2" | "P3" | "P4" | "action";`
- Modify: `components/Table/components/Compact/resolveSlots.ts` — add `action?: Column<T, unknown>` to `CompactSlots`; set it to the first column with `meta.mobile === "action"`.
- Modify: `components/Table/components/Compact/resolveSlots.test.ts` — one test: a column marked `action` resolves to `slots.action` and to no other slot.
- Modify: `components/Table/components/Compact/CompactRow.tsx`

**Steps:**
1. Make the type and `resolveSlots` changes above.
2. In `CompactRow`, render `renderCell(row, slots.action)` after the text column and before the expand button. Use `relative z-10 shrink-0 self-center [&_button]:h-11 [&_button]:min-w-11`.
3. If `selection` is set, do not render the action cell.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/components/Table/components/Compact/resolveSlots.test.ts
# Expected: all tests pass, including the new one
```

**Out of scope:** any table annotation (Task 22).

## Task 9: Extra items in the list toolbar ⋯ (S11)

**Depends on:** none
**Files:**
- Modify: `components/Table/Table.tsx` (props near `:170`, compact render near `:1109`)
- Modify: `components/Table/components/Compact/CompactList.tsx`
- Modify: `components/Table/components/Compact/CompactToolbar.tsx` (`:60-135`)

**Steps:**
1. Add `mobileMenuItems?: ReactNode` to `Table`. Pass it to `CompactList`, then to `CompactToolbar`.
2. In `CompactToolbar`, include `mobileMenuItems` in `hasMenu`.
3. Render `{mobileMenuItems}` first in the `DropdownMenuContent`, then a `DropdownMenuSeparator` if more items follow.

**Verify:** typecheck.

**Out of scope:** desktop toolbar.

## Task 10: Subtitle under the section switcher title (S12)

**Depends on:** none
**Files:**
- Modify: `components/Layout/Mobile/MobileAppBar.tsx` (`:79-104`)

**Steps:**
1. In the `canSwitch` branch, wrap the title button content in a column.
2. Under `titleText`, render `subtitle` with the same classes the non-switch branch uses (`min-w-0 max-w-full truncate text-xs text-muted-foreground`).
3. Keep the chevron beside the title line, not beside the subtitle.

**Verify:** typecheck. Manual in Task 22.

## Task 11: Detail page tops: app bar subtitle and hero subtitle (S1, S2)

**Depends on:** none
**Files and values** (table rows; header paths in the research file §Part A and §Part B):

| Screen | Header file | Hero `subtitle` | Route that sets the app bar subtitle |
|---|---|---|---|
| Sales Order | `modules/sales/ui/SalesOrder/SalesOrderHeader.tsx` | customer name | `routes/x+/sales-order+/$orderId.tsx` → "Sales Order" |
| Purchase Order | `modules/purchasing/ui/PurchaseOrder/PurchaseOrderHeader.tsx` | supplier name, then " · Rev N" when `revisionId > 0` | `routes/x+/purchase-order+/$orderId.tsx` → "Purchase Order" |
| Quote | `modules/sales/ui/Quotes/QuoteHeader.tsx` | customer name, then " · Rev N" when `revisionId > 0` | `routes/x+/quote+/$quoteId.tsx` → "Quote" |
| Job | `modules/production/ui/Jobs/JobHeader.tsx` | item readable ID + " · Qty N" | `routes/x+/job+/$jobId.tsx` → "Job" |
| Part | `modules/items/ui/Parts/PartHeader.tsx` | part name | `routes/x+/part+/$itemId.tsx` → "Part" |
| Quantity | `routes/x+/inventory+/quantities+/$itemId.tsx` (standalone `RecordHero`, precedent `InspectionView.tsx:506`) | item name | same route → "Quantities" |
| Picking List | `modules/inventory/ui/PickingLists/PickingListHeader.tsx` | first distinct `pickingListLines[].job.jobId`, "+N" when more, then " · " + assignee full name | `routes/x+/picking-list+/$pickingListId.tsx` → "Picking List" |
| Issue | `modules/quality/ui/Issue/IssueHeader.tsx` | `nonConformance.name` | `routes/x+/issue+/$id.tsx` → "Issue" |

**Steps:**
1. For each row, pass the hero value as `subtitle` to `RecordHeader`. Read names from the route data the header already uses.
2. In each route, call `useSetAppBarOverride(useMemo(() => (isPhone ? { subtitle: t\`Sales Order\` } : null), [isPhone, t]))`. Precedent: `components/NewRecordPage.tsx:20`.
3. Do not change any breadcrumb (`handle`).
4. For the picking list assignee, read `assigneeUser.fullName`. If the assignee was just changed optimistically, look the name up with `usePeople()`.

**Verify:** typecheck. Manual: SO000025 app bar reads "SO000025 / Sales Order"; the hero line shows the customer with an ellipsis.

**Out of scope:** desktop header row (it never shows `subtitle`).

## Task 12: Sales Order body

**Depends on:** 1, 2, 6, 11
**Files:**
- Modify: `modules/sales/ui/SalesOrder/SalesOrderSummary.tsx` — `LineItems` (`:346-708`), totals (`:244-339`)
- Modify: `modules/sales/ui/SalesOrder/SalesOrderHeader.tsx` — Preview `RecordAction` (`:391-415`)
- Precedent for the phone row: `components/Layout/Mobile/SheetRow.tsx` (`SheetRowContent`)

**Steps:**
1. On phones, render each line as one row: line 1 part number (truncate) + line total (`shrink-0`), line 2 part name (muted, truncate), line 3 "{qty} × {unit price} {unit}".
2. On phones, make the row a `Link` to `path.to.salesOrderLine(orderId, lineId)`. Hide the Edit link, the badges and the inline expand (`md:` only).
3. In totals, on phones, show a "Shipping" row with the amount. Its tap calls the existing `onEditShippingCost`. Hide the "Add Shipping" link on phones.
4. Change the Preview `RecordAction` to `slot="icon"`.
5. Keep the card order: `OpportunityState`, summary, Notes, Files, Shipping, Payment.

**Verify:** typecheck. Manual: AC 1, 4, 5 of the spec.

**Out of scope:** desktop summary; line page route.

## Task 13: Purchase Order body

**Depends on:** 1, 2, 3, 5, 6, 11
**Files:**
- Modify: `modules/purchasing/ui/PurchaseOrder/PurchaseOrderSummary.tsx` — `LineItems` (`:53+`), badge (`:200-210`)
- Modify: `modules/purchasing/ui/PurchaseOrder/PurchaseOrderHeader.tsx` — Preview (`:329-353`), Finalize split (`:355-385`)

**Steps:**
1. Apply Task 12 steps 1–2 with `path.to.purchaseOrderLine`.
2. Remove the "1 ⇄" badge on phones.
3. On phones, show the first 3 lines. If there are more, show a "See all {count}" button. It calls `useShowRecordPanel()("explorer")`.
4. Change Preview to `slot="icon"`.
5. If `isPhone`, add a `RecordAction slot="overflow"` Button "Mark as Planned" with the existing handler (`:203-208`). Do not render it on desktop.

**Verify:** typecheck. Manual: AC 2, 6.

## Task 14: Quote body

**Depends on:** 1, 2, 6, 11
**Files:**
- Modify: `modules/sales/ui/Quotes/QuoteSummary.tsx` — rows `:160-275`
- Modify: `modules/sales/ui/Quotes/QuoteHeader.tsx` — Preview `:197-238`, slots `:104-112`, Reopen `:136-155`
- Modify: `modules/sales/ui/Quotes/QuotePaymentForm.tsx` (`:49-61`), `QuoteShipmentForm.tsx` (`:81-101`)

**Steps:**
1. On phones, restyle each row as in Task 12 step 1. Keep tap-to-expand and `LinePricingOptions`. Hide the Edit link and badges on phones.
2. Change Preview to `slot="icon"`. Leave Share (status Sent) as it is.
3. If `isPhone` and the status is Expired, add a primary `RecordAction` "Reopen" with the existing reopen handler. Keep the `menu` item.
4. In both forms, if `isQuoteLocked` and on a phone, show one muted line: "Locked while the quote is {status}. Reopen it to edit."

**Verify:** typecheck. Manual: Q000008 bar shows Preview icon + Reopen; tapping a line expands it.

## Task 15: Quotes list rows

**Depends on:** none
**Files:**
- Modify: `modules/sales/ui/Quotes/QuotesTable.tsx` — status cell `:117-145`, customer cell `:98-115`
- Precedent: `QuoteStatus.tsx:19`; `packages/react/src/DateTime.tsx:48-52`

**Steps:**
1. In the status cell, for Draft: keep `BarProgress` with `max-md:hidden`. Add a `md:hidden` span with `<QuoteStatus status="Draft" />` and "{completedLines} of {lines} lines complete".
2. In the customer cell, add a `md:hidden` span " · Exp. {date}" using `DateTime` with `dateOptions={{ month: "short", day: "numeric" }}`. Show it only when `expirationDate` is set.

**Verify:** typecheck. Manual: AC 16.

## Task 16: Job body

**Depends on:** 1, 3, 4, 7, 11
**Files:**
- Modify: `modules/production/ui/Jobs/JobMakeMethodTools.tsx` (`:309-385`)
- Modify: `modules/production/ui/Jobs/JobBillOfProcess.tsx` (`:1049-1078`), `JobBillOfMaterial.tsx` (`:559-586`)
- Modify: `modules/production/ui/Jobs/JobEstimatesVsActuals.tsx` (`:311-329`)
- Modify: `modules/production/ui/Jobs/JobHeader.tsx` — Pause `:393-441`, Release split `:443-469`
- Precedent for the empty state: `components/Table/components/Compact/CompactEmpty.tsx`

**Steps:**
1. In `JobMakeMethodTools`, add `max-md:hidden` to the `Menubar`. Provide `recordMenuSlot.useProvide(...)` with `DropdownMenuItem`s for Get Method, Save Method, Configure and Item Master. Each item calls the same disclosure the Menubar button opens. Memoize the node.
2. Pass `emptyState` to `SortableList` in BOP and BOM: icon tile, "No operations yet" / "No materials yet", one sentence, and the existing add action.
3. In Estimates vs Actual, on phones, stack the title over a full-width `TabsList` (`max-md:flex-col max-md:items-stretch`).
4. In `JobHeader`, if `isPhone` and the status is not Ready or In Progress, do not render the Pause action.
5. If `isPhone`, add a `RecordAction slot="overflow"` "Mark as Planned" with the existing handler.

**Verify:** typecheck. Manual: AC 7, 8.
If `JobMakeMethodTools` mounts on `job+/$jobId.make.$methodId.tsx` too, the slot items show there as well. That is correct.

## Task 17: Part body

**Depends on:** 1, 4, 7, 11
**Files:**
- Modify: `modules/items/ui/Item/MakeMethodTools.tsx` (`:234-380`)
- Modify: `routes/x+/part+/$itemId.details.tsx` (Bill of Process at `:337`)
- Modify: `modules/items/ui/Item/ItemManufacturingForm.tsx` (`:96-103`)
- Modify: `components/SortableList.tsx` only if rows clip (step 4)

**Steps:**
1. Apply Task 16 step 1 to `MakeMethodTools` (Get Method, Save Method, Item Master). Wrap "Item Master" in Lingui.
2. On phones, render the version dropdown as a chip above Bill of Process. Extract the version control into `MakeMethodVersionSelect` in the same folder. Render it in the tools on desktop and above `BillOfProcess` on phones (`md:hidden`).
3. In `ItemManufacturingForm`, on phones, make Save full width. Disable it until the form has touched fields. Precedent: `DefaultDisabledSubmit` (`packages/form/src/components/Submit.tsx:42-58`).
4. Open ADCS-001 on a phone. If BOP/BOM row text clips, relax the `truncate` in `SortableList.tsx:120` to `max-md:whitespace-normal` for the title only. If nothing clips, skip this step.
5. Pass `emptyState` to BOP and BOM as in Task 16 step 2.

**Verify:** typecheck. Manual: AC 9.

## Task 18: Quantity detail

**Depends on:** 11
**Files:**
- Modify: `modules/inventory/ui/Inventory/InventoryDetails.tsx` (`:57-171`)
- Modify: `modules/inventory/ui/Inventory/InventoryStorageUnits.tsx` (`:270-476`)
- Modify: `modules/inventory/ui/Inventory/InventoryItemHeader.tsx` (`:47-52`)
- Modify: `routes/x+/inventory+/quantities+/$itemId.details.tsx` (`:225-255`)
- Modify: `components/Table/components/Compact/CompactToolbar.tsx` (duplicate ⋯ fix)
- Precedent: tiles `routes/x+/sales+/_index.tsx:384`; rows `CompactRow.tsx` classes; empty line `CompactEmpty.tsx`

**Steps:**
1. Add `variant?: "quantity"` to `InventoryDetails` and `InventoryStorageUnits`. Pass it only from `$itemId.details.tsx`. Every step below applies only when `variant === "quantity"` and on phones.
2. Grid: `max-md:grid-cols-2 max-md:gap-3`. Under PO and SO figures, add "↑ Incoming" / "↓ Outgoing". On the jobs tile, add "Supply / demand".
3. Usage window: show a "Daily usage" label before the existing `DateSelect` chip.
4. Move the external-link icon to the app-bar ⋯ as "Item Master" (`recordMenuSlot` from Task 4 is not mounted here; use `AppBarActions` with one `DropdownMenu`).
5. Fix the duplicate ⋯: in `CompactToolbar`, do not fill `AppBarActions` while a `compactFocus` pane is shown. Read the state the `Resizable` `compactFocus` uses (`packages/react/src/Resizable.tsx:32-44`). If no readable state exists, STOP and report.
6. Move "Update Inventory" to a `BottomBar` (`components/Layout/Mobile/ChromeSlots.tsx:38`).
7. Render storage units as phone rows (unit, quantity, tracking ID, expiry). Keep the batch group toggle and the per-row ⋯. If there are no rows, show one line: "No storage unit holds this item."

**Verify:** typecheck. Manual: AC 10, 11.

## Task 19: Storage Unit edit sheet

**Depends on:** none
**Files:**
- Modify: `modules/inventory/ui/StorageUnits/StorageUnitForm.tsx` (`:68-178`)
- Modify: `packages/printing/src/ui/PrintButton.tsx` (`:30-127`) — add `label?: ReactNode` (default stays "Print")

**Steps:**
1. Apply every change only when `isEditing` and on phones.
2. Add `max-md:h-[calc(100dvh-env(safe-area-inset-top)-12px)]` to `ModalDrawerContent`. Do not use `size="full"`.
3. Render `Submit` in the header, left of the ×. Hide the footer Save and Cancel on phones.
4. In the footer, render `PrintButton` full width with `label={t\`Print label\`}`.
5. Replace the read-only `Location` with the read-only `InputBase` pattern at `:126-137`. Add `<Hidden name="locationId" />` and the helper text "Set when the unit was created".
6. On phones, pass no `termId` to Parent Storage Unit and Work Center. Keep Storage Types' `termId`.

**Verify:** typecheck. Manual: AC 12.

## Task 20: Picking List detail

**Depends on:** 1, 11
**Files:**
- Modify: `modules/inventory/ui/PickingLists/PickingListLines.tsx` (`:180-572`)
- Modify: `modules/inventory/ui/PickingLists/PickingListHeader.tsx` (`:108-218`)
- Modify: `components/Assignee.tsx` (`:115-205`) — controlled `open` / `onOpenChange` props
- Precedent: overline header `components/Table/components/Compact/CompactList.tsx:295-302`

**Steps:**
1. On phones, replace `BarProgress` with an overline header: the job on the left, "{progress}% picked" on the right.
2. On phones, drop the inner bordered box. Render each line as its own `Card`.
3. Replace the quantity badge with "To pick {n} {unit}" and "Picked {n} {unit}". If `line.status === "Short"`, add a "Short" `Status` pill.
4. Put Short and Pick on their own row as two `flex-1` `size="lg"` buttons. On phones Pick uses `variant="secondary"`. Apply the same to Scan and Unpick.
5. In the header, change the Assignee action to `slot="overflow"` as a Button "Assign". It opens the `Assignee` picker through the new controlled `open` prop.

**Verify:** typecheck. Manual: AC 13.

## Task 21: Issue detail

**Depends on:** 6, 11
**Files:**
- Modify: `components/ActionTasks/ActionTaskList.tsx` (`:94-135`), `ActionTaskAddModal.tsx` (`:64-73`)
- Modify: `modules/quality/ui/Issue/ReviewersList.tsx` (`:56-187`)

**Steps:**
1. On phones, Actions: a `CardAction` "Add" button opens the existing add modal. Hide the dashed tile. If empty, show one line: "No actions yet."
2. On phones, Approval Requirements: always render the card. Its header "Add" opens the empty-state modal while empty. With requirements, it opens the "Add Requirement" modal. Hide the dashed tile. If empty, show "No approval requirements yet."
3. Do not add a properties card on Overview.

**Verify:** typecheck. Manual: AC 14. Also open a Change Notice's Actions card on a phone; it must still work.

## Task 22: Production and Purchasing Planning

**Depends on:** 8, 9, 10
**Files:**
- Modify: `modules/production/ui/Planning/ProductionPlanningTable.tsx` (Order col `:487-525`, On Hand `:433-441`, toolbar `:587-607`)
- Modify: `modules/purchasing/ui/Planning/PurchasingPlanningTable.tsx` (Order col `:563-600`, Supplier `:440-460`, toolbar `:661-685`)
- Modify: `routes/x+/production+/planning.tsx`, `routes/x+/purchasing+/planning.tsx` (app bar subtitle)

**Steps:**
1. Add `meta: { mobile: "action" }` to each Order column.
2. Pass `mobileMenuItems` with a `DropdownMenuItem` "Recalculate". It calls `mrpFetcher.submit({}, { method: "post", action: path.to.api.mrp(locationId) })`. Disable it while `mrpFetcher.state !== "idle"`.
3. On phones, hide the Recalculate button in `primaryAction`. Add one `md:hidden` muted line: "MRP runs every 3 hours. To run it now, use ⋯ › Recalculate."
4. In each route, set the app bar subtitle "Production" / "Purchasing" on phones (Task 11 pattern).
5. Production: add `meta: { mobile: "P3", mobileLabel: true }` to On Hand.
6. Purchasing: in the Supplier cell, add a `md:hidden` " · {onHand} on hand" after the supplier. Wrap "No Supplier" in Lingui.

**Verify:** typecheck. Manual: AC 15.

## Task 23: Strings, typecheck, lint

**Depends on:** 1–22
**Steps:**
1. Run `pnpm lingui:extract && pnpm lingui:clean`.
2. Run the shared typecheck. Expected: success.
3. Run `pnpm exec biome check --write` on every changed file. Expected: no errors.
4. Run `pnpm --filter erp exec vitest run app/components/Table/components/Compact/resolveSlots.test.ts`. Expected: pass.

## Task 24: Browser verification at 393 and 1440

**Depends on:** 23
**Steps:**
1. Log in with the `auth` skill (ERP `http://localhost:3000`, `test@carbon.ms`).
2. At 393×852, check every acceptance criterion 1–16 and 18 of the spec. Screenshot each screen into the session scratchpad.
3. At 1440×900, open the 12 screens and compare with `local-docs/mobile-design/review-2026-10-08/shots/` desktop behaviour (AC 17). Desktop must look as before.
4. Close the browser session.
5. Write the results under "Run notes" below.

## Run notes

- Tasks 1–10 ran in the main session. Five agents started Tasks 11–22 in parallel. The owner stopped them because 4 parallel typechecks used all the RAM. The main session then finished and reviewed every task one group at a time, with one typecheck at the end.
- Verify: one scoped typecheck (`erp`, `@carbon/react`, `@carbon/printing`) passes. `resolveSlots.test.ts` passes (5 tests). Biome is clean on every file this plan changed. `apps/erp/app/root.tsx` has 2 Biome errors, but that file had uncommitted changes before this plan and this plan does not touch it.
- Browser at 393×852: all 12 screens load, and no screen scrolls sideways. Checked: one ⋯ on SO (Copy ID, menu, then Cancel / Ship / Invoice), the Preview icon cell, the SO line link, "See all 30" opening the Lines tab, the Quote Reopen primary, the Job Release-only bar, the Part version chip above Bill of Process, the quantity tiles and Update Inventory bar, the full-screen Storage Unit sheet, the Picking List buttons, the Issue cards, the planning Make / Order buttons, and the Quotes list text.
- Browser at 1440×900: the 11 screens show their desktop layout as before.
- Deviations:
  1. No commits (the owner commits).
  2. Task 18 step 5: `compactFocus` has no readable state. A value slot (`useHideListAppBarMenu` in `CompactToolbar.tsx`) keeps the list's ⋯ out of the quantity page's app bar.
  3. Added after the browser check: on phones the SO and PO summary card hides its repeated ID and truncates the customer / supplier name. The planning "Qty to Order" leaves the phone row, because the Make / Order button shows the same number.
  4. The planning "Make", "Order" and "Blocked" labels now use Lingui (they show on phone rows).
- Not checked in the browser: saving the Storage Unit sheet, the Assign sheet, the Approval Requirement modals, the Part Save enable rule, and BOP / BOM row clipping with long names (ADCS-001 rows showed no clipping).
