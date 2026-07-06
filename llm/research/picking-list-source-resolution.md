# Picking-List Source Resolution Research

## Question

When a picking-list line is for a "lineside" item, but the operation's assigned
work center has **no lineside bin** for it (the item's lineside stock lives at a
*different* work center), what should the pick be **sourced from**?

Concrete case (dev data): J000005 "Assemble" op is assigned to **Assembly 3**.
Material "Purchased - Lineside" (P000000001) has `jobMaterial.storageUnitId = A2`,
which belongs to **Assembly 2**. Assembly 3 has no lineside bin for it.

## How Carbon models this today (code-grounded)

### "Lineside" is a property of the BIN, not the item
- A `storageUnit` is lineside iff it has a non-null `workCenterId` (or inherits one
  via its `parentId` chain — `get_effective_work_center_id`, migration
  `20260601143527_picking-lists.sql:264`).
- There is **no item-level "lineside" flag**. Whether item Y is "lineside at work
  center X" is emergent: a bin with `workCenterId = X` exists AND has on-hand of Y.
- `isWorkCenterDefault` marks the single system-managed canonical lineside bin per
  work center.

### Source/consume resolution chain (identical everywhere)
`jobMaterial.storageUnitId` → (if `jobMaterial.defaultStorageUnit = true`)
`pickMethod.defaultStorageUnitId` (per item+location) → highest `itemLedger`
on-hand at the location → `null`.
- Set eagerly at BOM explosion (`get-method` → `lib/storage-units.ts:getStorageUnitId`).
- Re-resolved at consume time in `issue` `partToOperation`
  (`functions/issue/index.ts:1334`) and `backflush_job_materials`
  (`20260511120000_backflush-job-materials.sql:80`).
- `getStorageUnitWithHighestQuantity` does NOT distinguish warehouse vs lineside —
  it just picks the bin with the most on-hand.

### How stock reaches a lineside bin
Only three mechanisms write `itemLedger.storageUnitId = <lineside bin>`:
1. A posted **stock transfer** (`post-stock-transfer`, signed ledger pair).
2. A **picking-list pick** (modeled as a warehouse→lineside transfer — `post-picking`).
3. A **receipt / job completion** that names the bin (incl. kanban supply orders).

- **Kanban** does NOT move inventory itself. It creates a make/buy supply order
  (`api+/kanban.$id.tsx`) whose eventual receipt lands at `kanban.storageUnitId`.
- **No per-bin min/max.** Replenishment policy is per **item+location** in
  `itemPlanning` (reorderPoint/reorderQuantity/maxInventory). A lineside bin has no
  independent reorder logic.

### The current picking generator
`generatePickingList` (`inventory.service.ts:2463`):
- Source = `mat.storageUnitId` (no fallback; **null source** if the jobMaterial has
  no bin).
- Destination = `get_or_create_work_center_lineside(op's work center)`.
- **Skips** any material whose storage unit resolves to ANY work center
  (`get_effective_work_center_id` truthy → `continue`).

**Two bugs this surfaces:**
1. **Inclusion**: the skip is "lineside *anywhere*", not "lineside at *this op's*
   work center". So "Purchased - Lineside" (lineside at Assembly 2) is skipped even
   though the op runs at Assembly 3.
2. **Source**: if we simply un-skip it, the source would be `mat.storageUnitId = A2`
   — i.e. we'd transfer FROM Assembly 2's line. That's the "raid another line"
   anti-pattern (see below).

## Competitor best practice (SAP S/4HANA, Epicor Kinetic)

- **Source resolution is a work-center-aware hierarchy**, not one field:
  SAP `operation → work center → Production Supply Area → storage location → part
  default → plant warehouse`; Epicor `resource/resource-group input bin → part-plant
  default → warehouse primary/first bin with qty`.
- **Replenishment ≠ picking** — both systems sharply separate "keep the line topped
  up" (kanban/min-max/control cycle) from "stage what THIS order needs" (pick part /
  order-specific issue).
