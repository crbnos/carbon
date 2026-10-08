# ERP phone redesign — code mapping of the approved changes

Source designs: `local-docs/mobile-design/review-2026-10-08/` (index.html, after-*.json, review.json).
Read-only mapping on `feat/mobile-redesign` at 5c51803534. Paths relative to `apps/erp/app` unless they start with `packages/`. Nothing here was run in the app unless stated.

## Part B — Quantity, Storage Unit, Picking List, Planning

### Cross-cutting
- **Trailing row action:** `CompactRow` has none (`components/Table/components/Compact/CompactRow.tsx:44-167`: checkbox, P1 + P2 trailing capped `max-w-[45%]`, P3, ≤2 pills, expand chevron, selection overlay `absolute inset-0` `:155-162`). `resolveSlots.ts:8` ignores Select/Actions/Expand. Adding one = new slot in `components/Table/types.ts:48` + `resolveSlots.ts` (+ test) + a cell in `CompactRow` raised `relative z-10`; hide it in selection mode. Shared but additive (opt-in per column).
- **Selection mode + bulk bar:** exist. Opt in with `withSelectableRows` + `renderActions` (`Table.tsx:1109-1153` → `CompactList.tsx:164-189`, `:207-211`, bulk `BottomBar` with one "Actions" dropdown `:370-390`). Both planning tables already opt in (`ProductionPlanningTable.tsx:610,614`, `PurchasingPlanningTable.tsx:687,691`).
- **Drawers:** every `DrawerContent` is a bottom sheet on phones (`packages/react/src/Drawer.tsx:94,192-248`); the grabber is visual only, no swipe code exists; 124 ERP files use it. `size="full"` also widens desktop right/left drawers (`Drawer.tsx:173-176`) — use a phone-only class instead.

### Quantity detail (`/x/inventory/quantities/:itemId/details`)
- Today: `routes/x+/inventory+/quantities+/$itemId.tsx:96-141` (app bar override, `ResizablePanel compactFocus`), `modules/inventory/ui/Inventory/InventoryItemHeader.tsx:31-58` (external link `:47-52`, `DetailsTopbar` → `CompactTabRow`), `InventoryDetails.tsx:57-171` (six cards `grid-cols-1 md:grid-cols-2` `:59`), `InventoryStorageUnits.tsx:347-476` (Update Inventory `:365-369`, Table `:372-475`, rows `:270-345`).
- **Shared:** `InventoryDetails` / `InventoryStorageUnits` also render on part/material/tool/consumable `$itemId.inventory.tsx` tabs (e.g. `routes/x+/part+/$itemId.inventory.tsx:287`). Gate quantity-only changes with a prop.
- Hero subtitle = item name: layout; `item.name` in loader (`:84-94`); `RecordHero` usable standalone (precedent `InspectionView.tsx:506`).
- Tabs Details · Activity: already exist.
- 2-col tiles: layout (`max-md:grid-cols-2`, precedent `routes/x+/sales+/_index.tsx:384`, `components/MetricCard.tsx`).
- Incoming/Outgoing/Supply–demand words: copy; data exists (`InventoryDetails.tsx:107-159`).
- "Daily usage: 30D ▾" chip: `DateSelect` already renders a chip on phones (`components/DateSelect.tsx:82-101`) but shows only the value; a prefix needs a label beside it or a new prop (shared with 6 dashboards).
- External link → ⋯ › Item Master: **conflict** — the hidden list's `CompactToolbar` already portals a ⋯ (`InventoryTable.tsx:648-654`, `CompactToolbar.tsx:135`); a second `AppBarActions` stacks two ⋯ (`Mobile/slots.tsx:45-57`). Suppress the list's fill while a `compactFocus` pane is mounted, or merge.
- Update Inventory → bottom bar: must be gated (`PartHeader` mounts `RecordPhoneChrome`, `modules/items/ui/Parts/PartHeader.tsx:92`).
- Storage Units table → rows: no phone row component for non-TanStack data; keep batch groups (`toggleGroup`) and the per-row ⋯ (Update Quantity, Print Label). Empty today = empty `<Tbody>`.

