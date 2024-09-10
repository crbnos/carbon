import type { Database } from "@carbon/database";
import { useStore as useValue } from "@nanostores/react";
import { atom, computed } from "nanostores";
import { useNanoStore } from "~/hooks";
import type { ListItem } from "~/types";

export type Item = ListItem & {
  readableId: string;
  type: Database["public"]["Enums"]["itemType"];
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
  active: boolean;
};

const $itemsStore = atom<Item[]>([]);

const $partsStore = computed($itemsStore, (item) =>
  item.filter((i) => i.type === "Part")
);

const $fixturesStore = computed($itemsStore, (item) =>
  item.filter((i) => i.type === "Fixture")
);

const $serivceStore = computed($itemsStore, (item) =>
  item.filter((i) => i.type === "Service")
);

const $materialsStore = computed($itemsStore, (item) =>
  item.filter((i) => i.type === "Material")
);

export const useItems = () => useNanoStore<Item[]>($itemsStore, "items");
export const useParts = () => useValue($partsStore);
export const useFixtures = () => useValue($fixturesStore);
export const useServices = () => useValue($serivceStore);
export const useMaterials = () => useValue($materialsStore);
