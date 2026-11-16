// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import { computeLowLevelCodes } from "@carbon/database/mrp-engine";
import { type Kysely, sql } from "kysely";

// Float slack: 0.1 × 30 must not read as short of 3.
const EPSILON = 1e-9;
// No real BOM gets near this; it bounds the doubling search.
const MAX_QUANTITY = 2 ** 40;

export type BuildableBom = Map<string, { itemId: string; quantity: number }[]>;

export type BuildableNeed = {
  required: number;
  fromStock: number;
  toBuild: number;
  short: number;
};

/**
 * The parent-before-child order to net in: low-level code, so a shared item
 * collects every parent's requirement before it is netted once. An item on a
 * cycle comes last and is not exploded, as MRP plans it.
 */
export function netOrder(rootItemId: string, bom: BuildableBom) {
  const { llc, cycleItemIds } = computeLowLevelCodes(
    new Map(
      Array.from(bom, ([itemId, children]) => [
        itemId,
        children.map((c) => ({
          itemId: c.itemId,
          quantity: c.quantity,
          methodType: "Pull from Inventory" as const
        }))
      ])
    )
  );
  const order = Array.from(llc.keys()).sort(
    (a, b) => (llc.get(a) ?? 0) - (llc.get(b) ?? 0)
  );
  if (!llc.has(rootItemId)) order.unshift(rootItemId);
  return { order: [...order, ...cycleItemIds], cycleItemIds };
}

/**
 * Explode `quantity` of the root through the BOM, netting every item below
 * the root against its available stock once, in low-level-code order. A made
 * item builds what stock does not cover; a bought item is short of it. The
 * root's own stock is not used: the question is how many more can be made.
 */
export function explodeBuildable(args: {
  rootItemId: string;
  bom: BuildableBom;
  order: string[];
  cycleItemIds: Set<string>;
  available: (itemId: string) => number;
  quantity: number;
}): Map<string, BuildableNeed> {
  const { rootItemId, bom, order, cycleItemIds, available, quantity } = args;
  const required = new Map<string, number>([[rootItemId, quantity]]);
  const needs = new Map<string, BuildableNeed>();

  for (const itemId of order) {
    const gross = required.get(itemId) ?? 0;
    if (gross <= EPSILON) continue;
    const stock = itemId === rootItemId ? 0 : Math.max(available(itemId), 0);
    const fromStock = Math.min(gross, stock);
    const net = gross - fromStock;
    const children = cycleItemIds.has(itemId) ? undefined : bom.get(itemId);
    const makes = !!children && children.length > 0;
    needs.set(itemId, {
      required: gross,
      fromStock,
      toBuild: makes ? net : 0,
      short: makes || net <= EPSILON ? 0 : net
    });
    if (!makes || net <= EPSILON) continue;
    for (const child of children) {
      required.set(
        child.itemId,
        (required.get(child.itemId) ?? 0) + child.quantity * net
      );
    }
  }
  return needs;
}

const hasShortage = (needs: Map<string, BuildableNeed>) => {
  for (const need of needs.values()) if (need.short > EPSILON) return true;
  return false;
};

/**
 * The most whole units of the root the available stock can make, through
 * every level. Feasibility only gets harder as the quantity grows, so a
 * doubling search then a binary search finds it in O(log n) explosions.
 */
export function maxBuildable(args: {
  rootItemId: string;
  bom: BuildableBom;
  order: string[];
  cycleItemIds: Set<string>;
  available: (itemId: string) => number;
}): number {
  if (!(args.bom.get(args.rootItemId)?.length ?? 0)) return 0;
  const feasible = (quantity: number) =>
    !hasShortage(explodeBuildable({ ...args, quantity }));
  if (!feasible(1)) return 0;
  let low = 1;
  let high = 2;
  while (high <= MAX_QUANTITY && feasible(high)) {
    low = high;
    high *= 2;
  }
  if (high > MAX_QUANTITY) return low;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (feasible(mid)) low = mid;
    else high = mid;
  }
  return low;
}

export type BuildableStock = {
  quantityOnHand: number;
  quantityCommitted: number;
  quantityOnOrder: number;
};

