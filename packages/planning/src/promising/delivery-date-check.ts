// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Database, getLocationTimeZone } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { runQuoteLeadTimeWhatIf } from "../scheduling/quote-lead-time.ts";
import {
  earliestWeekWithStock,
  freeStockByWeek,
  loadSupplyAndDemand,
  supplyAndDemandKey,
  weekIndexOf,
  weekStarts
} from "./available-to-promise.ts";
import { loadCumulativeLeadTimes } from "./cumulative-lead-time.ts";
import { loadItemRouting } from "./item-routing.ts";

const logger = getLogger("planning", "promising");

export type DeliveryDateControl =
  Database["public"]["Enums"]["deliveryDateControl"];
export type DeliveryDateConstraint =
  Database["public"]["Enums"]["deliveryDateConstraint"];
export type DeliveryDateStatus =
  Database["public"]["Enums"]["deliveryDateStatus"];
export type DeliveryLineMethod =
  | "Pull from Inventory"
  | "Make to Order"
  | "Purchase to Order";

/** One line to check. `key` comes back on its result. */
export type DeliveryDateLine = {
  key: string;
  /** an existing sales order line, left out of the demand it is checked against */
  salesOrderLineId?: string | null;
  itemId: string;
  locationId: string;
  /** the quantity still to ship */
  quantity: number;
  promisedDate: string;
  methodType: DeliveryLineMethod;
  control: Exclude<DeliveryDateControl, "None">;
};

export type DeliveryDateResult = {
  key: string;
  status: DeliveryDateStatus;
  /** the check that set the earliest date; null when the line passes outside the fence */
  constraint: DeliveryDateConstraint | null;
  /** the earliest date the check can promise; null when the line passes */
  earliestDate: string | null;
  /** today + the lead time that bounds the check */
  fenceDate: string;
  /** the lead time behind the fence: cumulative through the BOM, or a bought line's own */
  leadTimeDays: number;
  /** free stock in the promised week, when the stock check ran */
  freeQuantity: number | null;
  /** the capacity engine's cause sentence, when the capacity check ran */
  cause: string | null;
};

/** What the capacity check found: null `earliestDate` means no routing to schedule. */
export type CapacityAnswer = {
  earliestDate: string | null;
  cause: string | null;
};

export type DeliveryDecisionInput = {
  key: string;
  control: DeliveryDateLine["control"];
  methodType: DeliveryLineMethod;
  todayIso: string;
  promisedDate: string;
  quantity: number;
  leadTimeDays: number;
  /** free stock per week up to the fence; given for a Pull from Inventory line under Stock or Capacity */
  stock?: { weeks: string[]; free: number[] };
  /** the capacity answer; undefined while it has not run */
  capacity?: CapacityAnswer;
  /** false for an item with no make method, so capacity cannot help */
  canMake: boolean;
};

export type DeliveryDecision =
  | { needsCapacity: true; shortfall: number }
  | ({ needsCapacity: false } & DeliveryDateResult);

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/**
 * Decide one line's delivery date (spec section 3). Outside the fence a line
 * passes: the factory still has the time to buy and make it. Inside it,
 * stock can cover a Pull from Inventory line, the shop's capacity can cover a
 * made line, and otherwise the earliest date is the fence. Returns
 * `needsCapacity` when the answer depends on a capacity run the caller has
 * not made yet.
 */
export function decideDeliveryDate(
  input: DeliveryDecisionInput
): DeliveryDecision {
  const { todayIso, promisedDate, quantity, leadTimeDays } = input;
  const fenceDate = parseDate(todayIso).add({ days: leadTimeDays }).toString();
  const base = {
    key: input.key,
    fenceDate,
    leadTimeDays,
    freeQuantity: null as number | null,
    cause: null as string | null
  };
  const met = (
    constraint: DeliveryDateConstraint | null,
    extra: Partial<DeliveryDateResult> = {}
  ): DeliveryDecision => ({
    needsCapacity: false,
    ...base,
    status: "Met",
    constraint,
    earliestDate: null,
    ...extra
  });
  const missed = (
    constraint: DeliveryDateConstraint,
    earliestDate: string,
    extra: Partial<DeliveryDateResult> = {}
  ): DeliveryDecision => ({
    needsCapacity: false,
    ...base,
    status: "Missed",
    constraint,
    earliestDate: later(earliestDate, todayIso),
    ...extra
  });

  if (promisedDate >= fenceDate || quantity <= 0) return met(null);

  const useCapacity = input.control === "Capacity" && input.canMake;
  const capacity = input.capacity;
  const capacityDate = capacity?.earliestDate ?? null;
  const capacityExtra = { cause: capacity?.cause ?? null };

  if (
    input.methodType === "Purchase to Order" ||
    input.control === "Lead Time"
  ) {
    return missed("Lead Time", fenceDate);
  }

  if (input.methodType === "Make to Order") {
    if (!useCapacity) return missed("Lead Time", fenceDate);
    if (!capacity) return { needsCapacity: true, shortfall: quantity };
    if (capacityDate === null) return missed("Lead Time", fenceDate);
    return capacityDate <= promisedDate
      ? met("Capacity", capacityExtra)
      : missed("Capacity", capacityDate, capacityExtra);
  }

  // Pull from Inventory under Stock or Capacity: free stock first.
  const stock = input.stock ?? { weeks: [], free: [] };
  const promisedWeek = weekIndexOf(stock.weeks, promisedDate, todayIso);
  const free = promisedWeek === null ? 0 : (stock.free[promisedWeek] ?? 0);
  const stockExtra = { freeQuantity: free };
  if (free >= quantity) return met("Stock", stockExtra);

  const stockWeek = earliestWeekWithStock(stock.free, quantity);
  const stockDate =
    stockWeek === null ? null : later(stock.weeks[stockWeek]!, todayIso);

  if (useCapacity) {
    if (!capacity) return { needsCapacity: true, shortfall: quantity - free };
    if (capacityDate !== null && capacityDate <= promisedDate) {
      return met("Capacity", { ...stockExtra, ...capacityExtra });
    }
    const makeDate = capacityDate ?? fenceDate;
    if (stockDate !== null && stockDate <= makeDate) {
      return missed("Stock", stockDate, { ...stockExtra, ...capacityExtra });
    }
    return missed(capacityDate === null ? "Lead Time" : "Capacity", makeDate, {
      ...stockExtra,
      ...capacityExtra
    });
  }

  return missed(
    "Stock",
    stockDate ? earlier(stockDate, fenceDate) : fenceDate,
    stockExtra
  );
}

