# Brainstorm: Picking Lists

> Created: 2026-06-01 14:30:00

## Context

- Manufacturing jobs require parts transported from central warehouses to production lines before operations can run. Today, Carbon has no way to generate, assign, or track this work.
- Two customer specs (ZERO and Minimal) describe picking list needs from different angles: ZERO focuses on pre-production material preparation with batch determination; Minimal focuses on lineside storage, job staging, and factory-wide pick lists.
- SAP's approach was researched for reference, particularly the MF60 Pull List pattern and the Production Material Request (PMR) concept.
- The feature serves two primary personas: the kitter (MES) who physically picks and delivers parts, and the production manager/manufacturing engineer (ERP) who generates lists, assigns kitters, and monitors progress.

## Goals

- Enable pre-production material preparation by generating picking lists from job material requirements.
- Distinguish between lineside parts (already at the work center) and warehouse parts (need picked).
- Provide a schedule-based view of picking needs, resembling the MES kanban schedule, so kitters and managers know what to pick next.
- Group picks by job operation (kits) so operators receive pre-sorted parts for their specific operation.
- Support batch-tracked items with FIFO determination.
- Track picking progress with a first-class entity (lifecycle, assignment, per-line confirmation).
- Create consumption ledger entries on pick confirmation, integrating with existing backflushing (which skips already-issued materials).

## Non-Goals

- Job staging enforcement (blocking job start until picks are complete) — picking is informational, not a gate, for v1.
- Kanban-style replenishment — lineside replenishment from central stores is already handled by warehouse transfers.
- Two-step pick-then-consume model (transfer to lineside, then separate consumption) — picks are direct goods issues to the job for simplicity.
- Automated/scheduled picking list generation — generation is user-initiated from the picking schedule, not auto-triggered on job release.
- Full warehouse management (bin-level tracking, wave picking, route optimization) — out of scope.

## Chosen Approach

**First-class picking list entity with schedule-based UX.**

### Data Model

Three new tables:

- **`pickingList`** — header with status (`Draft`, `In Progress`, `Completed`, `Cancelled`), assignee (kitter), locationId, dueDate, and standard audit fields.
- **`pickingListLine`** — per-jobMaterial pick task with `jobId`, `jobMaterialId`, `jobOperationId` (for kit grouping), `itemId`, `quantityToPick`, `quantityPicked`, `storageUnitId` (source), and status (`Pending`, `Picked`, `Short`, `Cancelled`).
- **`pickingListLineTrackedEntity`** — join table linking pick lines to multiple tracked entities (batches/serials) with quantity per entity.

One schema change:

- **`storageUnit`** — add `workCenterId` (nullable FK). If set, the storage unit is "lineside" for that work center. Children inherit this from parents (recursive). The UI shows inherited values as readonly.

### Lineside Distinction

Derived, not explicit. No separate supply type enum on BOM components.

- If a storage unit (or any ancestor) has `workCenterId` set, it's lineside.
- When generating a picking list, materials sourced from lineside storage units are excluded — they're already where they need to be.
- This keeps the BOM clean (no new fields for engineers to manage) and leverages physical reality (storage units know where they are).

### UX: Schedule-Based Picking Needs

The primary view is an **operation-centric schedule** (resembling the MES kanban schedule) filtered to show only operations with outstanding pick requirements:

- Operations appear chronologically by scheduled start time.
- Each row shows: job, operation, work center, start time, number of parts to pick.
- Fully picked operations disappear. Partially picked show progress.
- Click into an operation to see its kit (material list, quantities, source storage units, tracked entities).
- Manager selects operations and clicks "Generate Picking List" — system creates the entity with kit-grouped lines and FIFO batch determination.
- Manager assigns a kitter.
- Kitter executes in MES, confirming picks kit-by-kit.

### Generation Logic

When generating a picking list from selected operations:

