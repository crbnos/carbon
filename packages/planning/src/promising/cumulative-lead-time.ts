// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { loadActiveBomLines } from "./active-bom.ts";

/** Same fallback MRP uses when an item has no itemReplenishment.leadTime. */
export const DEFAULT_LEAD_TIME_DAYS = 7;

export type LeadTimeItem = {
  /** itemReplenishment.leadTime: a Buy item's purchase time, a Make item's own build time */
  leadTime: number;
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
};

export type BomEdge = { parentItemId: string; childItemId: string };

/**
 * The cumulative lead time of each item: the longest lead-time path from the
 * item down through its active make method. A Buy item stops at its own lead
 * time. A Make item adds the longest child path to its own build time — the
 * glossary defines a make item's `leadTime` as its own release-to-completion
 * time, so the components are not in it yet. An item seen again on the path
 * counts 0, so a cycle ends; a value cut short by a cycle is not reused.
 */
export function cumulativeLeadTimes(
  items: Map<string, LeadTimeItem>,
  edges: BomEdge[]
): Map<string, number> {
  const children = new Map<string, Set<string>>();
  for (const edge of edges) {
    const set = children.get(edge.parentItemId) ?? new Set<string>();
    set.add(edge.childItemId);
    children.set(edge.parentItemId, set);
  }

  const memo = new Map<string, number>();
  const onPath = new Set<string>();

  // `cut` is true when a cycle stopped the walk below this item. Such a value
  // depends on where the walk started, so it is not kept for other roots.
  const visit = (itemId: string): { total: number; cut: boolean } => {
    const known = memo.get(itemId);
    if (known !== undefined) return { total: known, cut: false };
    if (onPath.has(itemId)) return { total: 0, cut: true };

    const item = items.get(itemId);
    const own = Math.max(item?.leadTime ?? DEFAULT_LEAD_TIME_DAYS, 0);
    if (item?.replenishmentSystem === "Buy") {
      memo.set(itemId, own);
      return { total: own, cut: false };
    }

    onPath.add(itemId);
    let longestChild = 0;
    let cut = false;
    for (const childId of children.get(itemId) ?? []) {
      const child = visit(childId);
      longestChild = Math.max(longestChild, child.total);
      cut = cut || child.cut;
    }
    onPath.delete(itemId);

    const total = own + longestChild;
    if (!cut) memo.set(itemId, total);
    return { total, cut };
  };

  const result = new Map<string, number>();
  for (const itemId of items.keys()) result.set(itemId, visit(itemId).total);
  return result;
}

export type ItemLeadTimes = {
  /** itemReplenishment.leadTime, else the default */
  own: number;
  /** the longest path through the active BOM (`cumulativeLeadTimes`) */
  cumulative: number;
};

/**
 * Load the BOM tree under each root item (`loadActiveBomLines`) and each tree
 * item's lead time, then return each root's own and cumulative lead time.
 */
export async function loadCumulativeLeadTimes(
  db: Kysely<DB>,
  companyId: string,
  itemIds: string[]
): Promise<Map<string, ItemLeadTimes>> {
  const roots = Array.from(new Set(itemIds));
  if (roots.length === 0) return new Map();

  const edges = await loadActiveBomLines(db, companyId, roots);
  const treeItemIds = Array.from(
    new Set([
      ...roots,
      ...edges.map((e) => e.parentItemId),
      ...edges.map((e) => e.childItemId)
    ])
  );

  const itemRows = await db
    .selectFrom("item")
    .leftJoin("itemReplenishment", (join) =>
      join
        .onRef("itemReplenishment.itemId", "=", "item.id")
        .onRef("itemReplenishment.companyId", "=", "item.companyId")
    )
    .select([
      "item.id as id",
      "item.replenishmentSystem as replenishmentSystem",
      "itemReplenishment.leadTime as leadTime"
    ])
    .where("item.id", "in", treeItemIds)
    .where("item.companyId", "=", companyId)
    .execute();

  const items = new Map<string, LeadTimeItem>();
  for (const row of itemRows) {
    items.set(row.id, {
      leadTime:
        row.leadTime === null || row.leadTime === undefined
          ? DEFAULT_LEAD_TIME_DAYS
          : Number(row.leadTime),
      replenishmentSystem: row.replenishmentSystem ?? "Buy"
    });
  }

  const all = cumulativeLeadTimes(items, edges);
  const result = new Map<string, ItemLeadTimes>();
  for (const root of roots) {
    result.set(root, {
      own: Math.max(items.get(root)?.leadTime ?? DEFAULT_LEAD_TIME_DAYS, 0),
      cumulative: all.get(root) ?? DEFAULT_LEAD_TIME_DAYS
    });
  }
  return result;
}
