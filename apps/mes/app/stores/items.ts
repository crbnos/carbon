// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { useStore as useValue } from "@nanostores/react";
import { atom, computed } from "nanostores";
import { useNanoStore } from "~/hooks";
import type { ListItem } from "~/types";

export type Item = ListItem & {
  readableIdWithRevision: string;
  type: Database["public"]["Enums"]["itemType"];
  itemTrackingType: Database["public"]["Enums"]["itemTrackingType"];
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
  active: boolean;
  thumbnailPath: string | null;
};

const $itemsStore = atom<Item[]>([]);

const $partsStore = computed($itemsStore, (item) =>
  item.filter((i) => i.type === "Part")
);

const $toolsStore = computed($itemsStore, (item) =>
  item.filter((i) => i.type === "Tool")
);

const $serivceStore = computed($itemsStore, (item) =>
  item.filter((i) => i.type === "Service")
);

const $materialsStore = computed($itemsStore, (item) =>
  item.filter((i) => i.type === "Material")
);

export const useItems = () => useNanoStore<Item[]>($itemsStore, "items");
export const useParts = () => useValue($partsStore);
export const useTools = () => useValue($toolsStore);
export const useServices = () => useValue($serivceStore);
export const useMaterials = () => useValue($materialsStore);
