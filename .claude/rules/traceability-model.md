---
paths:
  - "packages/database/supabase/migrations/*tracked*.sql"
  - "apps/erp/app/modules/inventory/{lineage.server,inventory.service,types}.ts"
  - "apps/erp/app/routes/x+/traceability+/**"
  - "apps/mes/app/services/operations.service.ts"
---

# Traceability / Genealogy Model

Carbon records serial/batch lineage as a **directed graph**:

- **Nodes** = `trackedEntity` rows (a physical serial / batch / lot).
- **Edges** = a `trackedActivity` (an event) plus its `trackedActivityInput` (consumed
  entities) and `trackedActivityOutput` (produced entities) link rows.

Inputs of one activity that are also outputs of an earlier activity form the parent→child
chain. The graph need not be acyclic in storage; traversal RPCs use *strict* filtering to
avoid an entity appearing as its own ancestor/descendant within a single activity.

## Tables (current schema — newest migrations win)

`trackedEntity` (`packages/database/supabase/migrations/20250225145619_tracked-entities.sql`
+ later columns):

| Column | Notes |
| --- | --- |
| `id` TEXT | default `nanoid()` (was `xid()` originally, changed in `20250304230616`) |
| `quantity` NUMERIC | serial entities = 1 |
| `status` `trackedEntityStatus` | enum `'Available' \| 'Reserved' \| 'On Hold' \| 'Consumed'`, default `Available` |
| `sourceDocument` TEXT, `sourceDocumentId` TEXT | polymorphic provenance; for batch/serial/job-seed entities it is `'Item'` + the item id |
| `sourceDocumentReadableId` TEXT | denormalized `item.readableIdWithRevision`; kept in sync by an `item` AFTER-UPDATE interceptor `sync_propagate_item_readable_id_to_tracked_entity` (`20260428100000`) |
| `readableId` TEXT | the serial OR batch number (promoted out of `attributes` in `20251220013724`/`20251220021403`) |
| `itemId` TEXT | **FK to `item(id)` `ON DELETE RESTRICT`** (`20260426000000`). Nullable today; an item with any tracked entity (even `Consumed`) cannot be hard-deleted — deactivate instead |
| `expirationDate` DATE | first-class column (`20260426020000`), drives FEFO + near-expiry reports. NOT stored in `attributes` |
| `attributes` JSONB | descriptive only: `Receipt Line`, `Receipt`, `Supplier`, `Job`, `Job Make Method`, `Job Material`, etc. (GIN-indexed) |
| `companyId`, `createdAt`, `createdBy` | standard |

`trackedActivity`: `id`, `type` TEXT (e.g. `'Picking'`, production, receipt…),
`sourceDocument`/`sourceDocumentId`/`sourceDocumentReadableId` (nullable), `attributes` JSONB.

`trackedActivityInput` / `trackedActivityOutput`: PK `(trackedActivityId, trackedEntityId)`,
`quantity` NUMERIC, `companyId`, `createdAt`, `createdBy`. Both FK to activity and entity
`ON DELETE CASCADE`.
**Gotcha:** the old `trackedActivityInput.entityType` column was **dropped** in
`20250301125444` — it does not exist.

RLS: SELECT/INSERT gated on `get_companies_with_employee_role()`; UPDATE/DELETE require
`inventory_update` / `inventory_delete` permissions (`20260327171223`).

## How entities are created

- **Receipt** (batch/serial): DB functions `update_receipt_line_batch_tracking` /
  `update_receipt_line_serial_tracking` insert with `status='On Hold'`, fill `readableId`,
  `itemId`, and resolve `expirationDate` (caller-supplied or `resolve_shelf_life_start_for_receipt`).
- **Job seed entities**: `item` event-trigger handlers `sync_insert_job_make_method`,
  `sync_insert_job_material_make_method`, `sync_update_job_material_make_method_item_id`
  create `status='Reserved'` entities tagged with `Job` / `Job Make Method` / `Job Material`.
- `jobMakeMethod.trackedEntityId` plus `requiresSerialTracking` / `requiresBatchTracking`
  flags (derived from `item.itemTrackingType` = `'Serial'`/`'Batch'`) drive whether a job
  step demands tracking.

## How genealogy edges are written

Edges are created in **Supabase edge functions** (`packages/database/supabase/functions/`)
and MES services — NOT a single `post-production`:

- `post-picking`, `post-receipt`, `post-shipment`, `post-stock-transfer`, `issue`,
  `trigger-rework` insert `trackedActivity` + input/output link rows on posting.
- MES `startProductionEvent` (`apps/mes/app/services/operations.service.ts`) inserts a
  `trackedActivity` and a `trackedActivityOutput` for the production event.

Pattern: insert `trackedActivity`, then `trackedActivityInput` for each consumed entity and
`trackedActivityOutput` for each produced entity; post `itemLedger` rows
(`itemLedger.trackedEntityId` FK, `ON DELETE SET NULL`) for the inventory movement.

## How lineage is queried

Per-entity strict RPCs (`20251231172218`, returns `readableId`):
`get_direct_ancestors_of_tracked_entity_strict(p_tracked_entity_id)` (backward / "where from") and
`get_direct_descendants_of_tracked_entity_strict(p_tracked_entity_id)` (forward / "where to").
Non-strict variants exist but include same-activity siblings — prefer strict.

**Batch variants** (`20260430090114`, take a `TEXT[]`, add a `sourceEntityId` output column):
`get_direct_ancestors_of_tracked_entities_strict` / `get_direct_descendants_of_tracked_entities_strict`
— one round-trip per BFS frontier instead of per node. The ERP graph view uses these.

- Graph route: `apps/erp/app/routes/x+/traceability+/graph.tsx` → calls
  `fetchLineageSubgraph` / `fetchJobScopedLineage` in
  `apps/erp/app/modules/inventory/lineage.server.ts` (BFS over the batch RPCs).
- Graph types `GraphNode` / `GraphLink` / `GraphData` live in
  `apps/erp/app/modules/inventory/types.ts` (link `type` is `"input" | "output"`).
- ERP service `inventory.service.ts`: `getTrackedEntities`, `getTrackedEntity`,
  `getTrackedEntitiesByMakeMethodId`, `getTrackedEntitiesByOperationId`,
  `updateTrackedEntityExpiry`, `getTrackedEntityExpirations`.
- MES `operations.service.ts`: `getTrackedEntity`, `getTrackedEntitiesByMakeMethodId`,
  `getTrackedInputs` (wraps the strict RPCs), `startProductionEvent`.

## Picking / availability (shelf → storageUnit rename)

`get_available_tracked_entities(...)` (`20260614171204`) and
`get_picking_list_tracked_available(...)` (`20260617142853`) list `status='Available'`
entities for picking. These return **`storageUnitId` / `storageUnitName`** (`storageUnit`
table) — the modern naming after the `shelf` → `storageUnit` rename. They net out
`pickingListLineTrackedEntity` allocations, drop lineside (work-center) bins, and order by
FEFO (`expirationDate ASC NULLS LAST`) then FIFO (`createdAt ASC`). Powers the shared
`packages/react/src/TrackedEntityPicker.tsx`.

**Gotcha:** the older `get_item_quantities_by_tracking_id` (`20260101163400`) still emits
legacy `shelfId` / `shelfName` and joins the `shelf` table — both column sets exist; check
which RPC you are calling.