### Storage unit edit (`/x/inventory/storage-units/:id`)
- Today: `routes/x+/inventory+/storage-units.$storageUnitId.tsx:99-127`, `modules/inventory/ui/StorageUnits/StorageUnitForm.tsx:68-178` (`ModalDrawer*`), footer `[Cancel][Print][Save]` `:150-173`. Shared with `storage-units.new.tsx:88` and the inline create modal `components/Form/StorageUnit.tsx:195`.
- Full-screen sheet: phone-only class on `ModalDrawerContent` (`:76`).
- Save in header: conflicts with the drawer × (`Drawer.tsx:236,258`, `max-md:pr-14`); × disappears only without `onOpenChange` (`Modal.tsx:24-40`).
- Swipe-to-dismiss: **new behaviour**, none exists. Discard prompt already partly exists via `Submit`'s `useBlocker` (`packages/form/src/components/Submit.tsx:134-145`) — UNVERIFIED in app.
- "Print label": `PrintButton` label hard-coded "Print" (`packages/printing/src/ui/PrintButton.tsx:125`).
- Location lock + why: `label` typed `string`; reuse the form's read-only `InputBase` + `FormHelperText` pattern (`:126-137`) with `<Hidden name="locationId">`.
- Remove ⓘ: pass `termId` only off phones (`LabelWithHelp` renders nothing without it); Storage Types has no helper text → loses all help on phones.

### Picking list detail (`/x/picking-list/:id/details`)
- Today: `routes/x+/picking-list+/$pickingListId.tsx:95-106`; `modules/inventory/ui/PickingLists/PickingListHeader.tsx:139-218` (menu Reopen + Delete; actions Assignee overflow, Start primary in Draft, Finish primary In Progress, Cancel overflow → second ⋯ in bar); `PickingListLines.tsx` (`PickingKitCard` `:180-233` with `BarProgress` `:217` and inner box `:218`; line `:366-572`; qty badge `:475-491`; Short/Pick `:553-571`).
- Hero subtitle job · assignee: **derived data** — `pickingList` has no job column; jobs come from lines (`inventory.service.ts:2960-2972`); a list can span jobs. Assignee name via `assigneeUser(fullName)` (`:2898`) / `usePeople` for optimistic ids.
- Short/Pick equal buttons, Pick secondary on phones: layout; tracked lines' Scan/Unpick (`:492-542`) need the same.
- Tick bar → overline header "N% picked": layout (`progress` `:191-201`; style per `CompactList.tsx:295-302`).
- Inner box removed, line cards: layout, local file.
- Words for quantities + Short pill: copy; data exists.
- Bar: Finish only primary; Assign/Start/Cancel/Reopen/Delete → app bar ⋯: `menu` also renders on desktop (`RecordHeader.tsx:334-346`) → needs phone-only items or a new slot; `Assignee` (`components/Assignee.tsx:115-205`) is a self-contained Popover with no controlled `open` → as a menu row needs a new prop or picker sheet. In Draft, Start is primary.

### Production / Purchasing planning
- Today: `routes/x+/production+/planning.tsx:97-120`, `routes/x+/purchasing+/planning.tsx`; tables `modules/production/ui/Planning/ProductionPlanningTable.tsx` (cols `:347-526`) and `modules/purchasing/ui/Planning/PurchasingPlanningTable.tsx` (cols `:386-600`); order drawers are bottom sheets.
- Make N / Order N trailing button: **new CompactRow slot** (above); Order cells at Production `:487-525`, Purchasing `:563-600`.
- Recalculate → app bar ⋯: **new plumbing** — `CompactToolbar` ⋯ only has Export/Import/Select (`:98-131`); add e.g. `mobileMenuItems` through `Table → CompactList → CompactToolbar`; disable while the MRP fetcher is busy.
- Subtitle under "Material Planning": root screens render the section-switcher branch, which never renders `subtitle` (`components/Layout/Mobile/MobileAppBar.tsx:79-104`); additive shared change.
- Totals collapsed: already exists.
- On hand on the row: Production = annotation (`meta.mobile: "P3"`); Purchasing P3 is already Supplier and `resolveSlots` takes only the first P3 → needs a combined column or multi-P3 support.
- Supplier / "No Supplier" pill: exists (avatar + name; "No Supplier" untranslated).
- Bulk via Select: exists ("Actions" menu, not a direct button).

## Part A — SO, PO, Quote, Quotes list, Job, Part, Issue

