---
paths:
  - "apps/erp/app/routes/api+/kanban.*.tsx"
  - "apps/erp/app/modules/inventory/ui/Kanbans/*.tsx"
  - "packages/documents/src/pdf/KanbanLabelPDF.tsx"
  - "packages/database/supabase/migrations/*kanban*.sql"
  - "apps/erp/app/modules/inventory/inventory.service.ts"
  - "packages/database/src/stock-transfer.ts"
  - "packages/database/src/event-system/handlers/*kanban*.sql"
  - "packages/jobs/src/inngest/functions/tasks/kanban-level-check.ts"
---

# Kanban System

Scan-based replenishment cards for inventory items, per location. Each kanban scan
(via QR/label/URL) triggers a purchase order (`Buy`), a production job (`Make`), or a
stock transfer (`Transfer`). Lives in the inventory module.

## Data model

Table `kanban` (initial migration `20250909012102_kanban.sql`; newest `20261028191437_kanban-readable-id.sql` (after `20261012232517_kanban-replenishment-level.sql`), plus the generated `20261012232520_kanban-level-check-triggers.sql` for its interceptor).
**Composite PK `("id", "companyId")`.** Key columns:

- `id` TEXT default `id('kb')`, `itemId` FK→item (CASCADE), `companyId` FK→company
- `kanbanId` TEXT (nullable) — the readable number (`KB000001`, sequence `kanban`), printed on the
  label (`20261028191437_kanban-readable-id.sql`). Unique per company. The BEFORE INSERT trigger
  `set_kanban_readable_id` assigns it from `get_next_sequence` when the insert has none (creating the
  company's `kanban` sequence row first if it is missing, so no kanban is left unnumbered), so every
  insert path (form, MCP, datasets, fixtures) is numbered with no call-site code. An insert that
  names its own number keeps it, and the `sync_advance_document_sequence` interceptor moves the
  counter past it (`20261028221530`), so a later generated number cannot collide. The BEFORE UPDATE
  trigger `prevent_kanban_readable_id_change` (`20261028221145`) refuses changing a set number — it
  is printed on the card — and allows filling a NULL one. `upsertKanban` drops a `kanbanId` the
  caller sends. Nullable only because a restore loads rows with triggers off, and a pre-migration
  backup has no number. Not to be confused with
  `stockTransfer.kanbanId`, the FK to `kanban.id` — the same `job.jobId` / `jobMaterial.jobId` split.
- `replenishmentSystem` `kanbanReplenishmentSystem` enum (`'Buy' | 'Make' | 'Transfer'`),
  default `'Buy'` — **retyped from `itemReplenishmentSystem`** in `20260908143722_kanban-transfer.sql`
  (Transfer is NOT added to `itemReplenishmentSystem`; that enum drives planning/MRP/demand)
- `quantity` INTEGER (reorder qty), `locationId` FK→location
- `storageUnitId` FK→storageUnit (nullable) — **renamed from `shelfId`** in `20260417000100_storage-unit-rename.sql`.
  For a `Transfer` kanban this is the **destination** (to) bin.
- `fromStorageUnitId` FK→storageUnit (nullable) — the **source** bin for a `Transfer` kanban
  (`20260908143722_kanban-transfer.sql`)
- `replenishmentLevel` NUMERIC (nullable, `>= 0`) — arms a `Transfer` kanban's level signal
  (`20261012232517_kanban-replenishment-level.sql`). NULL = scan-only. `upsertKanban` writes NULL
  when the form field is blank or the system is not Transfer (zod omits a blank optional field,
  so a plain spread would keep the old value on update). It also writes `fromStorageUnitId` NULL
  for a non-Transfer kanban, so a switch to Buy or Make drops the stale source bin.
- CHECK `kanban_transfer_distinct_storage_units_check` — a Transfer kanban's From and To bins
  differ (the zod refine alone let an API write create a self-feeding kanban).
- `supplierId` FK→supplier, `purchaseUnitOfMeasureCode` FK→unitOfMeasure, `conversionFactor` NUMERIC default 1 (Buy fields)
- `autoRelease` BOOL, `autoStartJob` BOOL, `completedBarcodeOverride` TEXT, `jobId` FK→job ON DELETE SET NULL (Make fields; `jobId`/auto-start added in `20251001001426_kanban-jobs.sql`)
- audit: `createdAt/By`, `updatedAt/By`

Indexes: `kanban_itemId_idx`, `kanban_locationId_idx` (companyId, locationId), `kanban_companyId_idx`, `kanban_jobId_idx`.
RLS: SELECT = any employee role; INSERT/UPDATE/DELETE = `inventory_create`/`inventory_update`/`inventory_delete`.

**View `kanbans`** (SECURITY_INVOKER) is the read source for services/UI. Joins item, location,
`storageUnit s` (destination), `storageUnit fs` (source), `supplier su`, and `job j` — exposing
`name`, `readableIdWithRevision`, `jobReadableId` (= `j."jobId"`), `locationName`, `storageUnitName`,
`fromStorageUnitName`, `supplierName`, `thumbnailPath`. Recreated with storageUnit refs in
`20260417000300_storage-unit-recreate-dependents.sql`, then with the source-bin join in
`20260908143722_kanban-transfer.sql`, and again for `replenishmentLevel` and `kanbanId`
(`20261012232517`, `20261028191437`).

`kanbanOutput` setting (enum `('label','qrcode','url')`, default `'qrcode'`) is a per-company column on
`companySettings` (migration `20251001021231_kanban-settings.sql`), NOT a kanban-specific table. Beside it,
`kanbanLabelSize` (enum `('letter','label4x2','label3x2')`, default `'letter'`,
`20261028214508_kanban-label-size.sql`) is what a label prints on; the thermal values are `labelSizes` ids
(`@carbon/utils`). Both are saved by `updateInventorySettings` from the Kanban Output card
(`x+/settings+/inventory.tsx`), which shows Label Size only while the output is `label`.

## Code surfaces

- Validator `kanbanValidator`: `apps/erp/app/modules/inventory/inventory.models.ts`. Fields match columns above; enum is `kanbanReplenishmentSystemTypes` (`Buy`/`Make`/`Transfer`, distinct from the item-level `replenishmentSystemTypes`). `.refine`s require: `supplierId` when `Buy`; `fromStorageUnitId` + `storageUnitId` (and that they differ) when `Transfer`.
- Services: `apps/erp/app/modules/inventory/inventory.service.ts` — `getKanbans(client, locationId, companyId, args)` (one row per kanban; the `inventory_getKanbans` MCP tool), `getKanbanItems(client, locationId, companyId, args)` (the list: one row per item, below), `getKanban(client, kanbanId, companyId)`, `getKanbanProjectedQuantities(client, companyId, kanbanIds)` (RPC `get_kanban_projected_quantities`, the list's Projected quantity), `upsertKanban`, `deleteKanban`. Reads go through the `kanbans` view; writes hit `kanban`. The view expands `k.*` at creation, so a new `kanban` column needs the view recreated.
- `kanbanOutputTypes` + validator: `apps/erp/app/modules/settings/settings.models.ts`. Set via `x+/settings+/inventory.tsx`.
- UI: `apps/erp/app/modules/inventory/ui/Kanbans/KanbanForm.tsx` and `KanbansTable.tsx`.
  Form shows Buy fields (supplier/UoM/conversion), Make fields (autoRelease, autoStartJob — gated on autoRelease, completedBarcodeOverride), or Transfer fields (From Storage Unit + the reused storage-unit field relabeled "To Storage Unit") conditionally. Dropdown offers `Buy`/`Make`/`Transfer`.
  The list is one row per item at the location, as the Inspection Plans list is one row per
  part, read from the `kanbanItems` view (`20261029130430_kanban-items-view.sql`, over the
  `kanbans` view): the item, `kanbanCount`, `replenishmentSystems` and `supplierIds` (arrays,
  filtered with `contains`), `kanbanIds` (for the search) and a `kanbans` jsonb rollup
  (`KanbanSummary`) the expanded row lists — each kanban's ID (the edit link), replenishment,
  supplier, storage unit, job, Min / Projected for an armed Transfer kanban, Reorder Qty., its
  Create / Start / Complete codes (`KanbanCodeLinks.tsx`, with `KanbanQrCodeProvider`) and an Edit / Print Label / Delete menu. Clicking a row
  expands it; a search expands every row and marks the matches. The row's context menu and
  the bulk action print every kanban of the item. The same migration rewrote saved views of
  the list (`tableView.table = 'kanban'`): `replenishmentSystem` / `supplierId` filters became
  the array filters, and filters or sorts on per-kanban columns were dropped.
- Routes: list `x+/inventory+/kanbans.tsx` (auto-selects location, loads `kanbanOutput`), plus `kanbans.new.tsx`, `kanbans.$id.tsx`, `kanbans.delete.$id.tsx`.

## Path config (`apps/erp/app/utils/path.ts`)

- `api`: `kanban`, `kanbanCollision`, `kanbanComplete`, `kanbanStart`, `kanbanJobLink` → `/api/kanban[/sub]/:id`
- `file`: `kanbanLabelsPdf(ids, action)` → `/file/kanban/labels/:action.pdf?ids=`; `kanbanQrCode(id, action)` → `/file/kanban/:id/:action.png`
- `to`: `kanbans`, `kanban(id)`, `newKanban`, `deleteKanban(id)` under `/x/inventory/kanbans`

`action` is always `"order" | "start" | "complete"`. **One action per card, never several codes on one card** — an operator would scan the wrong one. Create, Start and Complete are separate cards (and separate print links).

## Replenishment / scan flow

API routes in `apps/erp/app/routes/api+/`: `kanban.$id.tsx`, `kanban.collision.$id.tsx`, `kanban.start.$id.tsx`, `kanban.complete.$id.tsx`, `kanban.link.$id.tsx`.

`kanban.$id.tsx` (the "order"/create scan) calls `scanKanban` (`inventory.server.ts`), which branches on `replenishmentSystem` and returns what it made; the route picks the page:
- **Make** — if a job is already linked (`jobReadableId`) it returns `collision` and the route opens the collision page (no duplicate job); otherwise creates a job from the item and links it (`updateKanbanJob`). With `autoRelease`, `scanKanban` runs the release checks (`getJobReleaseReadiness` + `jobReleaseProblems` — nothing to make, manufacturing blocked, assemblies without operations, outside operations without a supplier, strict backflush lines with no storage unit), then `releaseCheckedJobs` as the system on behalf of the scanner (a system context built from the scan's own service-role client and `pg`), so a scanner without production update can still release (recalculate, MRP, Ready, outside-operation POs, release date; telemetry `source: "kanban"`), then `runLocationSchedule` once the job is Ready. Unlike `releaseJobs`, a supplier's Draft PO is not a blocker — no one at a kanban card can choose one — so the outside operations go on the supplier's newest Draft PO (highest `purchaseOrderId`), else a new one; otherwise the first scan's PO blocked every later scan. A job that fails the checks stays Draft, stays linked, and the scan returns a `message`. So does a job whose Get Method (`upsertJobMethod`) failed, with or without `autoRelease`: it is never released; the route throws `redirect(jobPage, flash(…))` with it. Returning the flash with `data()` does not work: the root's `flashMiddleware` clears it on the same request. Only a released job sends the scanner to MES: `autoStartJob` opens its first operation's start, else the operation. See `apps/erp/app/modules/production/AGENTS.md` → "Every path to Ready".
- **Buy** — reuses an existing draft/planned PO for the supplier (or creates one), adds a PO line with the kanban qty (applying `conversionFactor`/`purchaseUnitOfMeasureCode`/storage unit), redirects to the PO.
- **Transfer** — calls `replenishKanban` (`inventory.service.ts`, ported from the `kanban-replenish` server function) with `mode: "scan"`, which writes a Released stock transfer with one line: `itemId`, `fromStorageUnitId` → `storageUnitId` (to), `quantity`, and serial/batch flags from `item.itemTrackingType` (a serial line of qty > 1 splits into qty-1 lines, `expandSerialTrackedLines`). The transfer carries `stockTransfer.kanbanId` and a Tiptap note "Kanban replenishment — … Signal: scan by <user>." Redirects to the stock transfer, where the qty can be **partially picked** at pick time. Each scan makes a new transfer, with no level test. Storage rules are NOT evaluated (a QR scan can't show the acknowledge dialog the interactive wizard uses). `scanKanban` calls it as the scanner (`invokePosting` with the scanner's client and `{ as: replenishKanbanPermission }`): scan mode needs `create: "inventory"`, the same check the `stockTransfer` RLS rule made when the route inserted directly. Never drop the client or the `as` — that lets any employee create transfers. The function re-checks that both bins belong to the company and the kanban's location (CWE-639). It also refuses (outcome `invalid`, `KANBAN_REPLENISH_REASONS.nonNettableStorageUnit`) when either bin is non-nettable, for a scan and a level check alike: the move would release quarantined stock or stock a unit nothing may use.
- **Buy and Make** — not a kanban option (the enum has no such value).

The collision page's "Remove Job" only unlinks the job (`jobId: null`; the job is unchanged) and redirects to the scan, which creates the next job.

`start`/`complete` resolve the linked job's active operation and redirect to the MES operation start/complete endpoints; `link` navigates to the job/operation.

## Level signal (Transfer kanbans with `replenishmentLevel`)

Spec: `.ai/specs/2026-10-06-kanban-internal-replenishment-level.md`.

- **Projected quantity** = on-hand at the To bin (`item_ledger_on_hand_contribution`, so Rejected
  tracked stock does not count) + `outstandingQuantity` of every stock transfer line into it whose
  transfer is not Completed (Draft counts: a reopened kanban transfer is still supply), manual or kanban. One function computes it: `get_kanban_projected_quantities(company_id, kanban_ids)`.
- Fires **strictly below** the level (`isBelowReplenishmentLevel`, `@carbon/database/stock-transfer`).
  One level signal = one transfer of `n × quantity`, `n = ceil((level − projected) / quantity)`
  (`levelReplenishmentQuantity`), so the level is reached in one signal. A scan moves one `quantity`.
  Kanbans sharing an item and To bin share supply within a call (`addedInbound` in `replenishKanban`).
- The open transfer counts as supply, so a second signal for the same shortfall writes nothing, and
  the pick moves stock from "inbound" to "on-hand" without changing the projected quantity.
- Three wake paths, all sending `carbon/kanban.level-check` `{ companyId, kanbanIds }` and only for
  kanbans already below level:
  - `queue_kanban_level_checks` — statement handler on `itemLedger` (any posting at the To bin).
  - `sync_kanban_level_check` — `after` interceptor on `kanban` (arming or editing a level).
  - `util.sweep_kanban_levels()` — pg_cron `kanban-level-sweeper` at `7 * * * *`, over
    `util.kanban_level_breaches()`: covers a deleted transfer, a transfer completed short, a lost event.
  Both trigger bodies return early under `app.sync_in_progress` (seeds, restores, test fixtures).
  All three need the Vault secret `inngest_event_url`.
- `kanbanLevelCheckFunction` (`functions/tasks/kanban-level-check.ts`, concurrency 1 per company, no
  `debounce`) calls `kanban-replenish` with `mode: "level"` (`"system"` permission; `kanbanIds` required). `replenishKanban` locks the kanbans
  `FOR UPDATE` in id order and re-reads the projected quantity inside its transaction, so a stale or
  duplicate event is a no-op. `createdBy` is `"system"` on this path.
- A kanban replenishment is a stock transfer with `kanbanId` set: the stock transfers list has a
  derived **Source** column (Kanban / Manual, filtered on `kanbanId IS [NOT] NULL` in
  `getStockTransfers`) and the header shows a Kanban badge linking to the kanban.

## Labels & QR

- QR PNG route: `apps/erp/app/routes/file+/kanban+/$id.$action[.]png.tsx`, 36px modules, **color-coded by action**: order=black `#000000`, start=emerald `#059669`, complete=blue `#2563eb`. (The old doc claiming "no color differentiation" was stale.)
- Label PDF route: `apps/erp/app/routes/file+/kanban+/labels.$action[.]pdf.tsx` — `?ids=` (comma-separated), one `.in()` read of the `kanbans` view scoped by `companyId`, rendered at the company's `kanbanLabelSize` (`?labelSize=` overrides). Thumbnails are fetched for the letter sheet only.
- The card is defined once in `packages/documents/src/zpl/KanbanLabelZPL.tsx`: `KanbanLabelItem`, `kanbanLabelCode` (the card's one code for its `action`, with a caption: CREATE, START or COMPLETE), the text helpers, `canHoldKanbanLabel` (3" x 2" and up; 100 x 50 mm passes), `getKanbanLabelLayout` (inches: the code on the right, as large as the label allows (at most 45% of its width), caption under it; a text column on the left — each field cut to the column — the part name up to two lines (`wrapKanbanLabelText`), every other field one line (`fitKanbanLabelText`): name, item ID, bins, `QTY` and `MIN` on their own lines (`kanbanLabelQuantityLines`), supplier — with the kanban ID small at the bottom), `KANBAN_LABEL_COLORS` and `generateKanbanLabelZPL(item, size, baseUrl, action)`. Text is cut by an estimated glyph width (`fitKanbanLabelText`) and escaped with `^FH` (`zplFieldData`, `zpl/utils.ts`). Pinned by `kanbanLabelZPL.test.ts`.
- `KanbanLabelPDF` (`packages/documents/src/pdf/KanbanLabelPDF.tsx`, via `@carbon/documents/pdf`): takes the `action`; without `labelSize`, a letter page, **2×3 grid = 6 labels/page** — the action-colored code (like the PNG route) with the item thumbnail beside it, name, item readable id, storage unit/location, `QTY: {quantity} {uom}` (plus `MIN: {replenishmentLevel}` — no unit, because `uom` is the purchase unit and the level is in stock units), and a bottom row with the `kanbanId` (bold, left) and supplier (right). The code carries its caption (CREATE / START / COMPLETE, in the action's color) on the letter sheet too, since one sheet can hold all three cards of a kanban. With a `labelSize`, one card per page laid out by `getKanbanLabelLayout`, so the PDF and the ZPL print alike; the PDF colors the code and caption by action (black Create, green Start, blue Complete), and the ZPL (black only) relies on the caption.
- Print job: `resolveKanbanData` (`print-job/resolvers.ts`) returns one `KanbanCardItem` per action — `order`, `start`, `complete` for a Make kanban, `order` only for Buy and Transfer — so each card is its own `printJob` (description ends Create / Start / Complete) and `renderKanbanCard` (`print-job/renderers.tsx`) renders the item's `action`; `kanbanUrl` (BinderyPress data) is that action's scan URL from `kanbanLabelCode`. A printer whose media size holds a card prints one at that size — ZPL, or a one-card PDF. A ZPL printer with smaller media fails the job; a PDF printer with smaller or no media prints the company's `kanbanLabelSize`. `resolveKanbanData` uses the `kanbanId` as the job's readable id.
- `KanbanCodeLinks` (in each kanban line of `KanbansTable`) renders Create/Start/Complete per `kanbanOutput`: `label`→PDF links (one card per action), `qrcode`→hover-card iframes (one open at a time: `KanbanQrCodeHoverCard` reads `OpenQrCodeContext`, held by `KanbanQrCodeProvider` around the table), `url`→copyable API links; Start/Complete show for Make only. Bulk **Print Labels** (and the item row's or a kanban's **Print Label**) prints each kanban's cards (all three for Make) whether it goes to a printer or falls back to the PDF (`kanbanLabelsPdf(ids, "all")`: the route's `all` action expands each Make kanban into Create, Start and Complete cards, each `KanbanLabelPDF` card carrying its own `action`): it opens a printer picker, pre-selecting the location's `kanban` printer context (Settings → Printing → Kanbans row, falling back to the location default), and POSTs one `Kanban` print job per kanban to `path.to.manualPrint` when the company has printer routes (the storage-unit list's pattern), else opens the PDF.
- `createKanban` auto-prints the new kanban's cards through `autoPrint` (`inventory.service.ts`, context `kanban`) when the context's Auto-print is on — like a posted receipt or shipment. Update does not print.

## Gotchas

- Newest migrations win: `shelfId` no longer exists — use `storageUnitId`/`storageUnitName`. PK is composite, so queries/upserts scope by `companyId`.
- **A kanban never names a non-nettable storage unit on save.** `createKanban` / `updateKanban` refuse one (`refuseNonNettableKanbanUnits`, `inventory.service.ts`); an update checks only a unit it sets, so a kanban whose unit became non-nettable later can still be edited. Its scans are refused instead: `scanKanban` runs the same check for a Buy or Make card, and `replenishKanban` for a Transfer card (see `inventory-system.md` → Non-nettable storage).
- **Transfer** kanbans only use the `order` (create) scan — Start/Complete are Make-only. The `KanbansTable` expanded row renders `fromStorageUnitName → storageUnitName` for Transfer. `KanbanLabelPDF` shows the same `from → to` when `fromStorageUnitName` is set (else the single destination bin); the field is threaded through BOTH label paths — the interactive route (`labels.$action[.]pdf.tsx`) and the print-job resolver/renderer (`print-job/resolvers.ts` `KanbanCardItem` + `renderers.tsx`).
- `jobId` is auto-cleared (set NULL) when its job is completed/cancelled via the `sync_job_complete_or_canceled` event interceptor (`20260410031803_job-interceptors.sql`). A populated `jobReadableId` in the view means an active job → "order" scan collides.
