// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import { type LiveList, useLiveList } from "@carbon/query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import { useUser } from "~/hooks";
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

// The one place the item list's columns are written: the full fetch and the
// re-read of changed rows both select exactly this.
const ITEM_COLUMNS =
  "id, readableId, revision, readableIdWithRevision, unitOfMeasureCode, name, type, replenishmentSystem, active, itemTrackingType";

type ItemRow = Omit<Item, "supersessionMode" | "successorItemId">;

// A phase-out rule lives on its own table; the pickers read it off the item.
async function withSupersession(
  carbon: SupabaseClient<Database>,
  companyId: string,
  items: ItemRow[],
  ids?: string[]
): Promise<Item[]> {
  const supersessions = await fetchAllFromTable<{
    itemId: string;
    supersessionMode: Database["public"]["Enums"]["supersessionMode"];
    successorItemId: string | null;
  }>(
    carbon,
    "itemSupersession",
    "itemId, supersessionMode, successorItemId",
    (query) => {
      const scoped = query.eq("companyId", companyId);
      return ids ? scoped.in("itemId", ids) : scoped;
    }
  );
  const byItem = new Map((supersessions.data ?? []).map((s) => [s.itemId, s]));
  return items.map((item) => ({
    ...item,
    supersessionMode: byItem.get(item.id)?.supersessionMode ?? null,
    successorItemId: byItem.get(item.id)?.successorItemId ?? null
  }));
}

export const itemsList: LiveList<Item> = {
  name: "items",
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
    return withSupersession(carbon, companyId, items.data ?? []);
  },
  async fetchByIds(carbon, companyId, ids) {
    const items = await carbon
      .from("item")
      .select(ITEM_COLUMNS)
      .eq("companyId", companyId)
      .in("id", ids);
    if (items.error) throw new Error("Failed to fetch items");
    return withSupersession(
      carbon,
      companyId,
      (items.data ?? []) as ItemRow[],
      ids
    );
  },
  // A supersession rule is logged under its item's id.
  related: [
    {
      table: "itemSupersession",
      fetch: (carbon, companyId, ids) =>
        itemsList.fetchByIds(carbon, companyId, ids)
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