export type BuildableItem = {
  itemId: string;
  readableId: string;
  name: string;
  unitOfMeasureCode: string | null;
  /** has an active make method this calculation builds through */
  isMade: boolean;
  /** the deepest level the item appears at; the root is 0 */
  level: number;
  /** how many one root needs when no stock is used */
  quantityPerAssembly: number;
  quantityOnHand: number;
  /** open job materials, sales order lines and project materials at the location */
  quantityCommitted: number;
  /** on hand less committed, never below 0 */
  quantityAvailable: number;
  /** open purchase order lines and jobs at the location */
  quantityOnOrder: number;
  /** at the target quantity */
  quantityRequired: number;
  quantityFromStock: number;
  quantityToBuild: number;
  quantityShort: number;
  /** the root units this item allows if every bought item but it were unlimited; null for a made item */
  quantityBuildableAlone: number | null;
};

export type Buildable = {
  itemId: string;
  locationId: string;
  quantityOnHand: number;
  quantityCommitted: number;
  quantityAvailable: number;
  /** from available stock: committed stock stays with its jobs and orders */
  quantityBuildable: number;
  /** if committed stock could be used too */
  quantityBuildableFromOnHand: number;
  /** the quantity `components` is exploded at: the asked quantity, else one more than can be made */
  targetQuantity: number;
  hasMakeMethod: boolean;
  /** items on a BOM cycle, counted as bought items */
  cycleItemIds: string[];
  /** every item below the root, the most limiting bought item first */
  components: BuildableItem[];
};

export type BuildableItemInfo = BuildableStock & {
  readableId: string;
  name: string;
  unitOfMeasureCode: string | null;
};

/** The pure calculation behind `loadBuildable`. */
export function computeBuildable(args: {
  itemId: string;
  locationId: string;
  bom: BuildableBom;
  items: Map<string, BuildableItemInfo>;
  targetQuantity?: number;
}): Buildable {
  const { itemId: rootItemId, bom, items } = args;
  const { order, cycleItemIds } = netOrder(rootItemId, bom);
  const stockOf = (itemId: string) => items.get(itemId);
  const freeOf = (itemId: string) => {
    const s = stockOf(itemId);
    return s ? Math.max(s.quantityOnHand - s.quantityCommitted, 0) : 0;
  };
  const onHandOf = (itemId: string) => stockOf(itemId)?.quantityOnHand ?? 0;
  const base = { rootItemId, bom, order, cycleItemIds };

  const quantityBuildable = maxBuildable({ ...base, available: freeOf });
  const quantityBuildableFromOnHand = maxBuildable({
    ...base,
    available: onHandOf
  });
  const targetQuantity =
    args.targetQuantity && args.targetQuantity > 0
      ? args.targetQuantity
      : quantityBuildable + 1;

  const atTarget = explodeBuildable({
    ...base,
    available: freeOf,
    quantity: targetQuantity
  });
  const perAssembly = explodeBuildable({
    ...base,
    available: () => 0,
    quantity: 1
  });

  // Levels for display: the longest path from the root.
  const level = new Map<string, number>([[rootItemId, 0]]);
  for (const id of order) {
    if (cycleItemIds.has(id)) continue;
    for (const child of bom.get(id) ?? []) {
      const next = (level.get(id) ?? 0) + 1;
      if (next > (level.get(child.itemId) ?? -1)) level.set(child.itemId, next);
    }
  }

  const components: BuildableItem[] = [];
  for (const id of order) {
    if (id === rootItemId) continue;
    const info = stockOf(id);
    const need = atTarget.get(id);
    const isMade = !cycleItemIds.has(id) && (bom.get(id)?.length ?? 0) > 0;
    components.push({
      itemId: id,
      readableId: info?.readableId ?? id,
      name: info?.name ?? "",
      unitOfMeasureCode: info?.unitOfMeasureCode ?? null,
      isMade,
      level: level.get(id) ?? 1,
      quantityPerAssembly: perAssembly.get(id)?.required ?? 0,
      quantityOnHand: info?.quantityOnHand ?? 0,
      quantityCommitted: info?.quantityCommitted ?? 0,
      quantityAvailable: freeOf(id),
      quantityOnOrder: info?.quantityOnOrder ?? 0,
      quantityRequired: need?.required ?? 0,
      quantityFromStock: need?.fromStock ?? 0,
      quantityToBuild: need?.toBuild ?? 0,
      quantityShort: need?.short ?? 0,
      // Every other bought item unlimited; made items keep their stock.
      quantityBuildableAlone: isMade
        ? null
        : maxBuildable({
            ...base,
            available: (other) =>
              other === id || bom.has(other) ? freeOf(other) : Infinity
          })
    });
  }

  components.sort(
    (a, b) =>
      (a.quantityBuildableAlone ?? Infinity) -
        (b.quantityBuildableAlone ?? Infinity) ||
      b.quantityShort - a.quantityShort ||
      a.level - b.level
  );

  const root = stockOf(rootItemId);
  return {
    itemId: rootItemId,
    locationId: args.locationId,
    quantityOnHand: root?.quantityOnHand ?? 0,
    quantityCommitted: root?.quantityCommitted ?? 0,
    quantityAvailable: freeOf(rootItemId),
    quantityBuildable,
    quantityBuildableFromOnHand,
    targetQuantity,
    hasMakeMethod: (bom.get(rootItemId)?.length ?? 0) > 0,
    cycleItemIds: Array.from(cycleItemIds),
    components
  };
}

