---
description: How a manufacturing method's materials are defined and how sourcing (make vs buy / supplier) is determined, item-level vs per-row.
paths:
  - "apps/erp/app/modules/items/items.service.ts"
  - "apps/erp/app/routes/x+/items+/update.tsx"
  - "apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx"
  - "packages/database/supabase/migrations/**"
---

# Method Material Sourcing & Method Type (item-level)

A `methodMaterial` is a component line on a make method's bill of material. Its
`sourcingType`, `methodType`, `replenishmentSystem`, and `itemTrackingType` are
**editable per BoM line**, each defaulting to (inherited from) the referenced
component item (`methodMaterial.itemId`) but overridable on the line. The
item-level defaults they inherit from:

- `item.defaultMethodType` — enum `methodType`.
- `item.sourcingType` — enum `sourcingType`.
- `item.replenishmentSystem` — enum `itemReplenishmentSystem`.
- `item.itemTrackingType` — enum `itemTrackingType`.

**Stickiness via override flags.** Four booleans on `methodMaterial` —
`methodTypeOverridden`, `sourcingTypeOverridden`, `replenishmentSystemOverridden`
(added with the new `replenishmentSystem` column in
`20260721164847_method-material-line-overrides.sql`), and
`itemTrackingTypeOverridden` (added with `itemTrackingType` in
`20260722101224_method-material-tracking-type-override.sql`), all default
`false` — mark which fields the user deliberately edited. A set flag gates the
field out of **both** the item→line cascade and the `upsertMethodMaterial`
re-derive, so a per-line edit is never re-stomped when the item default later
changes. The effective columns stay `NOT NULL` and are still exactly what
`get_method_tree`/MRP read — this change does **not** touch the MRP engine; per-line
replenishment takes effect through its interlocked `methodType` (see
`deriveItemMethodUpdate`).

**Per-line tracking type (Inventory vs Non-Inventory).** Unlike the other three,
`itemTrackingType` has real downstream effect at **job consumption**: the tree
carries the per-line value as a new `get_method_tree` field `materialTrackingType`
(`methodMaterial.itemTrackingType`; the existing `itemTrackingType` output stays
item-sourced for Serial/Batch derivation). The `get-method` edge function
snapshots it onto `jobMaterial.itemTrackingType`, and **both** consumption paths
read that snapshot — the `issue` edge function and the SQL
`backflush_job_materials` (job completion, `20260723090109`) — so a line flipped
to `Non-Inventory` is consumed with **no** stock ledger entry, no costLedger
consumption, and no WIP journal, while `quantityIssued` still updates.
`generatePickingList` applies the same effective-tracking filter (snapshot ??
item), so Non-Inventory lines are never picked to lineside. Production-demand
rollups (`get_inventory_quantities.quantityOnProductionDemand`, MRP's
`openJobMaterialLines`) do NOT filter by tracking type — a deliberate open
question, since a Non-Inventory consumption still needs procurement. The per-line override is **restricted to Inventory ↔ Non-Inventory**;
for Serial/Batch items the effective column mirrors the item and the flag stays
`false` (the BoM editor hides the control), so tracked-entity handling
(`requiresSerial/BatchTracking`, still item-sourced) is unaffected. Receipt and
shipment are **not** BoM-line driven, so they keep reading `item.itemTrackingType`.
The override also survives the **quote hop**: `quoteMaterial.itemTrackingType`
(nullable snapshot, `20260723084405`) is filled by `itemToQuoteLine`/
`itemToQuoteMakeMethod` from the tree, surfaced by
`get_quote_methods_by_method_id` as `materialTrackingType`
(`20260723084726`), and `quoteLineToJob` prefers it (`?? item live`) when
writing `jobMaterial.itemTrackingType`; quote→quote copies carry the snapshot
verbatim (null = inherit).

## Enums (DB + UI in sync, no translation)

- `methodType`: `Purchase to Order`, `Pull from Inventory`, `Make to Order`.
  Created (renamed from old `Buy`/`Pick`/`Make`) in
  `20260321143847_method-type-migration.sql`.
