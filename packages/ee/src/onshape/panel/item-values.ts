// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The item enums the panel writes, and the interlock between two of them. A
 * leaf module: `standard-fields.ts` and `plan.ts` both read it, and neither
 * may import the other's values.
 */

// Enum literals from packages/database (item.replenishmentSystem,
// item.defaultMethodType, item.itemTrackingType). Item type stays "Part":
// other types are created through other services and tables.
export const ITEM_REPLENISHMENT_SYSTEMS = [
  "Buy",
  "Make",
  "Buy and Make"
] as const;
export const ITEM_METHOD_TYPES = [
  "Make to Order",
  "Pull from Inventory",
  "Purchase to Order"
] as const;
export const ITEM_TRACKING_TYPES = [
  "Inventory",
  "Non-Inventory",
  "Serial",
  "Batch"
] as const;
// item.sourcingType (apps/erp shared.models `sourcingType`).
export const ITEM_SOURCING_TYPES = [
  "Specified",
  "Drop Ship",
  "Ship from Inventory"
] as const;

export type ItemReplenishmentSystem =
  (typeof ITEM_REPLENISHMENT_SYSTEMS)[number];
export type ItemMethodType = (typeof ITEM_METHOD_TYPES)[number];
export type ItemTrackingType = (typeof ITEM_TRACKING_TYPES)[number];
export type ItemSourcingType = (typeof ITEM_SOURCING_TYPES)[number];

/**
 * The ERP's interlock between replenishment and default method
 * (`validMethodTypesByReplenishment` in apps/erp shared.models — duplicated
 * here because @carbon/ee cannot import the app). A plan never proposes, and
 * apply never accepts, a pair the Part form itself would refuse.
 */
export const VALID_METHOD_TYPES_BY_REPLENISHMENT: Record<
  ItemReplenishmentSystem,
  readonly ItemMethodType[]
> = {
  Buy: ["Pull from Inventory", "Purchase to Order"],
  Make: ["Pull from Inventory", "Make to Order"],
  "Buy and Make": ["Pull from Inventory", "Purchase to Order"]
};
