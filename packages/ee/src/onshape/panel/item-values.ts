// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Copies of the item enums (packages/database, apps/erp shared.models). A leaf
// module: plan.ts imports standard-fields.ts, so they cannot live in plan.ts.

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
 * A copy of `validMethodTypesByReplenishment` (apps/erp shared.models):
 * @carbon/ee cannot import the app.
 */
export const VALID_METHOD_TYPES_BY_REPLENISHMENT: Record<
  ItemReplenishmentSystem,
  readonly ItemMethodType[]
> = {
  Buy: ["Pull from Inventory", "Purchase to Order"],
  Make: ["Pull from Inventory", "Make to Order"],
  "Buy and Make": ["Pull from Inventory", "Purchase to Order"]
};
