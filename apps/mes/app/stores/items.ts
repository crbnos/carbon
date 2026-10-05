// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import { type LiveList, useLiveList } from "@carbon/query";
import { useMemo } from "react";
import { useUser } from "~/hooks";
import type { ListItem } from "~/types";

export type Item = ListItem & {
  readableIdWithRevision: string;
  type: Database["public"]["Enums"]["itemType"];
  itemTrackingType: Database["public"]["Enums"]["itemTrackingType"];
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
  active: boolean;
  thumbnailPath: string | null;
};

// The one place the item list's columns are written. The thumbnail falls back
// to the model's when the item has none of its own.
const ITEM_COLUMNS =
  "id, readableIdWithRevision, name, type, replenishmentSystem, itemTrackingType, active, thumbnailPath, modelUpload:modelUploadId(thumbnailPath)";

type ItemRow = Item & { modelUpload?: { thumbnailPath: string | null } | null };

const toItem = ({ modelUpload, ...item }: ItemRow): Item => ({
  ...item,
  thumbnailPath: item.thumbnailPath ?? modelUpload?.thumbnailPath ?? null
});

export const itemsList: LiveList<Item> = {
  name: "mesItems",
  table: "item",
  async fetchAll(carbon, companyId) {
    const items = await fetchAllFromTable<ItemRow>(
      carbon,
      "item",
      ITEM_COLUMNS,
      (query) =>
        query
          .eq("companyId", companyId)
          .order("readableId", { ascending: true })
          .order("revision", { ascending: false })
    );
    if (items.error) throw new Error("Failed to fetch items");
    return (items.data ?? []).map(toItem);
  },
  async fetchByIds(carbon, companyId, ids) {
    const items = await carbon
      .from("item")
      .select(ITEM_COLUMNS)
      .eq("companyId", companyId)
      .in("id", ids);
    if (items.error) throw new Error("Failed to fetch items");
    return ((items.data ?? []) as unknown as ItemRow[]).map(toItem);
  },
  // A model's thumbnail is rendered after upload, on its own row: re-read the
  // items that show it.
  related: [
    {
      table: "modelUpload",
      async fetch(carbon, companyId, ids) {
        const items = await carbon
          .from("item")
          .select(ITEM_COLUMNS)
          .eq("companyId", companyId)
          .in("modelUploadId", ids);
        if (items.error) throw new Error("Failed to fetch items");
        return ((items.data ?? []) as unknown as ItemRow[]).map(toItem);
      }
    }
  ],
  sort: (a, b) =>
    a.readableIdWithRevision.localeCompare(b.readableIdWithRevision)
};

export const useItems = () => useLiveList(itemsList, useUser().company.id);

const useItemsOfType = (type: Item["type"]) => {
  const [items] = useItems();
  return useMemo(() => items.filter((i) => i.type === type), [items, type]);
};

export const useParts = () => useItemsOfType("Part");
export const useTools = () => useItemsOfType("Tool");
export const useServices = () => useItemsOfType("Service");
export const useMaterials = () => useItemsOfType("Material");
