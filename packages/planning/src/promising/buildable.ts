// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import { computeLowLevelCodes } from "@carbon/database/mrp-engine";
import { scrapAllowance } from "@carbon/database/precision";
import { type Kysely, sql } from "kysely";
import { loadActiveBomLines } from "./active-bom.ts";

// Float slack: 0.1 × 30 must not read as short of 3.
const EPSILON = 1e-9;
// No real BOM gets near this; it bounds the doubling search.
const MAX_QUANTITY = 2 ** 40;

export type BuildableLine = {
  itemId: string;
  /** per one parent, in `unitOfMeasureCode` */
  quantity: number;
  unitOfMeasureCode: string;
  /** a Make to Order line: the job builds the child itself, it draws none from stock */
  makeToOrder: boolean;
};

/** Each made item's BOM lines, as they are on its method (not merged). */
export type BuildableBom = Map<string, BuildableLine[]>;

export type BuildableNeed = {
  /** with scrap */
  required: number;
  scrap: number;
  fromStock: number;
  toBuild: number;
  short: number;
};

type Plan = {
  rootItemId: string;
  bom: BuildableBom;
  /** parents before children */
  order: string[];
  /** fraction, as itemReplenishment.scrapPercentage stores it */
  scrapRate: (itemId: string) => number;
};

const isMade = (bom: BuildableBom, itemId: string) =>
  (bom.get(itemId)?.length ?? 0) > 0;

/**
 * Low-level codes of the tree under the root: each item's deepest level, and
 * the parent-before-child order to net in, so a shared item collects every
 * parent's requirement before it is netted once.
 */
export function netOrder(bom: BuildableBom) {
  const { llc, cycleItemIds } = computeLowLevelCodes(
    new Map(
      Array.from(bom, ([itemId, lines]) => [
        itemId,
        lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          methodType: "Pull from Inventory" as const
        }))
      ])
    )
  );
  const order = Array.from(llc.keys()).sort(
    (a, b) => (llc.get(a) ?? 0) - (llc.get(b) ?? 0)
  );
  return { order, llc, cycleItemIds };
}

/**
 * Explode `quantity` of the root through the BOM, netting every item below
 * the root against its available stock once, in low-level-code order.
 *
 * Scrap is added as a job adds it (`computeJobQuantities`): on each line, in
 * whole units up, and a made item's children are exploded from its total with
 * scrap. A Make to Order line's quantity is built, never drawn from stock, as
 * a job builds that child itself; every other line draws stock first. A made
 * item builds what stock does not cover; a bought item is short of it. The
 * root's own stock is not used: the question is how many more can be made.
 */
