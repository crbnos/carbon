# Method Material Sourcing & Method Type (item-level)

`methodMaterial.sourcingType` and `methodMaterial.methodType` are **read-only
mirrors** of the component item they reference (`methodMaterial.itemId`). They
are NOT edited per-row in the Bill of Material editor. Instead they come from
item-level properties:

- `item.defaultMethodType` (enum `methodType`: `Purchase to Order` /
  `Pull from Inventory` / `Make to Order`)
- `item.sourcingType` (enum `sourcingType`: `Specified` / `Drop Ship` /
  `Ship from Inventory`) — added in migration `20260615143722_item-sourcing-type.sql`.

Both DB and UI method-type enums match (no translation). Enums live in
`apps/erp/app/modules/shared/shared.models.ts`; types `MethodType` /
`SourcingType` in `apps/erp/app/modules/shared/types.ts`.

## Where it's edited
- Part: `apps/erp/app/modules/items/ui/Parts/PartProperties.tsx` — "Default
  Method Type" select; "Sourcing" select shown only when
  `replenishmentSystem === "Buy and Make"`.
- Tool: `apps/erp/app/modules/items/ui/Tools/ToolProperties.tsx` — same.
- Both submit via `onUpdate(field, value)` → `path.to.bulkUpdateItems`
  (`apps/erp/app/routes/x+/items+/update.tsx`).

## Sourcing → method type mapping
Applied server-side in `update.tsx` (`sourcingType` case) and historically in
the BOM UI: `Drop Ship` → `Purchase to Order`, `Ship from Inventory` →
`Pull from Inventory`, `Specified` → leave method type as-is.

## Sync / cascade
- New/edited method materials derive both fields from the item in
  `upsertMethodMaterial` (`items.service.ts` ~3300) — form values are advisory.
- `cascadeItemSourcingAndMethodType` (`items.service.ts`, modeled on
  `cascadeItemTrackingType`) updates all `methodMaterial` rows referencing the
  changed item when sourcing/method type changes at the item level. Scoped to
  **Draft** make methods only (`makeMethod.status = 'Draft'`); Active/Archived
  are frozen. Make-to-Order rows get `materialMakeMethodId` resolved per item
  from `activeMakeMethods` (null if none). Wired into the `defaultMethodType`
  and `sourcingType` cases of `update.tsx`.

## BOM editor display
`apps/erp/app/modules/items/ui/Item/BillOfMaterial.tsx`: Sourcing section +
Method Type ("Pull From"/"Finish To") render read-only (`isReadOnly`), still
submitting via hidden inputs. The Sourcing section is gated on the **component**
item's replenishment (`itemData.itemReplenishmentSystem === "Buy and Make"`),
not the parent's. `getMethodMaterialsByMakeMethod` selects
`item(... defaultMethodType, sourcingType)`.

## RPC note
`item.sourcingType` is surfaced to the Part/Tool detail loaders by recreating
`get_part_details` / `get_tool_details` (RETURNS TABLE + SELECT) in the same
migration. `PartSummary`/`ToolSummary` types derive from these RPCs, so they
pick up `sourcingType` after `db:types` regen.
