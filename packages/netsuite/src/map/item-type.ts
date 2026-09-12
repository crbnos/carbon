import type {
  CarbonItemTrackingType,
  CarbonItemType,
  CarbonMethodType,
  CarbonReplenishmentSystem
} from "../plan.ts";

/**
 * NetSuite's item taxonomy → Carbon's six item types.
 *
 * This is a lossy mapping and the losses are deliberate. NetSuite distinguishes
 * items by how they POST (inventory vs non-inventory, sale vs purchase vs
 * resale); Carbon distinguishes them by what they ARE on a shop floor (a part, a
 * material, a tool). Nothing NetSuite stores says whether a given inventory part
 * is bar stock or a finished component, so Carbon's Material and Tool types are
 * never chosen automatically — re-typing an item in Carbon is a one-click edit,
 * whereas a wrong guess is invisible.
 */

export type ItemTypeMapping = {
  type: CarbonItemType;
  itemTrackingType: CarbonItemTrackingType;
  replenishmentSystem: CarbonReplenishmentSystem;
  defaultMethodType: CarbonMethodType;
};

/** NetSuite item types that carry no Carbon counterpart and are skipped. */
export const UNMIGRATABLE_ITEM_TYPES = new Set([
  // A sales bundle that ships as its components — Carbon models this as a part
  // with a bill of materials, which is a different record, not a rename.
  "Kit",
  "Group",
  // Transaction-line devices, not things: they exist to alter an order's
  // arithmetic and become comment lines when an order carries them.
  "Discount",
  "Markup",
  "Payment",
  "Subtotal",
  "Description",
  // Sold as a balance, not stocked.
  "GiftCert",
  "DwnLdItem"
]);

/**
 * How an item is tracked, from NetSuite's lot/serial flags.
 *
 * The flags are authoritative even when the item type string does not say so —
 * a `lotNumberedInventoryItem` reports `itemtype = 'InvtPart'` with
 * `islotitem = 'T'`.
 */
function trackingFor(
  isLot: boolean,
  isSerial: boolean,
  stocked: boolean
): CarbonItemTrackingType {
  if (!stocked) return "Non-Inventory";
  if (isSerial) return "Serial";
  if (isLot) return "Batch";
  return "Inventory";
}

export function mapItemType(
  netsuiteItemType: string,
  flags: { isLot: boolean; isSerial: boolean }
): ItemTypeMapping | null {
  const type = netsuiteItemType.trim();
  if (UNMIGRATABLE_ITEM_TYPES.has(type)) return null;

  switch (type) {
    case "InvtPart":
      return {
        type: "Part",
        itemTrackingType: trackingFor(flags.isLot, flags.isSerial, true),
        replenishmentSystem: "Buy",
        defaultMethodType: "Purchase to Order"
      };
    case "Assembly":
      return {
        type: "Part",
        itemTrackingType: trackingFor(flags.isLot, flags.isSerial, true),
        replenishmentSystem: "Make",
        defaultMethodType: "Make to Order"
      };
    case "NonInvtPart":
      return {
        type: "Consumable",
        itemTrackingType: "Non-Inventory",
        replenishmentSystem: "Buy",
        defaultMethodType: "Purchase to Order"
      };
    case "Service":
    case "OthCharge":
      return {
        type: "Service",
        itemTrackingType: "Non-Inventory",
        replenishmentSystem: "Buy",
        defaultMethodType: "Purchase to Order"
      };
    default:
      // An item type this mapping has never seen. Treated as unmigratable
      // rather than guessed onto Part: a wrong item type propagates into every
      // BOM and order line that references it.
      return null;
  }
}