export function explodeBuildable(
  args: Plan & { available: (itemId: string) => number; quantity: number }
): Map<string, BuildableNeed> {
  const { rootItemId, bom, order, available, scrapRate } = args;
  // What each item's lines ask for, with scrap: drawable from stock, or built.
  const fromStockable = new Map<string, number>();
  const toMake = new Map<string, number>();
  const scraps = new Map<string, number>();
  const add = (map: Map<string, number>, itemId: string, value: number) =>
    map.set(itemId, (map.get(itemId) ?? 0) + value);

  const rootScrap = scrapAllowance(args.quantity, scrapRate(rootItemId));
  add(toMake, rootItemId, args.quantity + rootScrap);
  add(scraps, rootItemId, rootScrap);

  const needs = new Map<string, BuildableNeed>();
  for (const itemId of order) {
    const stockable = fromStockable.get(itemId) ?? 0;
    const total = stockable + (toMake.get(itemId) ?? 0);
    if (total <= EPSILON) continue;
    const fromStock = Math.min(stockable, Math.max(available(itemId), 0));
    const net = total - fromStock;
    const makes = isMade(bom, itemId);
    needs.set(itemId, {
      required: total,
      scrap: scraps.get(itemId) ?? 0,
      fromStock,
      toBuild: makes ? net : 0,
      short: makes || net <= EPSILON ? 0 : net
    });
    if (!makes || net <= EPSILON) continue;
    for (const line of bom.get(itemId) ?? []) {
      const target = line.quantity * net;
      const scrap = scrapAllowance(target, scrapRate(line.itemId));
      add(
        line.makeToOrder && isMade(bom, line.itemId) ? toMake : fromStockable,
        line.itemId,
        target + scrap
      );
      add(scraps, line.itemId, scrap);
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
 * every level. Feasibility only gets harder as the quantity grows (scrap
 * rounds up, never down), so a doubling search then a binary search finds it
 * in O(log n) explosions. `atLeast` is a quantity already known to be
 * feasible, so a search with looser stock starts from it.
 */
export function maxBuildable(
  args: Plan & { available: (itemId: string) => number },
  atLeast = 0
): number {
  if (!isMade(args.bom, args.rootItemId)) return 0;
  const feasible = (quantity: number) =>
    !hasShortage(explodeBuildable({ ...args, quantity }));
  let low = atLeast;
  if (low < 1) {
    if (!feasible(1)) return 0;
    low = 1;
  }
  let high = low * 2;
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

export type BuildableItemInfo = {
  readableId: string;
  name: string;
  /** the unit stock is kept in */
  unitOfMeasureCode: string | null;
  /** fraction */
  scrapPercentage: number;
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
  /** how many one root needs before scrap and stock */
  quantityPerAssembly: number;
  scrapPercentage: number;
  quantityOnHand: number;
  /** open job materials, sales order lines and project materials at the location */
  quantityCommitted: number;
  /** on hand less committed, never below 0 */
  quantityAvailable: number;
  /** open purchase order lines and jobs at the location */
  quantityOnOrder: number;
  /** at the target quantity, with scrap */
  quantityRequired: number;
  quantityScrap: number;
  quantityFromStock: number;
  quantityToBuild: number;
  quantityShort: number;
  /** the root units this item allows if every bought item but it were unlimited; null for a made item */
  quantityBuildableAlone: number | null;
};

/**
 * A BOM line whose unit is not the unit its item is stocked in. Carbon keeps
 * no conversion between units, so the line's quantity cannot be compared
 * with stock: the line, or the item's unit, has to be corrected.
 */
export type BuildableUnitMismatch = {
  parentItemId: string;
  parentReadableId: string;
  itemId: string;
  readableId: string;
  lineUnitOfMeasureCode: string;
  stockUnitOfMeasureCode: string | null;
};

export type Buildable = {
  itemId: string;
  locationId: string;
  quantityOnHand: number;
  quantityCommitted: number;
  quantityAvailable: number;
  /** from available stock: committed stock stays with its jobs and orders. Null while the BOM cannot be calculated */
  quantityBuildable: number | null;
  /** if committed stock could be used too */
  quantityBuildableFromOnHand: number | null;
  /** the quantity `components` is exploded at: the asked quantity, else one more than can be made */
  targetQuantity: number;
  hasMakeMethod: boolean;
  /** lines to correct before the quantities can be calculated */
  unitMismatches: BuildableUnitMismatch[];
  /** items on, or below, a cycle in the BOM: it has to be corrected before the quantities can be calculated */
  cycleItems: { itemId: string; readableId: string }[];
  /** every item below the root, the most limiting bought item first; empty while the BOM cannot be calculated */
  components: BuildableItem[];
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
  const info = (itemId: string) => items.get(itemId);
  const readableId = (itemId: string) => info(itemId)?.readableId ?? itemId;
  const freeOf = (itemId: string) => {
    const s = info(itemId);
    return s ? Math.max(s.quantityOnHand - s.quantityCommitted, 0) : 0;
  };
  const root = info(rootItemId);
  const base = {
    itemId: rootItemId,
    locationId: args.locationId,
    quantityOnHand: root?.quantityOnHand ?? 0,
    quantityCommitted: root?.quantityCommitted ?? 0,
    quantityAvailable: freeOf(rootItemId),
    hasMakeMethod: isMade(bom, rootItemId)
  };

  const unitMismatches: BuildableUnitMismatch[] = [];
  for (const [parentItemId, lines] of bom) {
    for (const line of lines) {
      const stockUnit = info(line.itemId)?.unitOfMeasureCode ?? null;
      if (line.unitOfMeasureCode === stockUnit) continue;
      unitMismatches.push({
        parentItemId,
        parentReadableId: readableId(parentItemId),
        itemId: line.itemId,
        readableId: readableId(line.itemId),
        lineUnitOfMeasureCode: line.unitOfMeasureCode,
        stockUnitOfMeasureCode: stockUnit
      });
    }
  }
  const { order, llc, cycleItemIds } = netOrder(bom);
  const cycleItems = Array.from(cycleItemIds, (itemId) => ({
    itemId,
    readableId: readableId(itemId)
  }));
  if (unitMismatches.length > 0 || cycleItems.length > 0) {
    return {
      ...base,
      quantityBuildable: null,
      quantityBuildableFromOnHand: null,
      targetQuantity: args.targetQuantity ?? 1,
      unitMismatches,
      cycleItems,
      components: []
    };
  }
  if (order.length === 0) order.push(rootItemId);

  const plan: Plan = {
    rootItemId,
    bom,
    order,
    scrapRate: (itemId) => info(itemId)?.scrapPercentage ?? 0
  };
  const quantityBuildable = maxBuildable({ ...plan, available: freeOf });
  // Looser stock than `freeOf`, so `quantityBuildable` is a feasible start.
  const quantityBuildableFromOnHand = maxBuildable(
    { ...plan, available: (itemId) => info(itemId)?.quantityOnHand ?? 0 },
    quantityBuildable
  );
  const targetQuantity =
    args.targetQuantity && args.targetQuantity > 0
      ? args.targetQuantity
      : quantityBuildable + 1;

  const atTarget = explodeBuildable({
    ...plan,
    available: freeOf,
    quantity: targetQuantity
  });
  const perAssembly = explodeBuildable({
    ...plan,
    scrapRate: () => 0,
    available: () => 0,
    quantity: 1
  });

  const components: BuildableItem[] = [];
  for (const id of order) {
    if (id === rootItemId) continue;
    const item = info(id);
    const need = atTarget.get(id);
    const made = isMade(bom, id);
    components.push({
      itemId: id,
      readableId: readableId(id),
      name: item?.name ?? "",
      unitOfMeasureCode: item?.unitOfMeasureCode ?? null,
      isMade: made,
      level: llc.get(id) ?? 1,
      quantityPerAssembly: perAssembly.get(id)?.required ?? 0,
      scrapPercentage: item?.scrapPercentage ?? 0,
      quantityOnHand: item?.quantityOnHand ?? 0,
      quantityCommitted: item?.quantityCommitted ?? 0,
      quantityAvailable: freeOf(id),
      quantityOnOrder: item?.quantityOnOrder ?? 0,
      quantityRequired: need?.required ?? 0,
      quantityScrap: need?.scrap ?? 0,
      quantityFromStock: need?.fromStock ?? 0,
      quantityToBuild: need?.toBuild ?? 0,
      quantityShort: need?.short ?? 0,
      // Every other bought item unlimited, made items keep their stock: looser
      // than `freeOf`, so `quantityBuildable` is a feasible start.
      quantityBuildableAlone: made
        ? null
        : maxBuildable(
            {
              ...plan,
              available: (other) =>
                other === id || bom.has(other) ? freeOf(other) : Infinity
            },
            quantityBuildable
          )
    });
  }

  // Bought items by their limit, lowest first; made items after them.
  const limit = (item: BuildableItem) =>
    item.quantityBuildableAlone ?? Number.POSITIVE_INFINITY;
  components.sort((a, b) => {
    if (limit(a) !== limit(b)) return limit(a) < limit(b) ? -1 : 1;
    return b.quantityShort - a.quantityShort || a.level - b.level;
  });

  return {
    ...base,
    quantityBuildable,
    quantityBuildableFromOnHand,
    targetQuantity,
    unitMismatches,
    cycleItems,
    components
  };
}

/**
 * How many of an item its location can make now, through every level of the
 * active make methods, and what limits it. Two reads: the BOM lines under the
 * item (`loadActiveBomLines`), then each tree item's stock, scrap rate,
 * commitments and open supply at the location (one query). Writes nothing.
 *
 * Stock is common stock (not a project's or planning group's segment, as MRP
 * nets it), less non-nettable storage, in the item's unit; purchase order
 * lines are already converted to it (`openPurchaseOrderLines`). Committed is
 * the common-segment open demand MRP nets. Null when the item is not the
 * company's; the caller checks the location.
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

  const lines = await loadActiveBomLines(db, companyId, [itemId]);
  const bom: BuildableBom = new Map();
  const itemIds = new Set([itemId]);
  for (const line of lines) {
    itemIds.add(line.parentItemId);
    itemIds.add(line.childItemId);
    const children = bom.get(line.parentItemId) ?? [];
    children.push({
      itemId: line.childItemId,
      quantity: line.quantity,
      unitOfMeasureCode: line.unitOfMeasureCode,
      makeToOrder: line.methodType === "Make to Order"
    });
    bom.set(line.parentItemId, children);
  }

  const ids = Array.from(itemIds);
  const rows = await sql<{
    id: string;
    readableId: string | null;
    name: string | null;
    unitOfMeasureCode: string | null;
    scrapPercentage: string | number | null;
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
      ir."scrapPercentage",
      "stock"."quantity" AS "quantityOnHand",
      "committed"."quantity" AS "quantityCommitted",
      "onOrder"."quantity" AS "quantityOnOrder"
    FROM "item" i
    LEFT JOIN "itemReplenishment" ir
      ON ir."itemId" = i."id" AND ir."companyId" = i."companyId"
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
      scrapPercentage: Math.max(Number(row.scrapPercentage ?? 0), 0),
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