### Shared mechanics
- **Hero subtitle:** `RecordHeader` → `RecordHero` (`components/Layout/RecordHeader.tsx:306-310`, phone only). Set today only on PO/Quote, to the ID-with-revision when `revisionId > 0` (`PurchaseOrderHeader.tsx:316-320`, `QuoteHeader.tsx:185-187`) — **conflict**: a counterparty subtitle would drop the only phone place showing the revision. Names are in loader data (SO `customer` `sales-order+/$orderId.tsx:233`, PO `supplier` `purchase-order+/$orderId.tsx:600`, Quote `customer` `quote+/$quoteId.tsx:195`, Issue `nonConformance.name`).
- **App bar subtitle ("Orders"):** parent breadcrumb via `deriveAppBar` (`components/Layout/Mobile/appBar.ts:68-74`) from `detailBreadcrumb` (`utils/handle.ts:41-50`; SO `$orderId.tsx:62-65`, PO `:88-91`, Quote `:54-57`, Job `:74-77`, Issue `:54-57`). Changing crumbs changes desktop; phone-only via `useSetAppBarOverride({ subtitle })` (`useAppBarOverride.ts`, `mergeAppBar` `appBar.ts:31-37`).
- **Two ⋯ on phones:** `RecordPhoneChrome` (`RecordHeader.tsx:166-247`) renders the app-bar ⋯ (Copy ID + `menu`, `:189-212`) and a bottom-bar ⋯ opening an "Actions" sheet of `slot="overflow"` actions (`:219-244`). Removing the bar ⋯ is a shared change (25 `RecordHeader` users, 24 files with overflow). `menu` items are `DropdownMenuItem`s (MenuSheet on phones, `packages/react/src/Dropdown.tsx:263-270`); overflow actions are Buttons in "row" presentation — merging = mount `overflowSlot.Target` inside the app-bar menu (controlled close) or move items into `menu` behind `isPhone` (menu also renders on desktop `:334-346`).
- **Preview icon cell:** new — bar presentation forces `w-full lg` Buttons (`packages/react/src/Button.tsx:221-238`), no icon-cell kind.
- **SplitButton chevron in bar:** `packages/react/src/SplitButton.tsx:55-125`; only PO (Finalize/Mark as Planned) and Job (Release/Mark as Planned) put one in a `RecordAction`.
- **Files cards:** `components/FileDropzone.tsx:77-93` already gives one phone Upload; the extra is each card's header "New": `OpportunityDocuments.tsx` (SO, Quote, Sales RFQ, Sales Invoice), `SupplierInteractionDocuments.tsx` (PO, Purchasing RFQ, Purchase Invoice, Supplier Quote), `components/Documents.tsx` (Issue, Gauge Calibration). Precedent hiding thead when empty: `components/RecordDocuments.tsx:129`.
- **Empty state:** `components/Empty.tsx:10-27` ("Looks empty here"), ~49 users; BOP/BOM reach it via `components/SortableList.tsx:325-327` (Job, Item, Quote BOP/BOM). Reuse `CompactEmpty`; add an `emptyState` prop to `SortableList`.
- **List slots:** `resolveSlots.ts:41-66` — P1 line 1, P2 line 1 trailing (static filter/`mobilePill` → pill on line 3, ≤2), P3 line 2 **first only**, P4/unset hidden; `mobileLabel` prefix (`CompactRow.tsx:13-28`); types `components/Table/types.ts:45-53`.
- **Number steppers:** `packages/form/src/components/Number.tsx:106-115`, `NumberControlled.tsx:173-182`, styles `packages/react/src/Number.tsx:76-91` (phones get a deliberate 88px −/+ pair, 44pt each). No prop hides them; `size="sm"` also shrinks the input. Hiding contradicts the earlier deliberate phone stepper design.

### Sales Order
- Order today `routes/x+/sales-order+/$orderId.details.tsx:202-240`: OpportunityState → Summary → Notes → Files → Shipping → Payment. Tabs Overview/Lines/Properties (`Panels.tsx:114-196`).
- Lines `SalesOrderSummary.tsx:346-708`: inline Edit link to `$orderId.$lineId.details.tsx` (`:429-438`); row tap toggles an inline tax/add-on breakdown + job list (`:409-411`, `:557-702`). Making tap navigate drops that breakdown and job links on phones. `SheetRowContent` (`Mobile/SheetRow.tsx`) is the nearest row.
- Shipping row: Totals `:244-339`, Add/Edit Shipping → `onEditShippingCost` (`SalesOrderShipmentForm.tsx:78`).
- Bar: Preview overflow (`SalesOrderHeader.tsx:391-415`), Confirm primary in Draft (`:284`, `:417-432`), Cancel overflow (`:434-453`), Ship/Invoice/Shipments/Invoices/RMAs by status (`:278-290`, `:455-644`); `menu` has Convert Lines to Jobs, Export CSV, Reopen, Delete (`:292-353`).

