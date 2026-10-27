// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ItemSpec, ItemsData, ItemType } from "./types.ts";

/** Every item spec of a dataset, in insertion order: buy, material, consumable, tool, service, make. */
export function allItemSpecs(items: ItemsData): ItemSpec[] {
  return [
    ...items.buyParts,
    ...items.materials,
    ...items.consumables,
    ...items.tools,
    ...items.services,
    ...items.makeParts
  ];
}

/** The type table that extends an item row; its id is the item's readableId. */
export function extensionTableFor(type: ItemType): string {
  switch (type) {
    case "Part":
      return "part";
    case "Material":
      return "material";
    case "Tool":
      return "tool";
    case "Consumable":
      return "consumable";
    case "Service":
      return "service";
    case "Fixture":
      return "fixture";
  }
}
