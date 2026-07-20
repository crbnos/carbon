---
paths:
  - "apps/erp/app/routes/api+/kanban.*.tsx"
  - "apps/erp/app/modules/inventory/ui/Kanbans/*.tsx"
  - "packages/documents/src/pdf/KanbanLabelPDF.tsx"
  - "packages/database/supabase/migrations/*kanban*.sql"
---

# Kanban System

Scan-based replenishment cards for inventory items, per location. Each kanban scan
(via QR/label/URL) triggers either a purchase order (`Buy`) or a production job (`Make`).
Lives in the inventory module.

## Data model

Table `kanban` (initial migration `20250909012102_kanban.sql`; current state spans 7 migrations).
**Composite PK `("id", "companyId")`.** Key columns:

- `id` TEXT default `id('kb')`, `itemId` FK→item (CASCADE), `companyId` FK→company
- `replenishmentSystem` `itemReplenishmentSystem` enum, default `'Buy'`
- `quantity` INTEGER (reorder qty), `locationId` FK→location
- `storageUnitId` FK→storageUnit (nullable) — **renamed from `shelfId`** in `20260417000100_storage-unit-rename.sql`
- `supplierId` FK→supplier, `purchaseUnitOfMeasureCode` FK→unitOfMeasure, `conversionFactor` NUMERIC default 1 (Buy fields)
- `autoRelease` BOOL, `autoStartJob` BOOL, `completedBarcodeOverride` TEXT, `jobId` FK→job ON DELETE SET NULL (Make fields; `jobId`/auto-start added in `20251001001426_kanban-jobs.sql`)
- audit: `createdAt/By`, `updatedAt/By`

Indexes: `kanban_itemId_idx`, `kanban_locationId_idx` (companyId, locationId), `kanban_companyId_idx`, `kanban_jobId_idx`.
RLS: SELECT = any employee role; INSERT/UPDATE/DELETE = `inventory_create`/`inventory_update`/`inventory_delete`.

**View `kanbans`** (SECURITY_INVOKER) is the read source for services/UI. Joins item, location,
`storageUnit s`, `supplier su`, and `job j` — exposing `name`, `readableIdWithRevision`,
`jobReadableId` (= `j."jobId"`), `locationName`, `storageUnitName`, `supplierName`, `thumbnailPath`.
Recreated with storageUnit refs in `20260417000300_storage-unit-recreate-dependents.sql`.

`kanbanOutput` setting (enum `('label','qrcode','url')`, default `'qrcode'`) is a per-company column on
`companySettings` (migration `20251001021231_kanban-settings.sql`), NOT a kanban-specific table.

## Code surfaces

- Validator `kanbanValidator`: `apps/erp/app/modules/inventory/inventory.models.ts`. Fields match columns above; `.refine` requires `supplierId` when `replenishmentSystem === "Buy"`.
- Services: `apps/erp/app/modules/inventory/inventory.service.ts` — `getKanbans(client, locationId, companyId, args)`, `getKanban(client, kanbanId)`, `upsertKanban`, `deleteKanban`. Reads go through the `kanbans` view; writes hit `kanban`.
- `kanbanOutputTypes` + validator: `apps/erp/app/modules/settings/settings.models.ts`. Set via `x+/settings+/inventory.tsx`.
- UI: `apps/erp/app/modules/inventory/ui/Kanbans/KanbanForm.tsx` and `KanbansTable.tsx`.
  Form shows Buy fields (supplier/UoM/conversion) or Make fields (autoRelease, autoStartJob — gated on autoRelease, completedBarcodeOverride) conditionally. Form dropdown offers only `Buy`/`Make` (not `Buy and Make`).
- Routes: list `x+/inventory+/kanbans.tsx` (auto-selects location, loads `kanbanOutput`), plus `kanbans.new.tsx`, `kanbans.$id.tsx`, `kanbans.delete.$id.tsx`.

## Path config (`apps/erp/app/utils/path.ts`)

- `api`: `kanban`, `kanbanCollision`, `kanbanComplete`, `kanbanStart`, `kanbanJobLink` → `/api/kanban[/sub]/:id`
- `file`: `kanbanLabelsPdf(ids, action)` → `/file/kanban/labels/:action.pdf?ids=`; `kanbanQrCode(id, action)` → `/file/kanban/:id/:action.png`
- `to`: `kanbans`, `kanban(id)`, `newKanban`, `deleteKanban(id)` under `/x/inventory/kanbans`

`action` is always `"order" | "start" | "complete"`.

## Replenishment / scan flow

API routes in `apps/erp/app/routes/api+/`: `kanban.$id.tsx`, `kanban.collision.$id.tsx`, `kanban.start.$id.tsx`, `kanban.complete.$id.tsx`, `kanban.link.$id.tsx`.

`kanban.$id.tsx` (the "order"/create scan) branches on `replenishmentSystem`:
- **Make** — if a job is already linked (`jobReadableId`) it redirects to the collision route (no duplicate job); otherwise creates a job from the item, links it (`updateKanbanJob`), then `autoRelease` runs MRP + schedules and `autoStartJob` redirects into MES to start the first operation.
- **Buy** — reuses an existing draft/planned PO for the supplier (or creates one), adds a PO line with the kanban qty (applying `conversionFactor`/`purchaseUnitOfMeasureCode`/storage unit), redirects to the PO.
- **Buy and Make** — not supported (errors).

`start`/`complete` resolve the linked job's active operation and redirect to the MES operation start/complete endpoints; `link` navigates to the job/operation.

## Labels & QR

- QR PNG route: `apps/erp/app/routes/file+/kanban+/$id.$action[.]png.tsx`, 36px modules, **color-coded by action**: order=black `#000000`, start=emerald `#059669`, complete=blue `#2563eb`. (The old doc claiming "no color differentiation" was stale.)
- Label PDF route: `apps/erp/app/routes/file+/kanban+/labels.$action[.]pdf.tsx` — takes `?ids=` (comma-separated), fetches kanbans from the `kanbans` view, converts thumbnails to base64, renders `KanbanLabelPDF`.
- `KanbanLabelPDF`: `packages/documents/src/pdf/KanbanLabelPDF.tsx` (exported via `@carbon/documents/pdf`). Letter page, **2×3 grid = 6 labels/page**; each shows the action-colored QR, item thumbnail, name, readable id, storage-unit/location, `QTY: {quantity} {uom}`, and supplier name. QR color matches the PNG route.
- `KanbansTable` renders Create/Start/Complete affordances per `kanbanOutput`: `label`→PDF links, `qrcode`→hover-card iframes, `url`→copyable API links. Start/Complete show for Make only. Bulk "Print Labels" opens the PDF for selected ids (`action: "order"`).

## Gotchas

- Newest migrations win: `shelfId` no longer exists — use `storageUnitId`/`storageUnitName`. PK is composite, so queries/upserts scope by `companyId`.
- `jobId` is auto-cleared (set NULL) when its job is completed/cancelled via the `sync_job_complete_or_canceled` event interceptor (`20260410031803_job-interceptors.sql`). A populated `jobReadableId` in the view means an active job → "order" scan collides.