### Purchase Order
- Order `purchase-order+/$orderId.details.tsx:231-262`. Lines `PurchaseOrderSummary.tsx:53+` (Edit `:162`, toggle `:139`). The "1 ⇄" badge (`:200-210`) is meaningless: `purchaseOrderLines` has no `methodType` (`purchasing.service.ts:487-497`), always the Pull-from-Inventory icon.
- "3 of N + See all → Lines tab": tab state is local `useState` in `CompactRecordTabs` (`Panels.tsx:124-126`) — needs a setter via context/slot.
- Finalize is a `SplitButton` with Mark as Planned (`PurchaseOrderHeader.tsx:355-385`); Cancel Order `:656-675`.

### Quote
- Order `quote+/$quoteId.details.tsx:191-222`. Rows `QuoteSummary.tsx:160-275`; Edit untranslated (`:199-209`). **Row expand holds `LinePricingOptions` (`:255-265`, `:288+`), the quantity-break picker that drives totals** — tap-to-open would drop it on phones.
- Bar: Preview overflow (`:197-238`), Share when Sent; Expired → Finalize/Won resolve to overflow, nothing primary (`:104-112`); Reopen only in `menu` (`:136-155`).
- Locked cards: `QuotePaymentForm.tsx:49-61`, `QuoteShipmentForm.tsx:81-101` disable when `isQuoteLocked` (any status ≠ Draft, `sales.models.ts:1164-1166`); no locked-message component exists.

### Quotes list
- `modules/sales/ui/Quotes/QuotesTable.tsx`: quoteId P1, customer P3, status P2 pill; Draft renders `BarProgress` (`:124-130`). Data `lines`, `completedLines`, `expirationDate` loaded (`sales.service.ts:116`). Expiration on line 2 needs multi-P3 (shared, ~100 P3 uses) or a phone-only addition in the customer cell. `DateTime dateOptions` for "Sep 21".

### Job
- `job+/$jobId.details.tsx:259-345`. Method tools `JobMakeMethodTools.tsx:309-385` (Menubar: Get/Save Method, Configure, Item Master, Print; also `job+/$jobId.make.$methodId.tsx:158`). Moving to app-bar ⋯ needs a new value slot that `RecordPhoneChrome` renders after `menu`.
- Empty BOP/BOM `JobBillOfProcess.tsx:1049-1078`, `JobBillOfMaterial.tsx:559-586` (via SortableList).
- Estimates vs Actual `JobEstimatesVsActuals.tsx:311-329`: layout fix.
- Bar `JobHeader.tsx`: Pause secondary (`:393-441`, disabled unless Ready/In Progress `:405-408` → disabled next to Release on Draft), Release SplitButton with Mark as Planned (`:443-469`), Complete/Cancel/SO link/Traveler overflow.

### Part
- `part+/$itemId.details.tsx:285-375`. `modules/items/ui/Item/MakeMethodTools.tsx:234-265` (Get/Save Method, Item Master untranslated `:262`), version dropdown `:267-~380`; shared with tool/service/part details and make routes (6). Version chip needs extracting the control or a slot above `BillOfProcess` (route `:337`).
- Rows: shared `SortableList` item (`truncate` `:120`) — what clips on device UNVERIFIED.
- Steppers: `ItemManufacturingForm.tsx:62-77`. Save footer `:96-103` (`Submit withBlocker={false}`); "enabled only while changed" = new; `Submit` reads `touchedFields` (`packages/form/src/components/Submit.tsx:79-80`); touched ≠ dirty.

### Issue
- `issue+/$id.details.tsx:153-245`. Actions card `components/ActionTasks/ActionTaskList.tsx:94-135`, dashed add tile `ActionTaskAddModal.tsx:64-73` (shared with Change Notices). Approval Requirements `ReviewersList.tsx`: empty → only a dashed tile opening a modal with an MRB checkbox (`:56-58`, `:179-187`); non-empty → card with "Add Requirement" opening a different modal (`:60-138`) — one header Add must pick one flow.
- Properties already a tab (`issue+/$id.tsx:265`) → an Overview card would duplicate it.
- Bar already matches (Start primary, Complete secondary when Registered; `IssueHeader.tsx:148-196`).