/**
 * Check each line's promised date (spec sections 2–5). Reads lead times and
 * stock once for all the lines; runs the capacity engine only for a line whose
 * answer needs it, one line at a time. Writes nothing.
 */
export async function checkDeliveryDates(args: {
  db: Kysely<DB>;
  client: SupabaseClient<Database>;
  companyId: string;
  userId: string;
  lines: DeliveryDateLine[];
}): Promise<DeliveryDateResult[]> {
  const { db, client, companyId, userId, lines } = args;
  if (lines.length === 0) return [];

  const locationIds = Array.from(new Set(lines.map((l) => l.locationId)));
  const todayByLocation = new Map<string, string>();
  for (const locationId of locationIds) {
    const timeZone = await getLocationTimeZone(db, locationId, companyId);
    todayByLocation.set(locationId, datetime.today(timeZone).toString());
  }

  const itemIds = Array.from(new Set(lines.map((l) => l.itemId)));
  const [leadTimes, makeable] = await Promise.all([
    loadCumulativeLeadTimes(db, companyId, itemIds),
    db
      .selectFrom("item")
      .select(["id", "replenishmentSystem"])
      .where("id", "in", itemIds)
      .where("companyId", "=", companyId)
      .execute()
  ]);
  const canMake = new Set(
    makeable.filter((i) => i.replenishmentSystem !== "Buy").map((i) => i.id)
  );

  const stockLines = lines.filter(
    (l) => l.control !== "Lead Time" && l.methodType === "Pull from Inventory"
  );
  const supplyAndDemand =
    stockLines.length > 0
      ? await loadSupplyAndDemand({
          client,
          companyId,
          keys: stockLines.map((l) => ({
            itemId: l.itemId,
            locationId: l.locationId
          })),
          todayByLocation,
          excludeSalesOrderLineIds: lines
            .map((l) => l.salesOrderLineId)
            .filter((id): id is string => Boolean(id))
        })
      : new Map();

  const results: DeliveryDateResult[] = [];
  for (const line of lines) {
    const todayIso = todayByLocation.get(line.locationId)!;
    const times = leadTimes.get(line.itemId);
    const leadTimeDays =
      line.methodType === "Purchase to Order"
        ? (times?.own ?? 0)
        : (times?.cumulative ?? 0);
    const fenceDate = parseDate(todayIso)
      .add({ days: leadTimeDays })
      .toString();

    let stock: DeliveryDecisionInput["stock"];
    const flows = supplyAndDemand.get(
      supplyAndDemandKey(line.itemId, line.locationId)
    );
    if (flows) {
      const weeks = weekStarts(todayIso, fenceDate);
      stock = {
        weeks,
        free: freeStockByWeek({ ...flows, weeks, todayIso })
      };
    }

    const input: DeliveryDecisionInput = {
      key: line.key,
      control: line.control,
      methodType: line.methodType,
      todayIso,
      promisedDate: line.promisedDate,
      quantity: line.quantity,
      leadTimeDays,
      stock,
      canMake: canMake.has(line.itemId)
    };

    let decision = decideDeliveryDate(input);
    if (decision.needsCapacity) {
      const capacity = await capacityAnswer({
        db,
        client,
        companyId,
        userId,
        line,
        todayIso,
        quantity: decision.shortfall
      });
      decision = decideDeliveryDate({ ...input, capacity });
    }
    if (decision.needsCapacity) continue; // unreachable: capacity is set
    const { needsCapacity: _, ...result } = decision;
    results.push(result);
  }
  return results;
}

/**
 * The capacity engine's end-of-queue finish for an item's own routing, as a
 * date at the location. A failed run counts as "no routing", so the line
 * falls back to the fence rather than blocking the check.
 */
async function capacityAnswer(args: {
  db: Kysely<DB>;
  client: SupabaseClient<Database>;
  companyId: string;
  userId: string;
  line: DeliveryDateLine;
  todayIso: string;
  quantity: number;
}): Promise<CapacityAnswer> {
  const { db, client, companyId, userId, line, todayIso, quantity } = args;
  try {
    const routing = await loadItemRouting(db, companyId, line.itemId);
    if (!routing) return { earliestDate: null, cause: null };
    const forecast = await runQuoteLeadTimeWhatIf({
      db,
      client,
      companyId,
      userId,
      locationId: line.locationId,
      quoteLineId: `salesOrderLine:${line.key}`,
      quantities: [quantity],
      routing
    });
    const queued = forecast?.quantities[0]?.queued;
    if (!queued || queued.leadTimeDays === null) {
      return { earliestDate: null, cause: null };
    }
    return {
      earliestDate: parseDate(todayIso)
        .add({ days: queued.leadTimeDays })
        .toString(),
      cause: queued.cause
    };
  } catch (error) {
    logger.error("Delivery date capacity check failed", {
      companyId,
      itemId: line.itemId,
      error
    });
    return { earliestDate: null, cause: null };
  }
}
