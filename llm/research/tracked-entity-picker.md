# Shared Tracked-Entity Picker + Smart Pick Ordering

Design agreed via brainstorm (2026-06-14). A reusable Scan/Select component for
serial/batch tracked entities, with FIFO/FEFO/LIFO "smart ordering" guidance,
adopted across all tracked-scanning surfaces at once.

## Goal

Give pickers/operators guidance on **which tracked lot to take first** (by
human-readable `readableId`), especially for perishables (FEFO). Scanner stays
the primary input; the ordered Select list is assisted guidance.

## Converged decisions

1. **All surfaces at once** (not picking-first). One shared component + one
   smart-ordered data source; every list-based surface benefits.
2. **Bin scope is per-surface, driven by what the action does:**
   - **Picking (ERP *and* MES picking execution)** = warehouse→lineside transfer,
     so source must be **non-lineside only**. Picking a lineside lot is
     meaningless (the destination *is* the lineside).
   - **Issue/consumption (MES issue material, maintenance add-part)** = pull from
     where the part sits (usually lineside) → **all available, lineside included**.
   - **Stock transfer, shipments** = generic → **all available**.
   - Implemented as a prop, e.g. `excludeLineside: boolean`, backed by the
     bin-aware source (knows each lot's bin via `storageUnit.workCenterId` /
     `get_effective_work_center_id`).
3. **Scanner primary; Select = guidance.** Tabs Scan (default) + Select. The
   Select tab orders lots and lets you pick from it; the scan/text input remains
   the primary day-to-day path.
4. **Smart ordering default** = FEFO (`trackedEntity.expirationDate` asc) when any
   candidate has an expiry, else FIFO (`trackedEntity.createdAt` asc). Dropdown to
   switch: Expiring first (FEFO) · Oldest first (FIFO) · Newest first (LIFO).
   FIFO/LIFO sort by **lot age (`createdAt`)**, not bin-arrival. Remember last
   choice (localStorage).
5. **No double-recommendation.** Select list shows **available − already-allocated**:
   on-hand from `get_item_quantities_by_tracking_id` (filtered per scope) minus
   `SUM(pickingListLineTrackedEntity.quantity)` over **non-cancelled** lists/lines
   (mirror the `get_picking_schedule` `NOT EXISTS ... pl.status <> 'Cancelled'`
   pattern). Note: picking keeps entities `Available` and *moves* qty to lineside,
   so we must exclude by bin + allocation, not by status.
6. **readableId surfaced first** (tracking ids are opaque); meta line = qty ·
   expiry (color-coded) · bin · received date.
7. **Expiry**: color-code near-expiry (`nearExpiryWarningDays`) / expired; honor
   `companySettings.inventoryShelfLife.expiredEntityPolicy`
   (Warn / Block / BlockWithOverride + reason), reusing the existing override
   mechanism. FEFO ordering on by default everywhere, even where policy is unset.
8. **Post-agnostic component.** Emits selection `[{ trackedEntityId, quantity }]`
   via `onConfirm`; each host wires its own action/edge-function (picking →
   `post-picking` serial/batch; transfer → `post-stock-transfer`; issue → `issue`;
   etc.). Do not bake posting into the component.
9. **Smart ordering pushed into the data layer** — add ordering to the (currently
   duplicated, unordered) `getSerialNumbersForItem` / `getBatchNumbersForItem`
   (ERP + MES) and/or the bin-aware source, so all consumers improve at once.

## Reference implementations
- **Template (clean, generic):** `apps/mes/.../SerialSelectorModal.tsx`
  (`availableEntities` prop + `onSelect` callback, Scan/Select tabs, no coupling).
- **Feature-complete (coupled):** `apps/mes/.../IssueMaterialModal.tsx` (batch
  qty + auto-split, expiry policy + override). Lift its qty/split + expiry logic
  into the shared component; drop its job-issue coupling.

## Component config (the per-surface knobs)
`itemId` · `excludeLineside` · `trackingType` (serial=qty1 / batch=qty+split) ·
`multiple` (N rows vs single) · `expiredEntityPolicy?` · `locationId` ·
entity source (bin-aware loader) · `onConfirm(selection)`.

## Surface adoption map
| Surface | Scope | Notes |
|---|---|---|
| ERP picking (`PickingListLines`) | non-lineside | fills disabled Scan btn; posts `post-picking` |
| MES picking (`picking.$pickingListId`) | non-lineside | same |
| MES issue material (`IssueMaterialModal`) | all available | retrofit onto shared picker |
| Maintenance add-part (ERP+MES) | all available | converge off direct queries |
| Stock transfer (`$id.scan.$lineId`) | all available | add Select tab to scan-only modal |
| Shipments | all available | inline → shared picker (optional) |
| Inbound inspection (QA) | n/a (pre-fetched lot) | could adopt for consistency |

**Outliers (stay separate):** Receipts (mint new serials/batches, not select);
Quality issue split/move; MES adjust inventory (excludes tracked).

## Data layer
- **Bin-aware source** (picking, transfer): `get_item_quantities_by_tracking_id`
  (item, location) → per (storageUnit, trackedEntity, qty, readableId); join
  `trackedEntity` for `createdAt`/`expirationDate`/`status`; filter by scope
  (exclude lineside via `workCenterId`); net against allocations; order by
  strategy. Likely a new RPC/service: `get_available_tracked_entities(item,
  location, exclude_lineside, exclude_allocated)`.
- **Item-scoped source** (issue/shipment, all-available): the unified, now-ordered
  `getSerial/BatchNumbersForItem`.

## Build plan (all surfaces at once)
1. **Data**: unify + order `getSerial/BatchNumbersForItem` (ERP+MES); add the
   bin-aware available-and-unallocated source (RPC + service) with scope + ordering.
2. **Component**: shared `TrackedEntityPicker` (Scan + Select tabs, smart-order
   dropdown, qty/split for batch, expiry policy/override, post-agnostic onConfirm).
3. **Picking**: wire into ERP + MES picking (non-lineside); add the tracked
   pick action/edge path (`post-picking` serial/batch) — delivers the deferred
   tracked-pick flow.
4. **Stock transfer**: add Select tab (all available) to the scan modal.
5. **MES issue material + maintenance**: retrofit onto the shared component.
6. (Optional) shipments, inbound inspection.
7. Verify dedup, FEFO/FIFO ordering, expiry block/override, negative-allowed
   picking still works.
