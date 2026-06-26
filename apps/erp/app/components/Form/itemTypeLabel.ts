import type { Database } from "@carbon/database";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

type ItemType = Database["public"]["Enums"]["itemType"];

const LABELS: Record<ItemType, MessageDescriptor> = {
  Part: msg`Part`,
  Material: msg`Material`,
  Tool: msg`Tool`,
  Consumable: msg`Consumable`,
  Service: msg`Service`,
  Fixture: msg`Fixture`
};

const ID_LABELS: Record<ItemType, MessageDescriptor> = {
  Part: msg`Part ID`,
  Material: msg`Material ID`,
  Tool: msg`Tool ID`,
  Consumable: msg`Consumable ID`,
  Service: msg`Service ID`,
  Fixture: msg`Fixture ID`
};

export function itemTypeLabel(type: ItemType): MessageDescriptor {
  return LABELS[type];
}

export function itemTypeIdLabel(type: ItemType): MessageDescriptor {
  return ID_LABELS[type];
}
