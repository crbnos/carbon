// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  jobMaterialShortfall,
  pickTravelerMaterial,
  type TravelerMaterial
} from "./traveler";

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
  methodType: "Purchase to Order" | "Pull from Inventory" | "Make to Order";
  requiresBatchTracking: boolean;
  requiresSerialTracking: boolean;
};

/**
 * What a scanned item sticker does at an operation. It issues everything the
 * job still needs of the item into the first material that is short (this
 * operation's, then one with no operation). A sticker names no unit, so a
 * serial part, or a part the job makes, opens the Issue dialog instead.
 */
export function planItemScanIssue<T extends ItemScanMaterial>(
  materials: T[],
  jobOperationId: string
):
  | { kind: "notUsed" }
  | { kind: "full" }
  | { kind: "dialog"; material: T }
  | { kind: "untracked"; material: T; required: number }
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
  if (material.requiresBatchTracking) {
    return {
      kind: "batch",
      material,
      quantity: jobMaterialShortfall(material)
    };
  }
  return {
    kind: "untracked",
    material,
    required: material.estimatedQuantity ?? material.quantity ?? 0
  };
}
