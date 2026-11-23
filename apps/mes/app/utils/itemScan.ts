// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";
import { pickTravelerMaterial, type TravelerMaterial } from "./traveler";

/**
 * The item id in a scanned ERP item link (`/x/part/<id>`, and the same for a
 * material, tool or consumable). A sticker holds the origin it was printed
 * from, so only the path is compared.
 */
export function parseItemCode(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const match = url.pathname.match(
    /^\/x\/(?:part|material|tool|consumable)\/([^/?#]+)/
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!) || null;
  } catch {
    return null;
  }
}

/** The job material fields an item scan reads. */
export type ItemScanMaterial = TravelerMaterial & {
  itemType: string | null;
  methodType: "Purchase to Order" | "Pull from Inventory" | "Make to Order";
  requiresBatchTracking: boolean;
  requiresSerialTracking: boolean;
};

/**
 * Stock issued by measure (bar, sheet, adhesive), not counted off a shelf:
 * one scan of its sticker issues what the job still needs.
 */
const isMeasuredStock = (material: ItemScanMaterial) =>
  material.itemType === "Material" || material.itemType === "Consumable";

/**
 * What scanned item stickers do at an operation. Each scan of a part or tool
 * is one piece: `pieces` scans issue that many (or the rest, when less is
 * still short) into the first material that is short (this operation's, then
 * one with no operation), so the operator scans once for each piece taken off
 * the shelf. A material or consumable is issued by measure: one scan issues
 * all the job still needs. A sticker names no unit, so a serial part, or a
 * part the job makes, opens the Issue dialog instead.
 */
export function planItemScanIssue<T extends ItemScanMaterial>(
  materials: T[],
  jobOperationId: string,
  pieces = 1
):
  | { kind: "notUsed" }
  | { kind: "full" }
  | { kind: "dialog"; material: T }
  | { kind: "untracked"; material: T; quantity: number }
  | { kind: "batch"; material: T; quantity: number } {
  const picked = pickTravelerMaterial({
    materials,
    jobOperationId,
    itemId: null,
    unitConsumed: null
  });
  if (picked.kind !== "issue") return picked;

  const { material } = picked;
  if (
    material.requiresSerialTracking ||
    material.methodType === "Make to Order"
  ) {
    return { kind: "dialog", material };
  }
  const quantity = isMeasuredStock(material)
    ? picked.needed
    : Math.min(pieces, picked.needed);
  if (material.requiresBatchTracking) {
    return { kind: "batch", material, quantity };
  }
  return { kind: "untracked", material, quantity };
}

/**
 * What the operation requires of a scanned item and has of it, over every
 * material a scan can fill (this operation's, and those with no operation),
 * so the count in the toast does not restart when the item is on two lines.
 */
export function itemScanTotals(
  materials: ItemScanMaterial[],
  jobOperationId: string
): { required: number; issued: number } {
  const eligible = materials.filter(
    (material) =>
      material.jobOperationId === jobOperationId ||
      material.jobOperationId === null
  );
  return {
    required: round(
      eligible.reduce(
        (sum, m) => sum + (m.estimatedQuantity ?? m.quantity ?? 0),
        0
      )
    ),
    issued: round(eligible.reduce((sum, m) => sum + (m.quantityIssued ?? 0), 0))
  };
}
