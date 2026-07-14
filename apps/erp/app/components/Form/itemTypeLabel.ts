import type { Database } from "@carbon/database";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

type ItemType = Database["public"]["Enums"]["itemType"];

// "Item" is the generic sentinel used across forms before a concrete item type
// is chosen (see `MethodItemType | "Item"` in Item.tsx and the line forms). It
// must resolve to a label so the field header isn't blank in that state.
type ItemTypeOrGeneric = ItemType | "Item";

const LABELS: Record<ItemTypeOrGeneric, MessageDescriptor> = {
  Item: msg`Item`,
  Part: msg`Part`,
  Material: msg`Material`,
  Tool: msg`Tool`,
  Consumable: msg`Consumable`,
  Service: msg`Service`,
  Fixture: msg`Fixture`
};

const ID_LABELS: Record<ItemTypeOrGeneric, MessageDescriptor> = {
  Item: msg`Item ID`,
  Part: msg`Part ID`,
  Material: msg`Material ID`,
  Tool: msg`Tool ID`,
  Consumable: msg`Consumable ID`,
  Service: msg`Service ID`,
  Fixture: msg`Fixture ID`
};

export function itemTypeLabel(type: ItemTypeOrGeneric): MessageDescriptor {
  return LABELS[type];
}

export function itemTypeIdLabel(type: ItemTypeOrGeneric): MessageDescriptor {
  return ID_LABELS[type];
}