- `sourcingType`: `Specified`, `Drop Ship`, `Ship from Inventory`.
  Enum + the `methodMaterial.sourcingType` column added in
  `20260321230229_sourcing-types.sql`. The `item.sourcingType` column (and
  `get_part_details` / `get_tool_details` RPC recreations that surface it) were
  added later in `20260615143722_item-sourcing-type.sql`.

Zod enums live in `apps/erp/app/modules/shared/shared.models.ts` (~L149-159);
types `MethodType` / `SourcingType` in `apps/erp/app/modules/shared/types.ts`
(~L95-96).

## Schema (verified)

- `methodMaterial` cols: `methodType "methodType" NOT NULL DEFAULT 'Pull from Inventory'`,
  `sourcingType "sourcingType" NOT NULL DEFAULT 'Specified'`,
  `replenishmentSystem "itemReplenishmentSystem" NOT NULL DEFAULT 'Buy'`,
  `methodTypeOverridden`/`sourcingTypeOverridden`/`replenishmentSystemOverridden`
  `BOOLEAN NOT NULL DEFAULT false` (all four from
  `20260721164847_method-material-line-overrides.sql`);
  `itemTrackingType "itemTrackingType" NOT NULL DEFAULT 'Inventory'` +
  `itemTrackingTypeOverridden BOOLEAN NOT NULL DEFAULT false` (from
  `20260722101224_method-material-tracking-type-override.sql`); `itemId` (FK→item),
  `makeMethodId` (FK→makeMethod), `materialMakeMethodId` (nullable FK→makeMethod,
  the sub-method for Make-to-Order rows). Base table: `20240619095417_methods.sql`.
- `jobMaterial.itemTrackingType "itemTrackingType"` (nullable snapshot, from
  `20260722101327_jobmaterial-tracking-type-and-method-tree.sql`) — populated by
  `get-method` from the tree's `materialTrackingType`; `NULL` legacy rows fall back
  to `item.itemTrackingType` in the `issue` function.
- `item` cols: `defaultMethodType "methodType" NOT NULL DEFAULT 'Pull from Inventory'`,
  `sourcingType "sourcingType" NOT NULL DEFAULT 'Specified'`.
- `makeMethod.status` enum `makeMethodStatus`: `Draft`, `Active`, `Archived`
  (`20250603011801_make-method-version.sql`).

## Where item-level fields are edited

- Part: `apps/erp/app/modules/items/ui/Parts/PartProperties.tsx` — "Default
  Method Type" `<Select>` + `<SourcingTypeProperty />`.
- Tool: `apps/erp/app/modules/items/ui/Tools/ToolProperties.tsx` — same.
- The Sourcing control (`SourcingTypeProperty.tsx`) renders `null` unless
  `replenishmentSystem === "Buy and Make"`.
- Both submit via `onUpdate(field, value)` → `fetcher.submit(..., { action: path.to.bulkUpdateItems })`.

## Server-side update + sourcing → method-type mapping

Route `apps/erp/app/routes/x+/items+/update.tsx`. The interlocked fields
`replenishmentSystem`, `defaultMethodType`, `sourcingType` are derived by
`deriveItemMethodUpdate(field, value)` then applied by
`updateItemMethodAndSourcing` (one transaction: item write + cascade).

Sourcing drives method type (`sourcingType` case, ~L73-89):
- `Drop Ship` → `Purchase to Order`
- `Ship from Inventory` → `Pull from Inventory`
- `Specified` → leave `defaultMethodType` as-is

(`itemTrackingType` is a separate case that cascades via `cascadeItemTrackingType`.)

## Cascade + derivation (items.service.ts)

- `updateItemMethodAndSourcing(db, args)` (~L2745) — writes `item` then calls the
  internal helper `cascadeSourcingAndMethodTypeToMethodMaterials(trx, args)`
  (~L2790, not exported) inside one Kysely transaction.
  <!-- The old cache name `cascadeItemSourcingAndMethodType` does NOT exist;
       it was renamed to this pair. It is modeled on `cascadeItemTrackingType`. -->
