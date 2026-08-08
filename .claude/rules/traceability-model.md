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
| `status` `trackedEntityStatus` | enum `'Available' \| 'Reserved' \| 'On Hold' \| 'Consumed' \| 'Rejected' \| 'Scrapped'`, default `Available`. `Scrapped` (`20260807090400`) is terminal but **recoverable** via ERP Unscrap (unlike `Consumed`); excluded from on-hand/availability like `Rejected` |
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
- **Scrap** (`.ai/specs/2026-08-06-scrap-unscrap-flow.md`): `issue` case
  `jobOperationScrap` scraps the serial being made — `type: 'Scrap'` activity,
  entity → `Scrapped`, then **spawns the next serial** (same `getNextSerialNumbers`
  path as `jobOperationSerialComplete`) and reopens the make method's Done ops
  (`issue/scrap-replacement.ts`) so the replacement runs the full routing. `issue`
  case `scrapTrackedEntity` scraps a subcomponent, branching on entity **state**:
  an `Available` part posts a `Scrap` (`Negative Adjmt.`) `itemLedger` at its
  on-hand bin (`quantityIssued` untouched); a `Consumed` part posts Dr scrap /
  Cr WIP at the item's unit cost and **decrements `quantityIssued`** to reopen
  the requirement. Make-to-Order can additionally spawn a replacement + `rework`
  row (`makeReplacement`). ERP stock **Scrap/Unscrap** run through
  `post-inventory-adjustment` (`type: 'Unscrap'` activity restores a `Scrapped`
  entity at the original scrapped cost via `correctionOfItemLedgerId`). Every scrap
  journal is offset to `accountDefault.scrapAccount` and tagged with ScrapReason /
  WorkCenter / Employee `journalLineDimension` rows.

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
  `getTrackedInputs` (wraps the strict RPCs; **filters out `Scrapped` descendants** so a
  scrapped subcomponent no longer appears in the issue modal's Unconsume/Scrap lists — the
  scrap already relieved its WIP and reopened the requirement; the lineage graph still shows
  it), `startProductionEvent`.

**Serial sibling clustering (display only).** A serial item at qty N produces N
qty-1 entities by design, so one job fans out into N identical nodes. The graph
collapses siblings that share an identical **edge signature** — the exact set of
`(activityId, side)` pairs — plus the same item and `status`, into one
`entityGroup` node (`ui/Traceability/cluster.ts` → `clusterEntities`, called from
`payloadToFlow` in `ui/Traceability/utils.ts`, whose only caller is the worker's
`computeFullLayout`). Guards: the traced root never clusters, `quantity !== 1`
never clusters (protects post-flip batch fragments), the entity must resolve to a
SINGLE timeline state (a bin-transferred serial replays to two and stays
individual), and a group needs ≥ 3 members. One edge per signature entry with the
members' quantities summed. Members are reached only through the sidebar's list —
cluster nodes carry no expand toggles, since expanding a 50-member group would
fetch 50 lineages. Clusters travel from the graph to the sidebar (its sibling in
the route) through `ui/Traceability/store.ts`. Because clustering absorbs serial
fans, `MAX_ENTITIES` in `lineage.server.ts` is **500**; the BFS must stay complete
up to it, since a truncated frontier would split a group in two.

## Picking / availability (shelf → storageUnit rename)

`get_available_tracked_entities(...)` (`20260614171204`) and
`get_picking_list_tracked_available(...)` (`20260617142853`) list `status='Available'`
entities for picking. These return **`storageUnitId` / `storageUnitName`** (`storageUnit`
table) — the modern naming after the `shelf` → `storageUnit` rename. They net out
`pickingListLineTrackedEntity` allocations, drop lineside (work-center) bins, and order by
FEFO (`expirationDate ASC NULLS LAST`) then FIFO (`createdAt ASC`). Powers the shared
`packages/react/src/TrackedEntityPicker.tsx`. `get_available_tracked_entities` also
takes `p_sort_method` (`Default|FEFO|FIFO|LIFO`) — but its internal `ORDER BY` is not
guaranteed through PostgREST (SQL-function inlining), so callers that need a specific
order sort in the app (MES `sortLotsByPickMethod` in `apps/mes/app/services/allocation.ts`).

**Split identity convention (batch only; spec `.ai/specs/2026-08-04-batch-split-identity-flip.md`):**
on a partial batch draw of quantity `q` from `parent`, the **shelf/source entity KEEPS its id**
and is decremented by `q`; a **NEW `child` entity** (same `readableId`, attributes cloned +
`"Split From Entity ID": parent.id`) holds `q` and is what departs (lineside / other bin /
consumed / shipped). The Split activity records input `parent`@`q` → output `child`@`q` (no
survivor self-loop), and the ledger gets exactly **two** net-zero `Batch Split` rows
(−`q` parent, +`q` child) at the parent's `resolveTrackedEntityBin` bin. The legacy pre-flip
convention (original departs, `"Split Entity ID"` tagged on the survivor) still exists on
historical rows — filters that isolate the live root entity exclude BOTH pointer keys. The
shared record builder is `functions/shared/batch-split.ts` (`buildBatchSplitRecords` /
`buildMergeRecords`), used by every writer: `post-picking` (batch), `issue`
(`trackedEntitiesToOperation` + `maintenanceDispatchTrackedEntities`), `post-stock-transfer`
(batch), `post-shipment` (SO + PO — PO posts genealogy only, no ledger), and ERP
`quality-disposition.subdivideBatchEntity`. Serial paths never split. Exception: the
PO-sourced `post-shipment` split posts no `itemLedger` (matches pre-flip behavior).

**Pick → consume → return lifecycle (batch/serial):** a **pick** (`post-picking`) is an
`itemLedger` Transfer warehouse→lineside (the departing lineside lot is the split CHILD, and
`pickingListLineTrackedEntity` records the CHILD id); **consumption** (`issue`
`trackedEntitiesToOperation`) posts a negative Consumption row and, on partial use, **splits**
the entity — the CONSUMED portion becomes the NEW `child` (`status: 'Consumed'`), the survivor
keeps its id at lineside. Consumption/split rows are booked against the entity's actual on-hand
bin (`resolveTrackedEntityBin`), not an arbitrary ledger row. The **return** of the un-consumed
remainder runs via `post-picking`'s sweep cases `returnJobRemainders` (at job complete — both
policies) / `returnOperationRemainders` (at operation Done, only when
`companySettings.returnPickedMaterialTiming = 'operation'`): the tracked path walks the picked
entity's split lineage and, for each lineage entity with lineside on-hand, **merges** it back
into its `"Split From Entity ID"` parent when the parent is Available/same-lot/same-bin (a
`type: 'Merge'` activity + net Transfer), else transfers it back as a standalone lot. It
decrements the `pickingListLineTrackedEntity` allocation but books the line-level return on
**`pickingListLine.quantityReturned`** (NOT decrementing `quantityPicked` — that would fire
`update_picking_list_status` and demote a Completed/Partial header). Untracked materials return
per jobMaterial:
`max(0, Σ(picked − returned) − max(quantityIssued, owed))`, newest-line-first — never a bin
sweep (the lineside bin is shared per work center). Spec:
`.ai/specs/2026-08-04-picked-material-return-timing.md`.

**Gotcha:** the older `get_item_quantities_by_tracking_id` (`20260101163400`) still emits
legacy `shelfId` / `shelfName` and joins the `shelf` table — both column sets exist; check
which RPC you are calling.
