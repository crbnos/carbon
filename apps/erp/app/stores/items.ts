import type { Database } from "@carbon/database";
import { useStore as useValue } from "@nanostores/react";
import { atom, computed } from "nanostores";
import { useNanoStore } from "~/hooks";
import type { ListItem } from "~/types";

export type Item = ListItem & {
  readableIdWithRevision: string;
  readableId?: string | null;
  revision?: string | null;
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
  itemTrackingType: Database["public"]["Enums"]["itemTrackingType"];
  unitOfMeasureCode: string;
  type: Database["public"]["Enums"]["itemType"];
  active: boolean;
  quantityOnHand?: number;
  quantityByLocation?: Record<string, number>;
  supersessionMode?: Database["public"]["Enums"]["supersessionMode"] | null;
  successorItemId?: string | null;
};

// '0'/''/null are all the initial revision; named revisions (A, B, …) rank above
// it and sort lexically (mirrors the item fetch's `revision DESC` ordering).
function revisionRank(revision?: string | null): string {
  return revision == null || revision === "" ? "0" : revision;
}

// Collapse a list of item revisions to one row per readableId, keeping the
// latest revision — deterministically, without depending on array order. Used
// by pickers that should offer a single current revision per part (e.g. change
// orders). Falls back to `id` as the key when `readableId` is absent.
export function latestRevisionByReadableId<
  T extends { id: string; readableId?: string; revision?: string | null }
>(items: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = item.readableId ?? item.id;
    const existing = byKey.get(key);
    if (
      !existing ||
      revisionRank(item.revision) > revisionRank(existing.revision)
    ) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

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
