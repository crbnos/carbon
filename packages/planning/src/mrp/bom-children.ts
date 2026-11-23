// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { BomChild, MethodType } from "@carbon/database/mrp-engine";

export type MethodMaterialRow = {
  itemId: string;
  quantity: number | string | null;
  methodType: MethodType | string;
};

// A make method's lines as BOM children for explosion. A line whose quantity
// is zero (or missing) consumes nothing and is left out — it must not default
// to one. A configured item holds every configuration's lines at quantity 0
// except the default's; defaulting them to 1 exploded every configuration at
// once (24 dump bodies per trailer).
export function bomChildren(materials: MethodMaterialRow[]): BomChild[] {
  const children: BomChild[] = [];
  for (const mat of materials) {
    const quantity = Number(mat.quantity);
    if (!(quantity > 0)) continue;
    children.push({
      itemId: mat.itemId,
      quantity,
      methodType: mat.methodType as MethodType
    });
  }
  return children;
}