/**
 * How many of an item its location can make now, through every level of the
 * active make methods, and what limits it. Two reads: the BOM lines under the
 * item (one recursive query), then each tree item's stock, commitments and
 * open supply at the location (one query). Writes nothing.
 *
 * The BOM is the one MRP explodes: active make methods, no quantity-0 line, no
 * correction material; an item whose replenishment is Buy is not exploded.
 * Stock is common stock (not a project's or planning group's), less
 * non-nettable storage. Committed is the common-segment open demand MRP nets.
 * Null when the item is not the company's.
 */
export async function loadBuildable(
  db: Kysely<DB>,
  args: {
    companyId: string;
    locationId: string;
    itemId: string;
    targetQuantity?: number;
  }
): Promise<Buildable | null> {
  const { companyId, locationId, itemId } = args;

  // UNION on the line id: a shared subassembly's lines come back once, and a
  // cycle stops when it reaches lines it already has.
  const lines = await sql<{
    parentItemId: string;
    childItemId: string;
    quantity: string | number;
  }>`
    WITH RECURSIVE "line" AS (
      SELECT mm."id", am."itemId" AS "parentItemId", mm."itemId" AS "childItemId", mm."quantity"
      FROM "activeMakeMethods" am
      JOIN "methodMaterial" mm
        ON mm."makeMethodId" = am."id" AND mm."companyId" = am."companyId"
        AND mm."quantity" > 0 AND mm."methodCorrectionId" IS NULL
      WHERE am."companyId" = ${companyId} AND am."itemId" = ${itemId}
      UNION
      SELECT mm."id", am."itemId", mm."itemId", mm."quantity"
      FROM "line" l
      JOIN "item" i
        ON i."id" = l."childItemId" AND i."companyId" = ${companyId}
        AND i."replenishmentSystem" <> 'Buy'
      JOIN "activeMakeMethods" am
        ON am."itemId" = l."childItemId" AND am."companyId" = ${companyId}
      JOIN "methodMaterial" mm
        ON mm."makeMethodId" = am."id" AND mm."companyId" = am."companyId"
        AND mm."quantity" > 0 AND mm."methodCorrectionId" IS NULL
    )
    SELECT "parentItemId", "childItemId", "quantity" FROM "line"
  `.execute(db);

  // Two lines of one child on one method count once, summed.
  const bom: BuildableBom = new Map();
  const itemIds = new Set([itemId]);
  for (const line of lines.rows) {
    itemIds.add(line.childItemId);
    const children = bom.get(line.parentItemId) ?? [];
    const existing = children.find((c) => c.itemId === line.childItemId);
    if (existing) existing.quantity += Number(line.quantity);
    else
      children.push({
        itemId: line.childItemId,
        quantity: Number(line.quantity)
      });
    bom.set(line.parentItemId, children);
  }

  const ids = Array.from(itemIds);
  const rows = await sql<{
    id: string;
    readableId: string | null;
    name: string | null;
    unitOfMeasureCode: string | null;
    quantityOnHand: string | number | null;
    quantityCommitted: string | number | null;
    quantityOnOrder: string | number | null;
  }>`
    WITH
    "stock" AS (
      SELECT isq."itemId", SUM(isq."quantityOnHand" - isq."quantityNonNettable") AS "quantity"
      FROM "itemStockQuantities" isq
      WHERE isq."companyId" = ${companyId} AND isq."locationId" = ${locationId}
        AND isq."itemId" = ANY(${ids}::text[])
        AND project_planning_segment(NULLIF(isq."projectId", '')) = ''
      GROUP BY isq."itemId"
    ),
    "committed" AS (
      SELECT d."itemId", SUM(d."quantity") AS "quantity"
      FROM (
        SELECT "itemId", "quantityToIssue" AS "quantity" FROM "openJobMaterialLines"
        WHERE "companyId" = ${companyId} AND "locationId" = ${locationId}
          AND "itemId" = ANY(${ids}::text[]) AND COALESCE("planningSegmentId", '') = ''
        UNION ALL
        SELECT "itemId", "quantityToSend" FROM "openSalesOrderLines"
        WHERE "companyId" = ${companyId} AND "locationId" = ${locationId}
          AND "itemId" = ANY(${ids}::text[]) AND COALESCE("planningSegmentId", '') = ''
        UNION ALL
        SELECT "itemId", GREATEST("quantity", 0) FROM "openProjectMaterialLines"
        WHERE "companyId" = ${companyId} AND "locationId" = ${locationId}
          AND "itemId" = ANY(${ids}::text[]) AND COALESCE("planningSegmentId", '') = ''
      ) d
      GROUP BY d."itemId"
    ),
    "onOrder" AS (
      SELECT s."itemId", SUM(s."quantity") AS "quantity"
      FROM (
        SELECT "itemId", "quantityToReceive" AS "quantity" FROM "openPurchaseOrderLines"
        WHERE "companyId" = ${companyId} AND "locationId" = ${locationId}
          AND "itemId" = ANY(${ids}::text[]) AND COALESCE("planningSegmentId", '') = ''
        UNION ALL
        SELECT "itemId", "quantityToReceive" FROM "openProductionOrders"
        WHERE "companyId" = ${companyId} AND "locationId" = ${locationId}
          AND "itemId" = ANY(${ids}::text[]) AND COALESCE("planningSegmentId", '') = ''
      ) s
      GROUP BY s."itemId"
    )
    SELECT
      i."id",
      i."readableIdWithRevision" AS "readableId",
      i."name",
      i."unitOfMeasureCode",
      "stock"."quantity" AS "quantityOnHand",
      "committed"."quantity" AS "quantityCommitted",
      "onOrder"."quantity" AS "quantityOnOrder"
    FROM "item" i
    LEFT JOIN "stock" ON "stock"."itemId" = i."id"
    LEFT JOIN "committed" ON "committed"."itemId" = i."id"
    LEFT JOIN "onOrder" ON "onOrder"."itemId" = i."id"
    WHERE i."companyId" = ${companyId} AND i."id" = ANY(${ids}::text[])
  `.execute(db);

  const items = new Map<string, BuildableItemInfo>();
  for (const row of rows.rows) {
    items.set(row.id, {
      readableId: row.readableId ?? row.id,
      name: row.name ?? "",
      unitOfMeasureCode: row.unitOfMeasureCode,
      quantityOnHand: Number(row.quantityOnHand ?? 0),
      quantityCommitted: Math.max(Number(row.quantityCommitted ?? 0), 0),
      quantityOnOrder: Math.max(Number(row.quantityOnOrder ?? 0), 0)
    });
  }

  if (!items.has(itemId)) return null;

  return computeBuildable({
    itemId,
    locationId,
    bom,
    items,
    targetQuantity: args.targetQuantity
  });
}