- The cascade mirrors the item's `sourcingType`/`methodType`/`replenishmentSystem`
  onto `methodMaterial` rows referencing it via **up to three field-targeted
  UPDATEs**, each guarded by `<field>Overridden = false` so overridden lines keep
  their value, and **all three restricted to Draft methods**: they are an
  interlocked set (`deriveItemMethodUpdate` pins `methodType` from the other
  two), so updating one on a frozen method would create pairs
  `getValidMethodTypes` forbids. **`itemTrackingType` is the exception**
  (`cascadeItemTrackingType`): no interlock and a real ledger pipeline, so it
  updates non-overridden lines on ALL method statuses — pre-override the issue
  function read the live item, and an Active-method line that didn't follow
  would make future jobs snapshot a stale value. For `Make to Order` rows the
  `methodType` update resolves `materialMakeMethodId` from the
  `activeMakeMethods` view per item (null if none). The new
  `replenishmentSystem` is threaded from `args.itemUpdate.replenishmentSystem`.
- `upsertMethodMaterial` re-derives `methodType`/`sourcingType`/`replenishmentSystem`
  from the component item **only when the matching `*Overridden` flag is false**;
  an overridden field keeps the submitted value. Effective columns are always
  written a concrete value.
- **INSERT-time inheritance is DB-owned**: the `methodMaterialInheritItemDefaults`
  BEFORE INSERT trigger (`20260723083311_method-material-inherit-item-defaults.sql`)
  fills any unflagged `sourcingType`/`replenishmentSystem`/`itemTrackingType` from
  the component item, so writers that insert with explicit column lists (get-method
  job→item / quote→item copy-backs, import-csv) can't leave stale DB defaults.
  `methodType` is deliberately NOT trigger-managed — on copy-backs it encodes tree
  structure (Make to Order ↔ `materialMakeMethodId`), so it stays writer-owned.
  UPDATEs are untouched (upsert re-derive + guarded cascades own those).
- `getMethodMaterialsByMakeMethod` selects `*` plus
  `item(name, itemTrackingType, replenishmentSystem, defaultMethodType, sourcingType)`
  — so each row carries its own per-line values **and** the item defaults (the
  latter power the BoM editor's "Reset to item default").

## BOM editor (editable per line)

`apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx`:
- The Sourcing card is **always shown** (no longer gated on `Buy and Make`) and
  holds two editable `SelectControlled`s: `replenishmentSystem` and `sourcingType`.
  The Method Type card holds an editable `DefaultMethodType` (options restricted to
  `getValidMethodTypes(itemData.replenishmentSystem)`); label is "Finish To" when
  `methodType === "Make to Order"`, else "Pull From".
- Editing a field sets its `*Overridden` flag in local state and applies the shared
  `deriveItemMethodUpdate` interlock (e.g. Sourcing `Ship from Inventory` pins
  `methodType` `Pull from Inventory`, and a pinned methodType is itself marked
  overridden). Each overridden field shows a **"Reset to item default"** link that
  restores the item's value and clears the flag.
- The three selects submit the effective value; the flags submit as `*Overridden`
  hidden inputs with value `"on"` when set / omitted otherwise (to match
  `zfd.checkbox()` in `methodMaterialValidator`). Selecting a new component item
  resets all three flags to false (fresh inherit).

## Gotchas

- BOM-submitted `sourcingType`/`methodType`/`replenishmentSystem` **are**
  authoritative for a line whose matching `*Overridden` flag is set — the service
  no longer unconditionally overwrites them from the item. A non-overridden field
  still inherits/cascades from the item.
- The override hidden inputs must submit `"on"` (not `"true"`) — `zfd.checkbox()`
  uses `trueValue = "on"`, so `"true"` would fail the union parse and reject the save.
- Cascade only touches Draft make methods, and only **non-overridden** lines.
  Editing an item's default won't retro-update Active/Archived methods or lines the
  user overrode.
- Per-line `replenishmentSystem`/`sourcingType` reach jobs/quotes only through the
  interlocked `methodType` (which `get-method` copies to `jobMaterial`/`quoteMaterial`);
  those tables have no `replenishmentSystem`/`sourcingType` columns. MRP and
  `get_method_tree` are unchanged.
- `methodType` enum values were `Buy`/`Pick`/`Make` before migration
  `20260321143847`; older migrations referencing those are pre-rename.
