// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Database, getCompanyTimeZone } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { runQuoteLeadTimeWhatIf } from "../scheduling/quote-lead-time.ts";
import {
  type DatedQuantity,
  earliestWeekWithStock,
  freeStockBeforeArrivalByWeek,
  freeStockByWeek,
  lastArrivalByWeek,
  loadSupplyAndDemand,
  type SupplyAndDemand,
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
export type DeliveryLineMethod = Database["public"]["Enums"]["methodType"];

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
  /**
   * Free stock per week up to the fence, and the day the last supply of each
   * week arrives; given for a Pull from Inventory line under Stock or Capacity.
   */
  stock?: {
    weeks: string[];
    free: number[];
    arrivals?: (string | null)[];
    /** each week's free stock before that week's own supply arrives */
    freeBeforeArrival?: number[];
  };
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
 * made line, and otherwise the earliest date is the fence. No earliest date
 * is later than the fence, because every date from the fence on passes. A
 * promised date before today never passes. Returns `needsCapacity` when the
 * answer depends on a capacity run the caller has not made yet.
 */
export function decideDeliveryDate(
  input: DeliveryDecisionInput
): DeliveryDecision {
  const pastDue = input.promisedDate < input.todayIso;
  const decision = decideFromToday(
    pastDue ? { ...input, promisedDate: input.todayIso } : input
  );
  if (!pastDue || decision.needsCapacity || decision.status !== "Met") {
    return decision;
  }
  // The date is already gone: the best the check can offer is today.
  return {
    ...decision,
    status: "Missed",
    constraint: decision.constraint ?? "Lead Time",
    earliestDate: input.todayIso
  };
}

function decideFromToday(input: DeliveryDecisionInput): DeliveryDecision {
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
    earliestDate: earlier(later(earliestDate, todayIso), fenceDate),
    ...extra
  });

  if (promisedDate >= fenceDate || quantity <= 0) return met(null);

  const useCapacity = input.control === "Capacity" && input.canMake;
  const capacity = input.capacity;
  const capacityDate = capacity?.earliestDate ?? null;
  const capacityExtra = { cause: capacity?.cause ?? null };
  // A capacity finish after the fence gives way to the fence (lead time).
  const capacityConstraint = (date: string | null): DeliveryDateConstraint =>
    date !== null && date < fenceDate ? "Capacity" : "Lead Time";

  if (
    input.methodType === "Purchase to Order" ||
    input.control === "Lead Time"
  ) {
    return missed("Lead Time", fenceDate);
  }

  if (input.methodType === "Make to Order") {
    if (!useCapacity) return missed("Lead Time", fenceDate);
    if (!capacity) return { needsCapacity: true, shortfall: quantity };
    if (capacityDate !== null && capacityDate <= promisedDate) {
      return met("Capacity", capacityExtra);
    }
    return missed(
      capacityConstraint(capacityDate),
      capacityDate ?? fenceDate,
      capacityExtra
    );
  }

  // Pull from Inventory under Stock or Capacity: free stock first.
  const stock = input.stock ?? { weeks: [], free: [] };
  // Before a week's goods arrive, only the stock without them is free.
  const arrival = (week: number) => stock.arrivals?.[week] ?? null;
  const beforeArrival = (week: number) => stock.freeBeforeArrival?.[week] ?? 0;
  const promisedWeek = weekIndexOf(stock.weeks, promisedDate, todayIso);
  const promisedArrival = promisedWeek === null ? null : arrival(promisedWeek);
  const free =
    promisedWeek === null
      ? 0
      : promisedArrival !== null && promisedDate < promisedArrival
        ? beforeArrival(promisedWeek)
        : (stock.free[promisedWeek] ?? 0);
  const stockExtra = { freeQuantity: free };
  if (free >= quantity) return met("Stock", stockExtra);

  // A week covered only with its own supply is good from the day it comes.
  const stockWeek = earliestWeekWithStock(stock.free, quantity);
  const stockDate =
    stockWeek === null
      ? null
      : beforeArrival(stockWeek) >= quantity
        ? stock.weeks[stockWeek]!
        : later(
            stock.weeks[stockWeek]!,
            arrival(stockWeek) ?? stock.weeks[stockWeek]!
          );

  if (useCapacity) {
    if (!capacity) return { needsCapacity: true, shortfall: quantity - free };
    if (capacityDate !== null && capacityDate <= promisedDate) {
      return met("Capacity", { ...stockExtra, ...capacityExtra });
    }
    const makeDate =
      capacityDate === null ? fenceDate : earlier(capacityDate, fenceDate);
    if (stockDate !== null && stockDate <= makeDate) {
      return missed("Stock", stockDate, { ...stockExtra, ...capacityExtra });
    }
    return missed(capacityConstraint(capacityDate), makeDate, {
      ...stockExtra,
      ...capacityExtra
    });
  }

  return missed("Stock", stockDate ?? fenceDate, stockExtra);
}

/** Demand the caller knows of that the open-order views leave out. */
export type ExtraDemand = {
  itemId: string;
  locationId: string;
  date: string;
  quantity: number;
};

/**
 * Check each line's promised date (spec sections 2–5). Reads lead times and
 * stock once for all the lines. Lines of one item and location claim free
 * stock in promised-date order, so two lines never both take the same stock.
 * With `capacity: "defer"`, a line that needs the capacity simulation comes
 * back `Pending` and nothing slow runs; with `"skip"`, it is answered by its
 * lead time; with `"run"`, the simulation runs once per such line, one at a
 * time. Writes nothing.
 */
