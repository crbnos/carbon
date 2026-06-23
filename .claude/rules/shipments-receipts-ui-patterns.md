---
paths:
  - apps/erp/app/modules/inventory/ui/{Shipments,Receipts}/**
  - apps/erp/app/routes/x+/{shipment,receipt}+/**
  - packages/database/supabase/functions/{post-shipment,post-receipt,create}/**
---

# Shipments & Receipts UI + Posting Flow

Outbound (`shipment`) and inbound (`receipt`) documents are header + lines. They mirror
each other closely. UI lives in `apps/erp/app/modules/inventory/ui/{Shipments,Receipts}/`;
routes in `apps/erp/app/routes/x+/{shipment,receipt}+/` (NOT under `inventory+/` — that
only holds the two list routes `shipments.tsx` / `receipts.tsx`).
<!-- UNVERIFIED: warehouse transfers are a separate system (modules/inventory/ui/WarehouseTransfers, routes x+/warehouse-transfer+/) — out of scope for this rule. -->

## Routes (per document, e.g. `shipment+/`)

- `new.tsx` — **action only**. Creates the doc by invoking the **`create` edge function**
  (`serviceRole.functions.invoke("create", { body: { type, companyId, locationId, ...sourceIds, userId } })`),
  then `throw redirect(path.to.shipmentDetails(id))`. There is **no `upsert` on create** — the
  edge fn allocates the human ID and copies source-document lines.
- `$id.tsx` — layout loader: parallel `getShipment` / `getShipmentLines` / `getShipmentTracking`,
  plus fixed-asset lines (`shipmentFixedAssetLine`) and related items. Receipt also loads
  `getReceiptFiles`, `getBatchProperties`, `getShelfLifeForItems`, `companySettings`. Renders `<Outlet/>`.
- `$id._index.tsx` — redirects to `…/details`.
- `$id.details.tsx` — renders Form + Lines + Notes. **Action**: validate, then if `sourceDocument`
  changed re-invoke `create`, else `upsertShipment` / `upsertReceipt` (Supabase upsert, sets `updatedBy`).
- `$id.post.tsx` — see posting flow below.
- `$id.void.tsx` — guards status, invokes post fn with `type: "void"`.
- `$id.delete.tsx` — `deleteShipment` / `deleteReceipt` service fn; **guard: blocked once `postingDate` is set**.
- `lines.update.tsx` — Supabase upsert on `shipmentLine`; only `storageUnitId` + `shippedQuantity`
  (receipt: `receivedQuantity`). Item/storage rules are NOT evaluated here, only at post.
- `lines.tracking.tsx` — writes `trackedEntity.attributes` (`"Shipment Line"`, `Shipment`, serial
  `"Shipment Line Index"`); guards `status === "Available"`; clears stale attrs off prior entities.
- `lines.split.tsx` — invokes `create` with `type: "shipmentLineSplit"` / `receiptLineSplit`.
- `lines.$id.delete.tsx` — `deleteShipmentLine` / `deleteReceiptLine`.
- `fixed-asset-lines.update.tsx` — upsert `shipmentFixedAssetLine` (`shipped`/`received` bool, `serialNumber`).
- `_layout.tsx` — breadcrumb handle back to `path.to.inventory`.

Navigate via the typed `path.to.*` helpers (`shipmentDetails`, `shipment`, `shipmentPost`,
`shipmentVoid`, `shipmentLineSplit`, …) in `apps/erp/app/utils/path.ts` — never hardcode URLs.

## Components

- **Form** (`ShipmentForm.tsx`, `ReceiptForm/ReceiptForm.tsx`): Card + `ValidatedForm`, a
  `DocumentHeader`, source-document `Select` + dependent `Combobox` (ID), `Location`, custom fields,
  and a dropdown action menu (Void if posted, Delete). The `use{Shipment,Receipt}Form` hook fetches
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
- **Notes**: shipment uses `ShipmentNotes` (Card with **internal + external** tabbed editors).
  Receipt details reuses `SupplierInteractionNotes` (**internal notes only**) — there is no
  `ReceiptNotes` component.
- **Status** (`ShipmentStatus.tsx`, `ReceiptStatus.tsx`): `Draft`(gray) `Pending`(orange)
  `Posted`(green) `Voided`(red). Shipment additionally shows `Invoiced`(blue) when `invoiced` and not voided.
- **Modals**: `ReceiptPostModal` (validates lines on mount — batch lines need a batch number,
  serials reconciled across indices `0..receivedQuantity`; uses `useStorageRuleViolations`),
  `ShipmentVoidModal` / `ReceiptVoidModal` (destructive `Alert` + bulleted consequences, submit
  via `fetcher.Form` to the void route). Shipment posting is gated by `ShipmentPostModal.tsx`.

## Posting flow (`$id.post.tsx` → edge fn)

The route action: evaluates storage/item rules (`@carbon/ee/storage-rules.server`) over the
relevant surfaces, optimistically sets `status: "Pending"`, then
`serviceRole.functions.invoke("post-shipment" | "post-receipt", { body: { type: "post", id, userId, companyId } })`.
On error it reverts status to `Draft`. May then auto-print and (sales shipment) generate a packing
slip PDF; receipt may invoke `update-purchased-prices` when `updateLeadTimesOnReceipt` is set.

`post-receipt` and `post-shipment` (`packages/database/supabase/functions/`) take
`{ type: "post" | "void", {receipt,shipment}Id, userId, companyId }`, run under
`getCarbonServiceRole` + Kysely `db.transaction()`, and branch on `sourceDocument`:

- **post-receipt** handles `Purchase Order` and `Inbound Transfer`. PO path: inserts `itemLedger`
  (entry types `Positive/Negative Adjmt.` by sign), GR/IR + inventory `journalLine`s when
  `accountingEnabled`, advances PO line `quantityReceived`/`receivedComplete` and PO `status`,
  flips tracked entities to `Available` (**`On Hold` if the item `requiresInspection`**), and
  creates one `inboundInspection` lot per inspected line (see `inbound-inspection-system.md`).
- **post-shipment** handles `Sales Order`, `Purchase Order`, `Outbound Transfer`. SO path: COGS
  `journalLine`s via `calculateCOGS` + `costLedger`, negative `itemLedger`, advances SO line
  `quantitySent`/`sentComplete` and SO `status`, updates `job.quantityShipped`/status for Job
  fulfillment, and **splits** batch tracked entities when shipped qty < entity qty.
- **`void`** (post fn, `type: "void"`): requires `status === "Posted"`; receipt also blocks if
  `invoiced` (and only PO-sourced receipts can void). Posts reversing `itemLedger` + `journalLine`s,
  rolls back source-document quantities, restores tracked entities to `Available`, sets `status: "Voided"`.

## Gotchas

- **`Pending` is a transient posting state**, not a workflow stage. The action sets it before the
  edge call and the catch/edge-fn reverts to `Draft` on failure.
- Status enums are only `Draft / Pending / Posted` in the base migrations; `Voided` was added later
  (`20250828142122_void-shipment.sql`, `20260422100000_receipt-status-voided.sql`). Read newest first.
- The `sourceDocument` enums list many values (Sales/Purchase Invoice, Return Orders, Manufacturing
  Consumption/Output for receipts), but the post fns only implement the handful above — other source
  documents fall through with no posting effect.
- Lines persist directly through `lines.update` on edit; the form's submit only saves the header.
- `create`, post-shipment, and post-receipt run service-role (RLS bypassed) — the **route**
  `requirePermissions({ update: "inventory" })` is the auth gate.