- **Cross-line answer (consensus):** pull from the **central warehouse** (replenish
  the demand line), **never silently consume another line's dedicated stock**. Each
  line's location is structurally kept out of the other's resolution path. A
  transfer from another line is only a **manual, flagged exception** (shortage /
  expedite).

Recommended order (mirrors both systems):
1. Op's work center lineside (if it stocks the part w/ qty) → no pick needed.
2. If line-stocked there but short → replenish from warehouse, then consume.
3. If NOT line-stocked there → order-specific pick/stage **from the warehouse**.
4. Warehouse default issue location.
5. Transfer from another line → manual exception only.

## Recommendation for Carbon

1. **Inclusion fix (both `get_picking_schedule` and `generatePickingList`):** skip a
   material only if its effective work center **equals the operation's assigned work
   center**. Otherwise include it. (Matches the user's instinct; fixes J000005.)

2. **Source fix:** when including such a material, do NOT use its lineside bin as the
   source. Resolve a **warehouse (non-lineside) source** by on-hand — highest on-hand
   among bins with **no** effective work center (and/or `pickMethod.defaultStorageUnitId`
   if it's non-lineside). Machinery exists: `getItemStorageUnitQuantities`,
   `get_effective_work_center_id`.

3. **No warehouse stock = visible shortage**, not a silent raid of another line.
   Leave the source null / zero-available so the planner/kitter sees it. (Optionally,
   a later manual "transfer from <other line>" override.)

4. Destination stays the op's work center lineside (already implemented).

### Policy decision (DECIDED 2026-06-14)
When the ONLY on-hand is at another line's lineside (no warehouse stock): **surface
a shortage.** Source from warehouse (non-lineside) on-hand only; if none exists, the
line has no source (visible shortage) for a planner/kitter to resolve — never
auto-pull from another line. (Matches SAP/Epicor best practice.)

## IMPLEMENTED (2026-06-14) — on-hand-based inclusion

Both the generator and the schedule keyed inclusion off the WRONG signal:
`jobMaterial.storageUnitId`'s effective work center. That field is a single
*source* shelf; it answers "where is this material's stock recorded" — NOT
"is the part already staged at the op's work center." When the jobMaterial
points at the warehouse (or another line), a part that is fully line-stocked at
the op's own work center still got added as a (redundant) pick.

**Concrete miss — PL000015 / Assembly 2 (P000000001 "Purchased - Lineside"):**
the A2 lineside bin held 9 on-hand and the op needed 2, yet a pick was generated
sourcing from warehouse `13-A-5` (1 on-hand). At generation time the jobMaterial
pointed at the warehouse shelf, not the A2 bin (it was repointed to A2 ~1 min
later), so the old `effective_wc === op_wc` skip never fired.

**Fix:** decide inclusion by ACTUAL on-hand at the op's work-center lineside bin.
- `generatePickingList` (`inventory.service.ts`): resolve the lineside bin first,
  fetch per-bin on-hand once (`getItemOnHandByStorageUnit`), and
  `continue` when `linesideOnHand >= quantityToIssue`. The same on-hand map feeds
  `resolveWarehouseSource`.
- `get_picking_schedule` (`20260601143527_picking-lists.sql`): dropped the
  `su_walk`/`su_effective` recursive CTEs; the `picks` CTE now LATERAL-joins the
  op's lineside bin (default first, else oldest — mirrors
  `get_or_create_work_center_lineside`) and its `itemLedger` on-hand, including a
  material only when `wcl IS NULL OR staged.qty < quantityToIssue`.

Verified on dev data: Assembly 2 P000000001 (9≥2) excluded; Assembly 3 P000000002
(1<2) still included. Not yet handled: partial-replenish picks the FULL
`quantityToIssue` rather than only the shortfall when a bin is partially stocked.

## Sources
- Carbon codebase (file:line cited inline above).
- SAP Help: Storage Location/Supply Area Determination; Control Cycle; Pick Part;
  Stock Determination. SAP Learning: Production Supply Process; KANBAN.
- Epicor Help: Material Backflush Hierarchy for Labor Entry. EpiUsers threads on
  issue default warehouse/bin.