export async function checkDeliveryDates(args: {
  db: Kysely<DB>;
  client: SupabaseClient<Database>;
  companyId: string;
  userId: string;
  lines: DeliveryDateLine[];
  /** e.g. the other lines of an order that is not To Ship yet */
  extraDemand?: ExtraDemand[];
  capacity?: "run" | "defer" | "skip";
}): Promise<DeliveryDateResult[]> {
  const { db, client, companyId, userId, lines } = args;
  if (lines.length === 0) return [];

  const locationIds = Array.from(new Set(lines.map((l) => l.locationId)));
  const todayByLocation = await locationTodays(db, companyId, locationIds);

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

  const inputs = buildDecisionInputs({
    lines,
    todayByLocation,
    leadTimes,
    canMake,
    supplyAndDemand,
    extraDemand: args.extraDemand ?? []
  });
  const routings = new Map<string, ReturnType<typeof loadItemRouting>>();

  const results: DeliveryDateResult[] = [];
  for (const { line, input } of inputs) {
    let decision = decideDeliveryDate(input);
    if (decision.needsCapacity && args.capacity === "defer") {
      results.push({
        key: line.key,
        status: "Pending",
        constraint: null,
        earliestDate: null,
        fenceDate: parseDate(input.todayIso)
          .add({ days: input.leadTimeDays })
          .toString(),
        leadTimeDays: input.leadTimeDays,
        freeQuantity: null,
        cause: null
      });
      continue;
    }
    if (decision.needsCapacity && args.capacity === "skip") {
      decision = decideDeliveryDate({
        ...input,
        capacity: { earliestDate: null, cause: null }
      });
    }
    if (decision.needsCapacity) {
      let routing = routings.get(line.itemId);
      if (!routing) {
        routing = loadItemRouting(db, companyId, line.itemId);
        routings.set(line.itemId, routing);
      }
      const capacity = await capacityAnswer({
        db,
        client,
        companyId,
        userId,
        line,
        todayIso: input.todayIso,
        quantity: decision.shortfall,
        routing
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
 * Each line's decision input, in promised-date order. Lines of one item and
 * location claim free stock in that order: the caller's extra demand first,
 * then every line before it, on its promised date (today if that is gone).
 * So two lines never both take the same stock. Pure.
 */
export function buildDecisionInputs(args: {
  lines: DeliveryDateLine[];
  todayByLocation: Map<string, string>;
  leadTimes: Map<string, { own: number; cumulative: number }>;
  canMake: Set<string>;
  supplyAndDemand: Map<string, SupplyAndDemand>;
  extraDemand: ExtraDemand[];
}): { line: DeliveryDateLine; input: DeliveryDecisionInput }[] {
  const claimed = new Map<string, DatedQuantity[]>();
  const claim = (key: string, date: string, quantity: number) => {
    if (quantity <= 0) return;
    const list = claimed.get(key) ?? [];
    list.push({ date, quantity });
    claimed.set(key, list);
  };
  for (const demand of args.extraDemand) {
    claim(
      supplyAndDemandKey(demand.itemId, demand.locationId),
      demand.date,
      demand.quantity
    );
  }

  const ordered = [...args.lines].sort((a, b) =>
    a.promisedDate === b.promisedDate
      ? a.key.localeCompare(b.key)
      : a.promisedDate.localeCompare(b.promisedDate)
  );

  return ordered.map((line) => {
    const todayIso = args.todayByLocation.get(line.locationId)!;
    const times = args.leadTimes.get(line.itemId);
    const leadTimeDays =
      line.methodType === "Purchase to Order"
        ? (times?.own ?? 0)
        : (times?.cumulative ?? 0);
    const fenceDate = parseDate(todayIso)
      .add({ days: leadTimeDays })
      .toString();

    const flowKey = supplyAndDemandKey(line.itemId, line.locationId);
    const flows =
      line.control !== "Lead Time" && line.methodType === "Pull from Inventory"
        ? args.supplyAndDemand.get(flowKey)
        : undefined;
    let stock: DeliveryDecisionInput["stock"];
    if (flows) {
      const weeks = weekStarts(todayIso, fenceDate);
      const weekly = {
        onHand: flows.onHand,
        supply: flows.supply,
        demand: [...flows.demand, ...(claimed.get(flowKey) ?? [])],
        weeks,
        todayIso
      };
      stock = {
        weeks,
        free: freeStockByWeek(weekly),
        arrivals: lastArrivalByWeek(weeks, flows.supply, todayIso),
        freeBeforeArrival: freeStockBeforeArrivalByWeek(weekly)
      };
      claim(flowKey, later(line.promisedDate, todayIso), line.quantity);
    }

    return {
      line,
      input: {
        key: line.key,
        control: line.control,
        methodType: line.methodType,
        todayIso,
        promisedDate: line.promisedDate,
        quantity: line.quantity,
        leadTimeDays,
        stock,
        canMake: args.canMake.has(line.itemId)
      }
    };
  });
}

/** Today at each location, in one read: the location's zone, else the company's. */
async function locationTodays(
  db: Kysely<DB>,
  companyId: string,
  locationIds: string[]
): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom("location")
    .select(["id", "timezone"])
    .where("id", "in", locationIds)
    .where("companyId", "=", companyId)
    .execute();
  const zoneById = new Map(rows.map((row) => [row.id, row.timezone]));
  let companyZone: string | null = null;
  const result = new Map<string, string>();
  for (const locationId of locationIds) {
    let zone = zoneById.get(locationId) || null;
    if (!zone) {
      companyZone ??= await getCompanyTimeZone(db, companyId);
      zone = companyZone;
    }
    result.set(locationId, datetime.today(zone).toString());
  }
  return result;
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
  /** the item's routing load, shared by every line of the item */
  routing: ReturnType<typeof loadItemRouting>;
}): Promise<CapacityAnswer> {
  const { db, client, companyId, userId, line, todayIso, quantity } = args;
  try {
    const routing = await args.routing;
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
