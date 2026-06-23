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
`sourcingType` and `methodType` are **read-only mirrors** of the referenced
component item (`methodMaterial.itemId`) — they are NOT edited per-row in the
BOM editor. They are derived from two item-level properties:

- `item.defaultMethodType` — enum `methodType`.
- `item.sourcingType` — enum `sourcingType`.

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
  `sourcingType "sourcingType" NOT NULL DEFAULT 'Specified'`, `itemId` (FK→item),
  `makeMethodId` (FK→makeMethod), `materialMakeMethodId` (nullable FK→makeMethod,
  the sub-method for Make-to-Order rows). Base table: `20240619095417_methods.sql`.
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
- The cascade mirrors the item's `sourcingType`/`methodType` onto every
  `methodMaterial` referencing it, **but only where the make method is `Draft`**
  (`makeMethod.status = 'Draft'`); Active/Archived methods are frozen. For
  `Make to Order` rows it resolves `materialMakeMethodId` from the
  `activeMakeMethods` view per item (null if none).
- `upsertMethodMaterial` (~L3439) **re-derives** `methodType`/`sourcingType` from
  the component item (`item.defaultMethodType ?? methodType`, `item.sourcingType`)
  — the submitted form values are advisory/display-only.
- `getMethodMaterialsByMakeMethod` (~L1321) selects
  `item(name, itemTrackingType, replenishmentSystem, defaultMethodType, sourcingType)`.

## BOM editor display (read-only)

`apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx`:
- Sourcing section (~L859) is gated on the **component** item's replenishment
  (`itemData.itemReplenishmentSystem === "Buy and Make"`), not the parent's, and
  renders the `sourcingType` `<Select isReadOnly>`.
- Method Type section (~L922) shows a read-only `<DefaultMethodType isReadOnly>`;
  label is "Finish To" when `methodType === "Make to Order"`, else "Pull From".
- Values are submitted via hidden inputs only to satisfy `methodMaterialValidator`;
  `upsertMethodMaterial` re-derives them, so they are not the source of truth.

## Gotchas

- Don't treat BOM-submitted `sourcingType`/`methodType` as authoritative — the
  service overwrites them from the item. Change sourcing on the item, not the row.
- Cascade only touches Draft make methods. Editing an item's sourcing won't
  retro-update materials on Active/Archived methods.
- `methodType` enum values were `Buy`/`Pick`/`Make` before migration
  `20260321143847`; older migrations referencing those are pre-rename.
