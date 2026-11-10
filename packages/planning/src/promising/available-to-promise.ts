// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { fetchAll } from "@carbon/database/fetch-all";
import { parseDate, startOfWeek } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  jobCompletionDate,
  purchaseOrderLineArrivalDate
} from "../mrp/supply-date.ts";

/** Same fallback MRP uses when an item has no itemReplenishment.leadTime. */
const DEFAULT_LEAD_TIME_DAYS = 7;

export type DatedQuantity = { date: string; quantity: number };

export type SupplyAndDemand = {
  onHand: number;
  supply: DatedQuantity[];
  demand: DatedQuantity[];
};

/**
 * The start (Sunday, as MRP's weekly periods) of every week from the week of
 * `todayIso` to the week of `lastIso`, inclusive.
 */
export function weekStarts(todayIso: string, lastIso: string): string[] {
  const first = startOfWeek(parseDate(todayIso), "en-US");
  const last = startOfWeek(
    parseDate(lastIso < todayIso ? todayIso : lastIso),
    "en-US"
  );
  const weeks: string[] = [];
  for (
    let week = first;
    week.compare(last) <= 0;
    week = week.add({ days: 7 })
  ) {
    weeks.push(week.toString());
  }
  return weeks;
}

/**
 * The index of the week a date falls in. A date before today counts in week 0,
 * as MRP buckets past-due rows; a date after the last week returns null.
 */
export function weekIndexOf(
  weeks: string[],
  dateIso: string,
  todayIso: string
): number | null {
  if (dateIso <= todayIso) return 0;
  const start = startOfWeek(parseDate(dateIso), "en-US").toString();
  const index = weeks.indexOf(start);
  return index === -1 ? null : index;
}

/**
 * Free stock (available to promise) at the end of each week, cumulative with
 * look-ahead: the smallest projected balance from that week to the last week,
 * never below 0. Taking the smallest LATER balance keeps a new order from
 * using stock a later order already holds.
 */
export function freeStockByWeek(args: {
  onHand: number;
  supply: DatedQuantity[];
  demand: DatedQuantity[];
  weeks: string[];
  todayIso: string;
}): number[] {
  const { onHand, supply, demand, weeks, todayIso } = args;
  const net = new Array<number>(weeks.length).fill(0);
  for (const row of supply) {
    const index = weekIndexOf(weeks, row.date, todayIso);
    if (index !== null) net[index]! += row.quantity;
  }
  for (const row of demand) {
    const index = weekIndexOf(weeks, row.date, todayIso);
    if (index !== null) net[index]! -= row.quantity;
  }

  const balance: number[] = [];
  let running = onHand;
  for (const change of net) {
    running += change;
    balance.push(running);
  }

  const free = new Array<number>(weeks.length).fill(0);
  let lowest = Number.POSITIVE_INFINITY;
  for (let i = weeks.length - 1; i >= 0; i--) {
    lowest = Math.min(lowest, balance[i]!);
    free[i] = Math.max(lowest, 0);
  }
  return free;
}

/** The first week whose free stock covers the quantity, or null if none does. */
export function earliestWeekWithStock(
  freeStock: number[],
  quantity: number
): number | null {
  const index = freeStock.findIndex((free) => free >= quantity);
  return index === -1 ? null : index;
}

const keyOf = (itemId: string, locationId: string) => `${itemId}:${locationId}`;

// Common stock only: a row in a project or planning-group segment nets there.
const isCommon = (segment: string | null | undefined) => !segment;

/**
 * Live on-hand, open supply and open demand for each item and location, dated
 * as MRP dates them. Reads each source once for every requested item. The
 * sales order lines being checked are left out of the demand, so a line does
 * not count against itself.
 */
