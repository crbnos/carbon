# Items Module

Master data for all item types (Parts, Materials, Tools, Consumables, Services), bill of materials (make methods), unit of measure management, material taxonomy, item costing, shelf life, configurations, supersessions, pick methods, and item posting groups.

## Key Domain Concepts

- **Item Types** — Parts (manufactured/purchased goods), Materials (raw materials with taxonomy), Tools, Consumables, Services. All share the `item` table; type-specific tables (`part`, `material`, `tool`, `consumable`, `service`) extend it.
- **Make Method** — versioned manufacturing method on an item: BOM (`methodMaterial`) + routing (`methodOperation`). Statuses: Draft/Active/Archived. MUST create a new version instead of editing Active methods.
- **Material Taxonomy** — structured properties via FK relationships: `materialSubstance` (steel, aluminum), `materialForm` (sheet, plate, roundbar), `materialType`, `materialGrade`, `materialFinish`, `materialDimension`. Global rows (`companyId IS NULL`) are system-seeded.
- **Item Tracking Type** — `Inventory` (quantity only), `Serial` (unique per unit), `Batch` (lot-tracked), `Non-Inventory` (not stocked). Drives behavior in inventory, receipts, and picking.
- **Replenishment System** — `Buy`, `Make`, or `Buy and Make`. Drives MRP planning and method availability. `sourcingType` (`Specified`/`Drop Ship`/`Ship from Inventory`) is item-level and cascades to `methodMaterial` rows.
- **Shelf Life** — batch/serial items can have expiry tracking. Modes: Fixed Duration, Calculated, Set on Receipt.
- **Supersession** — item replacement chain for obsolete parts via `itemSupersession`.

## Safety

### Always
- MUST use `upsertMaterial` for material creation — it handles both `item` and `material` table inserts with `readableId` linkage.
- MUST remember: `material.id` = `item.readableId`, NOT `item.id`. Join via `readableId + companyId`.
- MUST use `assertMethodOperationIsDraft` before deleting method operations — Active/Archived methods are protected.
- MUST use `updateItemMethodAndSourcing` when changing `replenishmentSystem`, `defaultMethodType`, or `sourcingType` — it cascades to Draft method materials.

### Ask First
- Deleting items that have inventory, open POs, or active jobs — `item` FK has `ON DELETE RESTRICT` from `trackedEntity`.
- Changing `itemTrackingType` on items that already have tracked entities — use `cascadeItemTrackingType`.
- Modifying Active method versions — create a new version instead.

### Never
- Directly insert `material` rows without corresponding `item` rows.
- Assume `material` has an `itemId` column — it was dropped; linkage is `material.id = item.readableId`.
- Delete global taxonomy rows (`companyId IS NULL`) — they're system-seeded and shared across companies.
- Edit `methodMaterial.sourcingType`/`methodType` per-row — they're derived from the component item. Change sourcing on the item instead.

## Validation Commands

```bash
pnpm --filter @carbon/erp typecheck
pnpm --filter @carbon/erp test
```

## Key Data Model

| Table / View | Purpose |
|---|---|
| `item` | Universal item master: readableId, name, type, tracking, replenishment, UoM |
| `part` / `material` / `tool` / `consumable` / `service` | Type-specific extensions |
| `materialForm` / `materialSubstance` / `materialType` / `materialGrade` / `materialFinish` / `materialDimension` | Material taxonomy (global or company-scoped) |
| `makeMethod` | Versioned manufacturing method header (Draft/Active/Archived) |
| `methodMaterial` / `methodOperation` / `methodOperationStep` / `methodOperationParameter` / `methodOperationTool` | BOM lines, routing steps, and work instruction details |
| `itemCost` / `costLedger` | Standard/average costs and cost history |
| `itemReplenishment` / `itemPlanning` | Manufacturing settings (lot size, lead time, scrap %) and planning params |
| `itemPostingGroup` | Maps item categories to GL accounts |
| `unitOfMeasure` | UoM definitions |
| `configurationParameter` / `configurationRule` / `configurationParameterGroup` | Product configurator |
| `supplierPart` / `supplierPartPrice` | Supplier-item pricing with conversion factors and price breaks |
| `pickMethod` | Default storage unit and pick strategy per item/location |
| `itemShelfLife` | Shelf life tracking configuration per item |
| `itemSupersession` | Item replacement chains |

## Key Service Functions

- `getItem` / `getPart` / `getMaterial` / `getConsumable` / `getTool` — item reads by type (RPCs `get_part_details`, `get_material_details`, etc.)
- `upsertMaterial` — creates/updates material with taxonomy FKs and `item`/`material` linkage
- `getMakeMethods` / `getMethodMaterials` / `getMethodOperations` / `getMethodTreeArray` — BOM/routing reads
- `copyItem` / `copyMakeMethod` — duplicates via edge function
- `createRevision` / `activateMethodVersion` — revision and version management
- `updateItemMethodAndSourcing` — cascades replenishment/sourcing changes to Draft method materials
- `getItemCost` / `getItemQuantities` / `getItemDemand` / `getItemSupply` — cost and planning reads
- `getSupplierParts` / `getSupplierPriceBreaksForItems` / `lookupBuyPrice` — vendor pricing
- `upsertPickMethodWithShelfLife` — pick method with shelf life configuration
- `getConfigurationParameters` / `getConfigurationRules` — product configurator

## Key Exports

```typescript
import { getItem, upsertMaterial, getMakeMethods } from "~/modules/items";
import { itemValidator, itemTrackingTypes, itemReplenishmentSystems } from "~/modules/items";
```

## Related Modules

- **purchasing** — supplier parts pricing; PO lines reference items; `conversionFactor` on `supplierPart`
- **inventory** — quantities tracked per item/location; tracking type drives receipt/picking behavior
- **production** — jobs manufacture items; make methods copied to jobs via `get-method` edge function
- **sales** — quote lines and sales order lines reference items; `itemUnitSalePrice` is base price
- **accounting** — `itemPostingGroup` maps items to GL accounts
- **quality** — `requiresInspection` flag on items; inspection documents reference parts

## Rules References

- `.ai/rules/material-tables.md` — material taxonomy schema, linkage, and the `material.id = item.readableId` gotcha
- `.ai/rules/method-material-sourcing.md` — how methods determine Buy/Make/Pull sourcing and cascade rules
