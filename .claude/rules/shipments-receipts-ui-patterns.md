---
paths:
  - apps/erp/app/modules/inventory/ui/{Shipments,Receipts}/**
  - apps/erp/app/routes/x+/{shipment,receipt}+/**
  - packages/server-functions/src/{post-shipment,post-receipt,create}/**
---

# Shipments & Receipts UI + Posting Flow

Outbound (`shipment`) and inbound (`receipt`) documents are header + lines. They mirror
each other closely. UI lives in `apps/erp/app/modules/inventory/ui/{Shipments,Receipts}/`;
routes in `apps/erp/app/routes/x+/{shipment,receipt}+/` (NOT under `inventory+/` — that
only holds the two list routes `shipments.tsx` / `receipts.tsx`).
<!-- UNVERIFIED: warehouse transfers are a separate system (modules/inventory/ui/WarehouseTransfers, routes x+/warehouse-transfer+/) — out of scope for this rule. -->

## Routes (per document, e.g. `shipment+/`)

- `new.tsx` — **action only**. Creates the doc by calling the **`create` server function**
  (`create(ServerFnContext.system({ db, companyId, userId }), { type, locationId, ...sourceIds })`),
  then `throw redirect(path.to.shipmentDetails(id))`. There is **no `upsert` on create** — the
  server function allocates the human ID and copies source-document lines. For the
  `'Rental Agreement'` source it first redirects to the agreement's existing Draft (one Draft
  rental shipment and one Draft rental receipt per agreement, enforced by the partial unique
  indexes `shipment_oneOpenDraftPerRentalAgreement_idx` / `receipt_oneOpenDraftPerRentalAgreement_idx`),
  else invokes `create` with `shipmentFromRentalAgreement` / `receiptFromRentalAgreement`.
- `$id.tsx` — layout loader: parallel `getShipment` / `getShipmentLines` / `getShipmentTracking`,
  plus fixed-asset lines (`shipmentFixedAssetLine`) and related items. Receipt also loads
  `getReceiptFiles`, `getBatchProperties`, `getShelfLifeForItems`, `companySettings`. Renders `<Outlet/>`.
- `$id._index.tsx` — redirects to `…/details`.
- `$id.details.tsx` — renders Form + Lines + Notes. **Action**: validate, then if `sourceDocument`
  changed re-invoke `create`, else `upsertShipment` / `upsertReceipt` (Supabase upsert, sets `updatedBy`).
  A rental document refuses a change of source ("A rental shipment keeps its rental agreement.
  Create it from the agreement.").
- `$id.post.tsx` — see posting flow below.
- `$id.void.tsx` — guards status, invokes post fn with `type: "void"`.
- `$id.delete.tsx` — `deleteShipment` / `deleteReceipt` service fn; **guard: blocked once `postingDate` is set**.
- `lines.update.tsx` — Supabase upsert on `shipmentLine`; only `storageUnitId` + `shippedQuantity`
  (receipt: `receivedQuantity`). Item/storage rules are NOT evaluated here, only at post.
- `lines.tracking.tsx` — writes `trackedEntity.attributes` (`"Shipment Line"`, `Shipment`, serial
  `"Shipment Line Index"`); guards entity status — `"Available"` normally, `"On Hold"` when the
  shipment's source is a Sales Return Order (returned stock ships back from hold); clears stale
  attrs off prior entities. Receipt tracking additionally has a `returnEntity` type for
  sales-return receipts (same-serial re-entry, guarded by provenance: the entity must be the
  return line's item and shipped to that return's customer on a posted shipment).
- `lines.split.tsx` — invokes `create` with `type: "shipmentLineSplit"` / `receiptLineSplit`.
- `lines.$id.delete.tsx` — `deleteShipmentLine` / `deleteReceiptLine`.
- `fixed-asset-lines.update.tsx` — update one field of a `shipmentFixedAssetLine` / `receiptFixedAssetLine`,
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
  Outbound Transfer, Rental Agreement — `PACKING_SLIP_SOURCES`; a rental shipment prints as a
  "Delivery Ticket", one row per shipped unit with its serial number, through the `title` field of
  `PackingSlipData`) — and whose Activity tab is the audit log.
- **Form** (`ShipmentForm.tsx`, `ReceiptForm/ReceiptForm.tsx`): flat `ValidatedForm` (no Card),
  source-document `Select` + dependent `Combobox` (ID), `Location`, custom fields. The
  `use{Shipment,Receipt}Form` hook fetches
  selectable source documents (filtered by status) when not posted. **Posted locks `location`,
  `sourceDocument`, `sourceDocumentId`.** Shipment extra field `trackingNumber` + `ShippingMethod`;
  receipt extra `externalDocumentId`.
- **Lines** (`ShipmentLines.tsx`, `ReceiptLines.tsx`): card-row list (a bordered div, **not** a
  table), one `…LineItem` per line. Inline `NumberField` for shipped/received qty and a
  storage-unit `Combobox` (disabled for PO/Job fulfillment), each persisting via a fetcher to
  `lines.update`. Per-line dropdown = Split / Delete. Optimistic updates merge pending fetcher
  submissions. Batch/serial sub-forms render only when `line.requiresBatchTracking` /
  `requiresSerialTracking`. **Receipt** batch/serial forms add an **expiration date** (batch date
  shows only when item shelf-life mode is "Set on Receipt") and a per-line **FileDropzone**;
  shipment forms do not.
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
  (default company today, no future date), sent as `postingDate`; `ReceiptPostModal` also blocks a
  ticked unit treated as a sale that has no Return To.
  **Both post modals are source-aware for return flows**, and must stay in step with
  `lines.tracking`'s guard or they reject what tracking accepted:
  `ReceiptPostModal` counts a serial slot as filled when the entity is merely ASSIGNED on a
  `Sales Return Order` receipt (returned units are picked, not typed, so they carry no
  `readableId` of their own); `ShipmentPostModal` and `ShipmentLines`' batch/serial inputs
  expect `On Hold` rather than `Available` when the shipment's source is a
  `Sales Return Order` (see `expectedEntityStatus` in `ShipmentLines.tsx`).

## Posting flow (`$id.post.tsx` → server function)

The route action: evaluates storage/sales rules (`@carbon/ee/rules.server`) over the
relevant surfaces, optimistically sets `status: "Pending"`, then
`serverFns.system({ db: getDatabaseClient(), companyId, userId }).invoke("post-shipment" / "post-receipt", { type: "post", id })`.
On error it reverts status to `Draft`. May then auto-print and (sales shipment) generate a packing
slip PDF; receipt may call `update-purchased-prices` when `updateLeadTimesOnReceipt` is set.

`post-receipt` and `post-shipment` (`packages/server-functions/src/`) take
`{ type: "post" | "void", {receipt,shipment}Id, postingDate? }` (the context carries `companyId` / `userId`;
`postingDate` is read only by the rental source, and `$id.post.tsx` passes it from the modal), run
the service-role client + Kysely `db.transaction()`, and branch on `sourceDocument`:

- **post-receipt** handles `Purchase Order`, `Inbound Transfer`, `Rental Agreement` (returns each
  ticked unit through `returnRentalUnit` and moves its `fixedAsset.locationId` to the receipt's
  location; `post-receipt/rental-agreement.ts`), and `Sales Return Order`
  (customer RMA re-entry at original outbound cost, entities to On Hold). PO path: inserts `itemLedger`
  (entry types `Positive/Negative Adjmt.` by sign), GR/IR + inventory `journalLine`s for every
  company (the journal is Provisional before the accounting cutover, Posted after it), advances PO line `quantityReceived`/`receivedComplete` and PO `status`,
  flips tracked entities to `Available` (**`On Hold` if the item has a Receipt-usage inspection
  document assignment**), and
  creates one `inspection` lot per inspected line (see `inspection-system.md`).
- **post-shipment** handles `Rental Agreement` (puts each ticked unit On Rent on the delivery
  date; no `itemLedger`, `costLedger` or journal; `post-shipment/rental-agreement.ts`), `Sales Order`, `Purchase Order`, `Outbound Transfer`,
  `Sales Return Order` (return-to-customer), and `Purchase Return Order` (supplier return,
  Cr Inventory / Dr GR/IR; the `create` server function seeds the shipment's tracked entities from
  `purchaseReturnOrderLineTrackedEntity`, and this path **splits** a batch when the returned
  quantity is less than the entity's — same `buildBatchSplitRecords` mechanism as SO). SO path: COGS
  `journalLine`s via `calculateCOGS` + `costLedger`, negative `itemLedger`, advances SO line
  `quantitySent`/`sentComplete` and SO `status`, updates `job.quantityShipped`/status for Job
  fulfillment, and **splits** batch tracked entities when shipped qty < entity qty.
**GL dimensions on return journals.** Every return-flow journal (post-shipment
`Sales Return Order` + `Purchase Return Order`, post-receipt `Sales Return Order`)
attaches automatic `journalLineDimension` rows — item, item posting group
(`itemCost.itemPostingGroupId`), party (supplier/customer + type), and location —
built index-parallel to the journal lines and emitted through the shared pure
`buildJournalLineDimensionInserts` (`@carbon/utils` `journal-dimensions.ts`), gated
by the company group's configured `dimension` rows. The journalLine insert must
`.returning(["id"])` so dimension #i binds to line #i. The **void** cases copy the
original lines' dimensions onto the reversing lines (read `journalLineDimension` by
`journalLineId`, re-attach by position) so a void mirrors the posting. `post-memo`
already carries the party dimensions; its legs are aggregate so no per-item dimension
applies.

- **`void`** (post fn, `type: "void"`): requires `status === "Posted"`; receipt also blocks if
  `invoiced` (and only PO-sourced receipts can void). Posts reversing `itemLedger` + `journalLine`s,
  rolls back source-document quantities, restores tracked entities to `Available`, sets `status: "Voided"`.
  A rental shipment voids while every unit is still On Rent and no `Accrual` row of its lines is
  Posted or held by a Draft run: the units go back to Pending. `post-receipt` refuses a rental
  receipt void ("A rental return cannot be voided. Correct the unit by hand.").
  The rental lifecycle itself is in `apps/erp/app/modules/sales/AGENTS.md` → Rentals.

## Gotchas

- **`Pending` is a transient posting state**, not a workflow stage. The action sets it before the
  server-function call and the action reverts it to `Draft` on failure.
- Status enums are only `Draft / Pending / Posted` in the base migrations; `Voided` was added later
  (`20250828142122_void-shipment.sql`, `20260422100000_receipt-status-voided.sql`). Read newest first.
- The `sourceDocument` enums list many values (Sales/Purchase Invoice, Return Orders, Manufacturing
  Consumption/Output for receipts), but the post fns only implement the handful above — other source
  documents fall through with no posting effect.
- Lines persist directly through `lines.update` on edit; the form's submit only saves the header.
- `create`, post-shipment, and post-receipt run service-role + Kysely (RLS bypassed) — the **route**
  `requirePermissions({ update: "inventory" })` is the auth gate.