export async function loadSupplyAndDemand(args: {
  client: SupabaseClient<Database>;
  companyId: string;
  keys: { itemId: string; locationId: string }[];
  /** today at each location, the date an undated row counts on */
  todayByLocation: Map<string, string>;
  excludeSalesOrderLineIds: string[];
}): Promise<Map<string, SupplyAndDemand>> {
  const { client, companyId, keys, todayByLocation } = args;
  const todayAt = (locationId: string | null) =>
    todayByLocation.get(locationId ?? "") ??
    todayByLocation.values().next().value ??
    "";
  const result = new Map<string, SupplyAndDemand>();
  for (const key of keys) {
    result.set(keyOf(key.itemId, key.locationId), {
      onHand: 0,
      supply: [],
      demand: []
    });
  }
  const itemIds = Array.from(new Set(keys.map((k) => k.itemId)));
  if (itemIds.length === 0) return result;
  const excluded = new Set(args.excludeSalesOrderLineIds);
  const entry = (itemId: string | null, locationId: string | null) =>
    itemId && locationId ? result.get(keyOf(itemId, locationId)) : undefined;

  const [stock, purchaseLines, productionOrders, salesLines, jobMaterials] =
    await Promise.all([
      fetchAll<{
        itemId: string;
        locationId: string;
        quantityOnHand: number;
        quantityNonNettable: number;
      }>(() =>
        client
          .from("itemStockQuantities")
          .select("itemId, locationId, quantityOnHand, quantityNonNettable")
          .eq("companyId", companyId)
          .eq("projectId", "")
          .in("itemId", itemIds)
          .order("itemId")
          .order("locationId")
      ),
      fetchAll<Database["public"]["Views"]["openPurchaseOrderLines"]["Row"]>(
        () =>
          client
            .from("openPurchaseOrderLines")
            .select("*")
            .eq("companyId", companyId)
            .in("itemId", itemIds)
            .order("id")
      ),
      fetchAll<Database["public"]["Views"]["openProductionOrders"]["Row"]>(() =>
        client
          .from("openProductionOrders")
          .select("*")
          .eq("companyId", companyId)
          .in("itemId", itemIds)
          .order("id")
      ),
      fetchAll<Database["public"]["Views"]["openSalesOrderLines"]["Row"]>(() =>
        client
          .from("openSalesOrderLines")
          .select("*")
          .eq("companyId", companyId)
          .in("itemId", itemIds)
          .order("id")
      ),
      fetchAll<Database["public"]["Views"]["openJobMaterialLines"]["Row"]>(() =>
        client
          .from("openJobMaterialLines")
          .select("*")
          .eq("companyId", companyId)
          .in("itemId", itemIds)
          .order("id")
      )
    ]);

  for (const read of [
    stock,
    purchaseLines,
    productionOrders,
    salesLines,
    jobMaterials
  ]) {
    if (read.error) throw read.error;
  }

  for (const row of stock.data ?? []) {
    const target = entry(row.itemId, row.locationId);
    if (target) {
      target.onHand +=
        Number(row.quantityOnHand) - Number(row.quantityNonNettable);
    }
  }

  for (const line of purchaseLines.data ?? []) {
    const target = entry(line.itemId, line.locationId);
    if (!target || !line.quantityToReceive) continue;
    if (!isCommon(line.planningSegmentId)) continue;
    target.supply.push({
      date: purchaseOrderLineArrivalDate(line, todayAt(line.locationId)),
      quantity: Number(line.quantityToReceive)
    });
  }

  for (const job of productionOrders.data ?? []) {
    const target = entry(job.itemId, job.locationId);
    if (!target || !job.quantityToReceive) continue;
    if (!isCommon(job.planningSegmentId)) continue;
    target.supply.push({
      date: jobCompletionDate(job, todayAt(job.locationId)),
      quantity: Number(job.quantityToReceive)
    });
  }

  for (const line of salesLines.data ?? []) {
    const target = entry(line.itemId, line.locationId);
    if (!target || !line.quantityToSend) continue;
    if (line.id && excluded.has(line.id)) continue;
    if (!isCommon(line.planningSegmentId)) continue;
    target.demand.push({
      date: line.promisedDate ?? todayAt(line.locationId),
      quantity: Number(line.quantityToSend)
    });
  }

  for (const line of jobMaterials.data ?? []) {
    const target = entry(line.itemId, line.locationId);
    if (!target || !line.quantityToIssue) continue;
    if (!isCommon(line.planningSegmentId)) continue;
    // MRP needs a job's material its lead time before the job is due.
    const due = parseDate(line.dueDate ?? todayAt(line.locationId));
    target.demand.push({
      date: due
        .subtract({ days: line.leadTime ?? DEFAULT_LEAD_TIME_DAYS })
        .toString(),
      quantity: Number(line.quantityToIssue)
    });
  }

  return result;
}

export const supplyAndDemandKey = keyOf;
