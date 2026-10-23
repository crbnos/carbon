---
paths:
  - apps/erp/app/modules/inventory/ui/{Shipments,Receipts}/**
  - apps/erp/app/routes/x+/{shipment,receipt}+/**
  - apps/erp/app/modules/shared/shared.service.ts
  - apps/erp/app/modules/inventory/inventory.{server,service}.ts
---

# Shipments & Receipts UI + Posting Flow

Outbound (`shipment`) and inbound (`receipt`) documents are header + lines. They mirror
each other closely. UI lives in `apps/erp/app/modules/inventory/ui/{Shipments,Receipts}/`;
routes in `apps/erp/app/routes/x+/{shipment,receipt}+/` (NOT under `inventory+/` — that
only holds the two list routes `shipments.tsx` / `receipts.tsx`).
<!-- UNVERIFIED: warehouse transfers are a separate system (modules/inventory/ui/WarehouseTransfers, routes x+/warehouse-transfer+/) — out of scope for this rule. -->

## Routes (per document, e.g. `shipment+/`)

Every action below makes ONE call to an operation in
`apps/erp/app/modules/inventory/inventory.server.ts` (`api.inventory.<name>` through
`carbon(request)`; the names are flat, such as `createShipment`, `updateReceipt`,
`setReceiptLineBatch`); the logic described here lives in that operation, so the API and MCP
run the same checks. The route only parses the form, and takes the document id from the URL.

- `new.tsx` — **action only** (`createShipment` / `createReceipt`). Creates the doc by calling the **`create` posting**
  (`invokeCreate(ctx, { type, locationId, ...sourceIds })`, which runs `createDocument` in `shared.service.ts`),
  then `throw redirect(path.to.shipmentDetails(id))`. There is **no `upsert` on create** — the
  posting allocates the human ID and copies source-document lines. For the
  `'Rental Agreement'` source it first redirects to the agreement's existing Draft (one Draft
  rental shipment and one Draft rental receipt per agreement, enforced by the partial unique
  indexes `shipment_oneOpenDraftPerRentalAgreement_idx` / `receipt_oneOpenDraftPerRentalAgreement_idx`),
  else invokes `create` with `shipmentFromRentalAgreement` / `receiptFromRentalAgreement`.
  A receipt's lines start at the quantity still to receive, or at 0 when
  `companySettings.receiptQuantitiesStartAtZero` is on (Settings → Inventory → Receiving —
  every source `create` builds lines for: Purchase Order, Inbound Transfer, Sales Return Order;
  a PO's fixed-asset lines then start unticked). Shipments are not affected.
  The `'Customer Contract'` source (a contract delivery, below) does the same: `createShipment`
  returns the contract's Draft delivery, else invokes `create` with `shipmentFromCustomerContract`.
- `$id.tsx` — layout loader: parallel `getShipment` / `getShipmentLines` / `getShipmentTracking`,
  plus fixed-asset lines (`shipmentFixedAssetLine`) and related items. On a `Customer Contract`
  shipment it also reads `serialNumberByLineId` from `shipmentLine` (the `shipmentLines` view
  predates `shipmentLine.serialNumber`). Receipt also loads
  `getReceiptFiles`, `getBatchProperties`, `getShelfLifeForItems`, `companySettings`. Renders `<Outlet/>`.
- `$id._index.tsx` — redirects to `…/details`.
- `$id.details.tsx` — renders Form + Lines + Notes. **Action** (`updateShipment` / `updateReceipt`): if
  `sourceDocument` or the location changed it re-invokes `create`, else the building block
  `upsertShipment` / `upsertReceipt` (Supabase update, sets `updatedBy`).
  A rental document refuses a change of source ("A rental shipment keeps its rental agreement.
  Create it from the agreement."). A contract delivery does too, in either direction ("A
  contract delivery keeps its contract. Create it from the contract."), and neither re-invokes
  `create` on a header change.
- `$id.post.tsx` — see posting flow below.
- `$id.void.tsx` (`voidShipment` / `voidReceipt`) — guards status, invokes the posting with `type: "void"`.
- `$id.delete.tsx` (`deleteShipment` / `deleteReceipt`) — **guard: blocked once `postingDate` is set**.
- `lines.update.tsx` (`updateShipmentLines` / `updateReceiptLines`) — one field on the selected
  lines; only `storageUnitId`, `shippedQuantity` and `serialNumber` (a contract delivery's typed
  serial) (receipt: `receivedQuantity`). Item/storage rules
  are NOT evaluated here, only at post.
- `lines.tracking.tsx` (`assignShipmentLineEntity`; receipt: `setReceiptLineBatch` /
  `setReceiptLineSerial` / `assignReceiptReturnEntity` / `removeReceiptReturnEntity`, one per
  `trackingType`) — writes `trackedEntity.attributes` (`"Shipment Line"`, `Shipment`, serial
  `"Shipment Line Index"`); guards entity status with `shippableEntityStatuses`
  (`inventory.utils.ts`) — `"Available"` normally, `"On Hold"` when the shipment's source is a
  Sales Return Order (returned stock ships back from hold), `"Available"` or `"Rejected"` when it
  is a Purchase Return Order (rejected units go back to the supplier — a Rejected unit only when
  its `Receipt` attribute is a posted receipt from the shipment's supplier); clears stale
  attrs off prior entities. Receipt tracking additionally has a `returnEntity` type for
  sales-return receipts (same-serial re-entry, guarded by provenance: the entity must be the
  return line's item and shipped to that return's customer on a posted shipment).
  A receipt serial write is keyed by its box (`Receipt Line` + `Receipt Line Index`), not by the
  serial number, and planned by the pure `planSerialBoxWrite` (`inventory.models.ts`): an empty
  value clears the box, a new value renames the box's unposted entity, and a refused value (a
  serial of a unit with `itemLedger` history, checked first; a serial held by another box or by
  any other record, such as a job's reserved serial; or a failed write) empties the box, so a box
  showing an error never posts its previous serial. Only this box's record, or one from a voided
  receipt, is ever taken over. Typed serials only
  exist on purchase receipts of new units (outside-processing lines ask for none, inbound
  transfers never touch serials), so writing into an existing unit is never right: it wiped a
  shipped unit's `Shipment` link, which the RMA provenance check reads. `ReceiptLines` sends every
  blur as typed, an empty value included, and shows the server's error: the server, not the page,
  decides a duplicate, so a box is never cleared because another box holds the same text. Enter
  only moves focus (`data-serial-boxes`) so the blur is the one save. `setReceiptLineSerial`
  runs `saveReceiptSerialBox` (`inventory.service.ts`): the reads, the write
  (`update_receipt_line_serial_tracking`, called through Kysely) and the release in one
  transaction, holding the receipt line `FOR UPDATE` so two saves of one line run one after the
  other; a failed write empties the box in a second one (`clearReceiptSerialBox`). Refused
  unless the receipt is Draft.
  The `postReceipt` operation refuses a Posted or Voided receipt before any write, and refuses
  the post (back to Draft) when `reconcileReceiptSerialEntities` reports a line still missing
  serials ("Serial numbers are missing").
  Lowering `receivedQuantity` (`updateReceiptLines`) runs the same cleanup on a Draft receipt, in
  one Kysely transaction with the quantity update, and refuses a non-numeric quantity. Every
  removal goes through `releaseReceiptSerialEntities` (`@carbon/database/receipt-serials`, Kysely,
  set-based; the line split uses it too): an entity with no
  `itemLedger` history is deleted, one with history only loses its receipt attributes — a sales
  return re-tags real shipped units. `lines.return-entities` reports a failed read as an error,
  and `ReturnEntityForm` shows it instead of falling back to typed serials (whose empty save
  would unlink an assigned unit).
- `lines.split.tsx` (`splitShipmentLine` / `splitReceiptLine`) — invokes `create` with
  `type: "shipmentLineSplit"` / `receiptLineSplit`.
  A serial `receiptLineSplit` drops the line's serials, deleting only entities with no
  `itemLedger` history; a unit with history (a sales return) only loses its receipt link.
- `lines.$id.delete.tsx` — `deleteShipmentLine` / `deleteReceiptLine`.
- `fixed-asset-lines.update.tsx` (`updateShipmentFixedAssetLine` / `updateReceiptFixedAssetLine`) — update one field of a `shipmentFixedAssetLine` / `receiptFixedAssetLine`,
  parsed by `shipmentFixedAssetLineUpdateValidator` / `receiptFixedAssetLineUpdateValidator`
  (`inventory.models.ts`): `shipped`/`received`, `serialNumber`, `meter`; the receipt also takes
  `notes`, `outOfService` ("" clears the tick, any other text is the reason, so tick and reason save
  together) and `residualDestination`. It refuses a line whose document is not Draft ("A posted
  shipment can no longer be changed" / "A posted receipt can no longer be changed"): a posted
  document is a record, the meter included.
- `_layout.tsx` — breadcrumb handle back to `path.to.inventory`.

Navigate via the typed `path.to.*` helpers (`shipmentDetails`, `shipment`, `shipmentPost`,
`shipmentVoid`, `shipmentLineSplit`, …) in `apps/erp/app/utils/path.ts` — never hardcode URLs.

## Components

- **Page** (`$id.tsx`): `DocumentPage` (`components/DocumentPage/`) with
  `{Shipment,Receipt}Header` (ID, status, created/posted line, ⋯ Void/Delete, labels
  `PrintButton`, Invoice, Post) and a `DocumentSidebar` whose Documents tab is
  `{Shipment,Receipt}Documents` — the customer/supplier, the source document, invoices
  (shipment: `getShipmentRelatedItems`; receipt: `getReceiptRelatedItems`, which also resolves a
  sales return's customer), receipt inspections and line attachments, the shipment's packing slip
  (only for the sources its PDF route renders: Sales Order, Sales Invoice, Purchase Order,
  Outbound Transfer, Rental Agreement, Customer Contract — `PACKING_SLIP_SOURCES`; a rental
  shipment prints as a "Delivery Ticket", one row per shipped unit with its serial number, through
  the `title` field of `PackingSlipData`; a contract delivery prints as a "Receiving Report", below)
  — and whose Activity tab is the audit log. The sidebar row is titled "Packing Slip" for every
  source. A contract delivery's source row links the contract (`path.to.contractDetails`, with
  `view: sales`), as does the `ShipmentsTable` source column.
- **Form** (`ShipmentForm.tsx`, `ReceiptForm/ReceiptForm.tsx`): flat `ValidatedForm` (no Card),
  source-document `Select` + dependent `Combobox` (ID), `Location`, custom fields. The
  `use{Shipment,Receipt}Form` hook fetches
  selectable source documents (filtered by status) when not posted. **Posted locks `location`,
  `sourceDocument`, `sourceDocumentId`.** Shipment extra field `trackingNumber` + `ShippingMethod`;
  receipt extra `externalDocumentId`. A `Rental Agreement` or `Customer Contract` shipment keeps
  its source: both source fields are read-only (`keepsSource`), and the source `Select` offers
  `Customer Contract` only on a contract delivery.
- **Lines** (`ShipmentLines.tsx`, `ReceiptLines.tsx`): card-row list (a bordered div, **not** a
  table), one `…LineItem` per line. Inline `NumberField` for shipped/received qty and a
  storage-unit `Combobox` (disabled for PO/Job fulfillment), each persisting via a fetcher to
  `lines.update`. Per-line dropdown = Split / Delete. Optimistic updates merge pending fetcher
  submissions. Batch/serial sub-forms render only when `line.requiresBatchTracking` /
  `requiresSerialTracking`. **Receipt** batch/serial forms add an **expiration date** (batch date
  shows only when item shelf-life mode is "Set on Receipt") and a per-line **FileDropzone**;
  shipment forms do not. A receipt line that is inspected shows a small red clipboard beside the
  item name (`ReceiptLineInspectionMark`): on an unposted Purchase Order receipt when the item has
  a Receipt-usage inspection plan (`getReceiptInspectedItemIds`, loader `inspectedItemIds`), and
  once posted when the line has a lot (`receiptInspections` by `sourceDocumentLineId`), which the
  mark links to for a `quality` viewer.
- **Rental lines**: on a `'Rental Agreement'` document the loader reads `getRentalShipmentLines` /
  `getRentalReceiptLines` into `rentalLines`, rendered by the siblings `ShipmentRentalLineItem` /
  `ReceiptRentalLineItem` (no storage unit picker, no serial tracking). Both render the unit through
  the shared `RentalUnitRow` (`ui/Shipments/RentalUnitRow.tsx`: tick, item thumbnail, unit name, asset
  id and serial, and **Meter** — a `NumberField` while Draft, plain text once posted; laid out on the
  row's own `@container`). Shipment: the shipped tick and **Meter**. Receipt adds **Notes**, the
  **Take out of service** switch (a `@carbon/form` `Boolean` inside a field-context-only
  `ValidatedForm`, saved through the same per-field update) with its reason, and **Return To**
  (Fleet / Inventory) for a unit treated as a sale. The loaders sort `rentalLines` by asset id so the
  list holds still across edits. The existing fixed-asset components need an order line id, which a
  rental line does not have.
- **Contract delivery lines**: on a `'Customer Contract'` shipment, `ShipmentLineItem` hides the
  storage unit picker (the delivery moves no stock) and shows a **Serial Number** input that saves
  `shipmentLine.serialNumber` on blur through `lines.update` (field `serialNumber`). The value comes
  from the loader's `serialNumberByLineId`. No tracked entity holds the serial: the job consumed
  the part to the project.
- **Notes**: shipment uses `ShipmentNotes` (Card with **internal + external** tabbed editors).
  Receipt details reuses `SupplierInteractionNotes` (**internal notes only**) — there is no
  `ReceiptNotes` component.
- **Status** (`ShipmentStatus.tsx`, `ReceiptStatus.tsx`): `Draft`(gray) `Pending`(orange)
  `Posted`(green) `Voided`(red). Shipment additionally shows `Invoiced`(blue) when `invoiced` and not voided.
- **Modals**: `ReceiptPostModal` (validates lines on mount — batch lines need a batch number,
  serials reconciled across indices `0..receivedQuantity`; uses `useRuleViolations`),
  `ShipmentVoidModal` / `ReceiptVoidModal` (destructive `Alert` + bulleted consequences, submit
  via `fetcher.Form` to the void route). Shipment posting is gated by `ShipmentPostModal.tsx`.
  On a rental document the post modals show a date field, **Delivered on** / **Returned on**
  (default company today, no future date), sent as `postingDate`; `ShipmentPostModal` shows
  **Delivered on** on a contract delivery too (`isDelivery`); `ReceiptPostModal` also blocks a
  ticked unit treated as a sale that has no Return To.
  **Both post modals are source-aware for return flows**, and must stay in step with
  `lines.tracking`'s guard or they reject what tracking accepted:
  `ReceiptPostModal` counts a serial slot as filled when the entity is merely ASSIGNED on a
  `Sales Return Order` receipt (returned units are picked, not typed, so they carry no
  `readableId` of their own); `ShipmentPostModal`, `ShipmentLines`' batch/serial inputs and
  `lines.tracking` all read `shippableEntityStatuses` (`inventory.utils.ts`, pinned by
  `inventory.utils.test.ts`), so the three cannot drift.

## Posting flow (`$id.post.tsx` → `api.inventory.postShipment` / `postReceipt` → posting body)

The operation (`postShipment` / `postReceipt` in `inventory.server.ts`): evaluates storage/sales
rules (`@carbon/ee/rules.server`) over the relevant surfaces — a blocking rule returns
`{ violations, ruleNames }`, which the route hands to `useRuleViolations` — optimistically sets
`status: "Pending"`, then
`invokePosting(ctx, "post-shipment", { type: "post", shipmentId, postingDate }, service.postShipment)`
(receipt: `invokePosting(ctx, "post-receipt", { receiptId, postingDate }, service.postReceipt)`,
whose `type` defaults to `"post"`).
On error it reverts status to `Draft`. May then auto-print and (sales shipment, before the post)
save a packing slip PDF through `renderPackingSlip` (`inventory/packing-slip.pdf.tsx`, the
same renderer `file+/shipment+/$id[.]pdf.tsx` serves); receipt may call
`updatePurchasedPrices` (`purchasing.service.ts`) when `updateLeadTimesOnReceipt` is set.

`postReceipt` and `postShipment` (`inventory.service.ts`, ported from the `post-receipt` and `post-shipment` server functions) take
`{ type: "post" | "void", {receipt,shipment}Id, postingDate? }` (the context carries `companyId` / `userId`;
`postingDate` is read only by the rental and contract sources, and `$id.post.tsx` passes it from the modal to the operation), run
the service-role client + Kysely `db.transaction()`, and branch on `sourceDocument`:

- **post-receipt** handles `Purchase Order`, `Inbound Transfer`, `Rental Agreement` (returns each
  ticked unit through `returnRentalUnit` and moves its `fixedAsset.locationId` to the receipt's
  location; `returnRentalUnit` in `sales.service.ts`), and `Sales Return Order`
  (customer RMA re-entry at original outbound cost, entities to On Hold). The PO, transfer and RMA branches skip a
  line received at 0 — it books no `itemLedger`, cost layer or journal line. In the PO path a line
  received at 0 is also left out of `receiptLinesByPurchaseOrderLineId` (its PO line keeps its
  `receivedDate`, an outside-processing operation its status) and out of `trackedEntityUpdates` (a
  batch or serial still on it is not set Available and gets no Receive activity). PO path: inserts `itemLedger`
  (entry types `Positive/Negative Adjmt.` by sign), GR/IR + inventory `journalLine`s for every
  company (the journal is Provisional before the accounting cutover, Posted after it), advances PO line `quantityReceived`/`receivedComplete` and PO `status`,
  flips tracked entities to `Available` (**`On Hold` if the item has a Receipt-usage inspection
  document assignment**), and
  creates one `inspection` lot per inspected line (see `inspection-system.md`).
  The PO and sales return journal lines are built by pure builders in `inventory.service.ts`
  (`buildPurchaseReceiptJournalLines`, `buildSalesReturnReceiptJournalLines`; `purchaseReceiptLineCosts` values each PO line: shipping share, invoice-first
  claim; a negative line books what `calculateCOGS` relieved inside the transaction);
  the legacy backfill (`activateAccounting`, `accounting.service.ts`) calls the same builders
  with the stored cost rows.
- **post-shipment** handles `Rental Agreement` (puts each ticked unit On Rent on the delivery
  date; no `itemLedger`, `costLedger` or journal), `Customer Contract` (a contract delivery, below;
  `shipment-customer-contract.ts`), `Sales Order`, `Purchase Order`, `Outbound Transfer`,
  `Sales Return Order` (return-to-customer), and `Purchase Return Order` (supplier return,
  Cr Inventory / Dr GR/IR; the `create` posting seeds the shipment's tracked entities from
  `purchaseReturnOrderLineTrackedEntity`, and this path **splits** a batch when the returned
  quantity is less than the entity's — same `buildBatchSplitRecords` mechanism as SO). SO path: COGS
  `journalLine`s via `calculateCOGS` + `costLedger`, negative `itemLedger`, advances SO line
  `quantitySent`/`sentComplete` and SO `status`, updates `job.quantityShipped`/status for Job
  fulfillment, and **splits** batch tracked entities when shipped qty < entity qty. A serial or
  batch is taken from the bin it actually holds stock in (`getTrackedEntityBins`, null = no
  storage unit), not `shipmentLine.storageUnitId`; the split is booked in that same bin, a unit
  with no stock anywhere refuses the post, and the void restores each unit to the bin its posting
  used.
  The shipment journal lines (SO pairs, fixed asset sale lines, return pairs) are built
  by pure builders in `inventory.service.ts` (`buildSalesShipmentJournal`, `buildReturnShipmentJournal`) from facts the posting gathers; the
  accounting cutover's legacy backfill (`activateAccounting`, `accounting.service.ts`) calls
  the same builders with the stored cost rows.
**GL dimensions on return journals.** Every return-flow journal (post-shipment
`Sales Return Order` + `Purchase Return Order`, post-receipt `Sales Return Order`)
attaches automatic `journalLineDimension` rows — item, item posting group
(`itemCost.itemPostingGroupId`), party (supplier/customer + type), and location —
built index-parallel to the journal lines, gated by the company group's configured
`dimension` rows. post-shipment and post-receipt carry them on each built line
(`dimensions`, by entity type) and write them with `journalLineDimensionRows`
(`shared.service.ts`). The journalLine insert must
`.returning(["id"])` so dimension #i binds to line #i. The **void** cases copy the
original lines' dimensions onto the reversing lines (read `journalLineDimension` by
`journalLineId`, re-attach by position) so a void mirrors the posting. `post-memo`
already carries the party dimensions; its legs are aggregate so no per-item dimension
applies.

- **`void`** (post fn, `type: "void"`): requires `status === "Posted"`; receipt also blocks if
  `invoiced` (and only PO-sourced receipts can void). Posts reversing `itemLedger` + `journalLine`s,
  rolls back source-document quantities, sets `status: "Voided"`. A purchase receipt's void drains
  its tracked entities to quantity 0 / `Consumed` (`Scrapped`/`Rejected` kept) — they were never
  received, so no picker may offer them; a sales-return receipt's void flips the returned units
  back to `Consumed`. Inside the transaction (`lockPostedReceipt`, `assertReceivedStockOnHand`,
  `assertNoRejectedUntrackedLot` in `inventory.service.ts`) the void locks the
  receipt and re-checks `Posted` (two voids at once cannot both reverse it), refuses when the
  reversal would take a bin below zero — a serial or batch is checked on its own, so a unit that
  was moved, picked or shipped after posting is caught even when the bin holds other stock — and
  refuses a purchase receipt whose untracked inspection lot was rejected (the reject route already
  wrote that stock off). `ReceiptVoidModal` shows a refused `voidReceipt` in place and stays
  open. A serial from a voided receipt can be entered on a new receipt: `saveReceiptSerialBox`
  reuses the same tracked entity (`idsWithLiveStockHistory` ignores the ledger rows of voided
  receipts, `onVoidedReceipt` lifts the "taken by another box" refusal), so one unit keeps one
  history. The function's update keeps quantity and status, so the save resets that record to
  1 / On Hold, as a new draft serial starts.
  `voidReceipt` and `postReceipt` show a posting refusal (status below 500) in the posting's own
  words; the refusals in `postReceipt` are `InvalidInputError`, never a plain `Error` (which the
  posting reads as a 500 and the dialog would show as "Failed to void receipt").
  A rental shipment voids while every unit is still On Rent and no `Accrual` row of its lines is
  Posted or held by a Draft run: the units go back to Pending. `post-receipt` refuses a rental
  receipt void ("A rental return cannot be voided. Correct the unit by hand.").
  The rental lifecycle itself is in `apps/erp/app/modules/sales/AGENTS.md` → Rentals.

## Contract deliveries (`Customer Contract` source)

A delivery of a project contract's part CLINs (spec `.ai/specs/2026-10-21-project-contracts.md`
section 10.4, D29–D34). The sibling is the rental agreement's Deliver. The enum value comes from
`20261023024312_contract-delivery-enum.sql`; the columns and the index from
`20261023024353_prototype-clins.sql`. The CLIN side (Build, Deliver, the next step) is in
`apps/erp/app/modules/sales/AGENTS.md` → Contracts → "Part CLINs".

**Create** — the `create` posting's `shipmentFromCustomerContract` case (`shared.service.ts`) (`{ customerContractId,
customerContractLineId? }`, permission `create: inventory`). Called by the `deliverContractLine` operation (the CLIN's Deliver route
`contract+/$id.$lineId.deliver.tsx`, one line) and by `createShipment` (`shipment+/new.tsx`, every line). In one
transaction it does these steps:

1. It locks the contract `FOR UPDATE` and refuses a contract that is not Active.
2. It reads the contract's current Part lines (an `amendsLineId` replacement makes a line not
   current), or the one line given ("Only a contract line that names a part is delivered").
3. Per line, the open quantity is min(Σ `quantityComplete` of its jobs that are not Cancelled,
   the line quantity) less the shipped quantity of its Posted `Customer Contract` shipment lines.
   A line already on a Draft or Pending delivery is skipped.
4. It reuses the contract's Draft delivery, or inserts one (`sourceDocumentReadableId` = the
   contract number, `customerId`, `locationId` from the first line's first job). The partial
   unique index `shipment_oneOpenDraftPerCustomerContract_idx` allows one Draft per contract.
5. It inserts one `shipmentLine` per line with an open quantity: `lineId` = the CLIN (no FK),
   `orderQuantity`, `outstandingQuantity` and `shippedQuantity` = the open quantity (filled in:
   Deliver, then Post), the job's location, no storage unit, `unitPrice` = the line's `rate` on a
   Fixed Price line, else 0.

It refuses with "Nothing to deliver" or "The line is already on an open delivery".

**Post** — `postContractShipment` (`apps/erp/app/modules/inventory/shipment-customer-contract.ts`, called from `postShipment`), one transaction:

| | Every contract delivery line |
|---|---|
| Date | `postingDate` from **Delivered on**, never in the future (`futureDeliveryError`) |
| Quantity limit | Per CLIN: Σ `quantityComplete` of its jobs (not Cancelled) less Posted deliveries, and at most the line quantity less Posted deliveries. Refused as "<CLIN>: N to deliver, but only M built and not delivered" |
| Stock | None: no `itemLedger`, no `costLedger`, no tracked entity |
| Journal | None |
| Serial | Typed on the line (`shipmentLine.serialNumber`) |
| Billing | Fixed Price: `splitBillingRowForDelivery` moves delivered quantity × `rate` of the next Planned billing event to the delivery date and stores the row in `customerContractInvoiceLineId` (and `previousInvoiceDate` when the whole row moved). T&M and Cost Plus: nothing (`project-billing.md` → Part CLINs) |

The contract must be Active, and only lines with a `lineId` and a shipped quantity above 0 post
("Enter a quantity to deliver" otherwise). The shipment becomes `Posted` with `postingDate` and
`postedBy`.

**Void** — `voidContractShipment`: for each line with `customerContractInvoiceLineId`,
`restoreBillingRowAfterVoid` puts the billing back. It is refused once that row's invoice is not
Planned ("The delivery is invoiced. Credit it first."). Then it clears the two columns and sets
the shipment `Voided`. There is no stock to reverse.

**Receiving Report** — `renderPackingSlip` (`packing-slip.pdf.tsx`), the `Customer Contract` case, renders
`PackingSlipPDF` with `title="Receiving Report"`, `customerReferenceLabel="Contract No."` and the
contract's `customerReference`, the contract's ship-to (`shipToCustomerLocationId`) and one row per
delivered line (shipped quantity above 0): "CLIN <lineItemNumber> <description>", the item's id,
the typed serial and "<quantity> <unit>" (`PackingSlipData` row field `quantity`). The user keys it
into WAWF; there is no EDI export.

## Gotchas

- **`Pending` is a transient posting state**, not a workflow stage. The action sets it before the
  posting call and the action reverts it to `Draft` on failure.
- Status enums are only `Draft / Pending / Posted` in the base migrations; `Voided` was added later
  (`20250828142122_void-shipment.sql`, `20260422100000_receipt-status-voided.sql`). Read newest first.
- The `sourceDocument` enums list many values (Sales/Purchase Invoice, Return Orders, Manufacturing
  Consumption/Output for receipts), but the post fns only implement the handful above — other source
  documents fall through with no posting effect.
- Lines persist directly through `lines.update` on edit; the form's submit only saves the header.
- `create`, post-shipment, and post-receipt run service-role + Kysely (RLS bypassed) — the
  **operation's** `permission` (`update: "inventory"`, `create` for `createShipment` /
  `createReceipt`) is the auth gate, for every caller.