1. Collect `jobMaterial` records for each selected operation.
2. Resolve source storage unit (from `jobMaterial.storageUnitId` or `pickMethod.defaultShelfId`).
3. Exclude materials where: source storage unit resolves to lineside (workCenterId set on self or ancestor), `quantityToIssue <= 0` (already fully issued), or item is non-inventory.
4. For batch-tracked items: apply FIFO (oldest receipt date first), split across batches if needed, create `pickingListLineTrackedEntity` records.
5. Create `pickingList` (Draft) and `pickingListLine` records grouped by `jobOperationId`.

### Inventory Impact

When a kitter confirms a pick line:

1. Create `itemLedger` entry: `entryType = 'Consumption'`, `documentType = 'Job Material'`, negative quantity, linked to source storage unit.
2. Update `jobMaterial.quantityIssued += quantityPicked`.
3. If tracked entities involved, link ledger entries accordingly.
4. Update line status to `Picked` (or `Short` if `quantityPicked < quantityToPick`).
5. When all lines resolved → picking list status → `Completed`.

Backflushing naturally skips already-issued materials (`GREATEST(target - quantityIssued, 0)` resolves to zero).

## Alternatives Considered

- **Pull List (view-based, no entity)** — Computed view of picking needs + warehouse transfers for execution. Fastest to build but no lifecycle management, no kitter assignment, no per-line tracking. Rejected because the user needs actionable picking with progress tracking.

- **Job Staging (integrated into job lifecycle)** — Add a "Staging" status between Ready and In Progress. Per-job only, no cross-job consolidation, mixes logistics and production concerns. Rejected because kitters often pick for multiple jobs at once, and job lifecycle shouldn't own logistics.

- **Auto-generation on job release** — System automatically creates picking lists when jobs are released. Creates noise for users who haven't set up lineside storage or don't use picking lists. Rejected in favor of user-initiated generation from the picking schedule.

- **BOM-level supply type enum** — Explicit `supplyType` (Pick, Lineside, Backflush) on each BOM component. More flexible but adds a field engineers must manage. Rejected in favor of the derived approach (storage unit lineside flag), which is simpler and reflects physical reality.

- **Goods transfer then separate consumption** — Two-step model where picking creates a transfer to lineside, and consumption happens later during production. More physically accurate but doubles inventory movements and requires operators to do a second consumption step. Rejected for v1 in favor of single-event consumption on pick confirmation. Lineside replenishment (non-job-specific) is already handled by warehouse transfers.

## Risks & Mitigations

- **Backflushing double-count** — If a material is issued via picking AND backflushed, it would be consumed twice. Mitigation: backflushing formula already handles this (`GREATEST(target - quantityIssued, 0)`), but we must verify the actual implementation.
- **Missing source storage unit** — If `jobMaterial.storageUnitId` is null and `pickMethod.defaultShelfId` is not set, the system can't determine where to pick from. Mitigation: show these as "unresolved" in the picking schedule with a warning; require resolution before including in a picking list.
- **Lineside inheritance performance** — Recursive CTE to resolve `workCenterId` through the storage unit tree could be slow for deep hierarchies. Mitigation: storage unit trees are typically shallow (2-4 levels); benchmark and add a materialized/cached column if needed.
- **Tracked entity availability** — FIFO batch determination may propose a batch that's been reserved by another picking list but not yet picked. Mitigation: check existing picking list line allocations when proposing batches.

## Open Questions

- Should a kitter be able to substitute a different tracked entity than the one proposed (e.g., FIFO says Batch A but Batch B is more accessible)? Tentatively yes, with validation that it's the same item at the same storage unit.
- Should the picking schedule be available in both ERP and MES, or only one? Tentatively both, with ERP focused on management (generate, assign) and MES focused on execution (pick, confirm).
- How should "short picks" propagate? If a kitter picks 8 of 10, should the remaining 2 automatically appear on the next picking list generation, or require manual re-generation?
- Should we support splitting a picking list (reassigning some lines to a different kitter mid-execution)?

## Next Step Recommendation

- Proceed to `write-plan` for implementation planning, breaking the work into phases: (1) storage unit lineside flag with inheritance, (2) picking list data model and service layer, (3) ERP picking schedule and generation UI, (4) MES picking execution UI, (5) inventory integration and backflushing verification.
