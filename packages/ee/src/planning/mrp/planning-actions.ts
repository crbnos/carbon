// Planning action messages (spec §P1) — the persisted, assignable output of an
// MRP run. One row per suggested action:
//
//   Order / Make          — create new supply (from the shared reorder sizing)
//   Expedite / Defer      — move an existing open PO line / job (date)
//   Increase / Decrease   — change an existing order's quantity
//   Cancel                — an existing order has no remaining requirement
//
// Change actions follow the SAP "rescheduling check on a firmed receipt" model:
// open orders are matched to dated requirements chronologically; a date gap
// STRICTLY greater than companySettings.rescheduleToleranceDays fires
// Expedite/Defer; exactly ONE action is emitted per target document
// (Cancel → Expedite/Defer → Increase/Decrease).
//
// Persistence is a DIFF-WRITE keyed on the natural key (item, location, type,
// period, target document): Open rows update in place (a human-overridden
// assignee is never re-resolved), Dismissed rows stay dismissed unless the
// suggestion changed materially, vanished Open/Dismissed rows are deleted so a
// returning need re-surfaces, and Actioned rows are terminal. Failures
// PROPAGATE to the caller — a run must not report success with stale actions.

import type { Database } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { datetime, getCompanyTimeZone } from "@carbon/database/datetime";
import { fetchAll } from "@carbon/database/fetch-all";
import { getFunctionLogger } from "@carbon/database/logging";
import { computePlanningOrders } from "@carbon/utils";
import { parseDate, startOfWeek } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { toIsoDate } from "../scheduling/date-utils.ts";
import { loadResponsibleEmployeeResolver } from "./responsible-employee.ts";

const logger = getFunctionLogger("planning-actions");

const KEY_SEP = "\x1f";
const WEEKS_TO_PLAN = 48;
const BATCH_SIZE = 500;

export type PlanningActionType =
  | "Order"
  | "Make"
  | "Expedite"
  | "Defer"
  | "Cancel"
  | "Increase"
  | "Decrease";

export type PlanningActionCandidate = {
  itemId: string;
  locationId: string;
  periodId: string;
  type: PlanningActionType;
  suggestedQuantity: number;
  suggestedDate: string;
  isASAP: boolean;
  purchaseOrderLineId: string | null;
  jobId: string | null;
  requiresManualAction: boolean;
  supplierId: string | null;
  policyName: string | null;
  reason: string | null;
  triggerValues: Record<string, number | null | undefined> | null;
  assignee: string | null;
};

export type ExistingPlanningAction = {
  id: string;
  itemId: string;
  locationId: string;
  periodId: string;
  type: PlanningActionType;
  status: "Open" | "Dismissed";
  suggestedQuantity: number;
  suggestedDate: string;
  isASAP: boolean;
  purchaseOrderLineId: string | null;
  jobId: string | null;
  requiresManualAction: boolean;
  supplierId: string | null;
  policyName: string | null;
  reason: string | null;
  triggerValues: unknown;
  assignee: string | null;
  assigneeOverridden: boolean;
};

/** Signed day difference a − b for two ISO calendar dates. */
export function daysBetween(a: string, b: string): number {
  return parseDate(a).compare(parseDate(b));
}

/**
 * The view only yields open POs ('Planned' | 'To Receive' | 'To Receive and
 * Invoice'); anything past 'Planned'/'Draft' has been sent to the supplier
 * (mirrors PURCHASE_ORDER_LOCKED_STATUSES in purchasing.models.ts). Never gate
 * on orderDate — insertPurchaseOrder defaults it to today for planned POs.
 */
export function isCommittedPurchaseOrderStatus(status: string): boolean {
  return status !== "Planned" && status !== "Draft";
}

/** Job statuses at/after release-to-floor are committed supply. */
export function isCommittedJobStatus(status: string): boolean {
  return status === "Ready" || status === "In Progress" || status === "Paused";
}

export type OpenSupplyOrder = {
  purchaseOrderLineId?: string;
  jobId?: string;
  quantity: number;
  /** the date the order is currently expected to land (ISO) */
  dueDate: string;
  requiresManualAction: boolean;
  supplierId?: string | null;
};

export type DeriveChangeActionsInput = {
  onHand: number;
  /** total demand per period, chronological */
  demandPeriods: { periodId: string; startDate: string; quantity: number }[];
  openOrders: OpenSupplyOrder[];
  /** all planning periods, chronological (for mapping a date to a period) */
  periods: { id: string; startDate: string }[];
  /**
   * The reorder policy's terminal stock target (safety stock / reorder point).
   * Orders covering the floor are legitimately held stock: floor coverage
   * prevents Cancel/Decrease but never generates a date (Expedite/Defer) need.
   */
  policyFloor: number;
  toleranceDays: number;
  todayDate: string;
};

type ChangeCandidate = Omit<
  PlanningActionCandidate,
  "itemId" | "locationId" | "assignee"
>;

/**
 * SAP-style rescheduling check over one item+location. Walks demand
 * chronologically against on-hand, consuming open orders (earliest first) as
 * the balance goes negative; each order's FIRST covered requirement dates it.
 * Emits at most ONE action per open order:
 *   consumed = 0                        → Cancel
 *   |due − firstNeed| > toleranceDays   → Expedite / Defer
 *   leftover quantity (no date action)  → Decrease
 */
export function deriveChangeActions(
  input: DeriveChangeActionsInput
): ChangeCandidate[] {
  const {
    onHand,
    demandPeriods,
    openOrders,
    periods,
    policyFloor,
    toleranceDays,
    todayDate
  } = input;

  if (openOrders.length === 0) return [];

  const periodFor = (dateIso: string): { id: string; startDate: string } => {
    let match = periods[0];
    for (const p of periods) {
      if (daysBetween(p.startDate, dateIso) <= 0) match = p;
      else break;
    }
    return match ?? { id: "", startDate: dateIso };
  };

  const orders = openOrders
    .map((order) => ({
      order,
      consumed: 0,
      firstNeed: null as { periodId: string; startDate: string } | null
    }))
    .sort((a, b) => daysBetween(a.order.dueDate, b.order.dueDate));

  // Chronological consumption walk: demand draws down on-hand first, then the
  // earliest open orders. The first requirement an order covers is its need date.
  let balance = onHand;
  let cursor = 0;
  for (const demand of demandPeriods) {
    balance -= demand.quantity;
    while (balance < 0 && cursor < orders.length) {
      const state = orders[cursor];
      if (!state) break;
      const available = state.order.quantity - state.consumed;
      if (available <= 0) {
        cursor++;
        continue;
      }
      const take = Math.min(available, -balance);
      state.consumed += take;
      balance += take;
      if (!state.firstNeed) {
        state.firstNeed = {
          periodId: demand.periodId,
          startDate: demand.startDate
        };
      }
      if (state.consumed >= state.order.quantity) cursor++;
    }
  }

  // The policy floor consumes remaining order quantity WITHOUT dating it —
  // stock held for safety/reorder targets is intentional, not cancellable.
  let floorRemaining = Math.max(0, policyFloor - Math.max(balance, 0));
  for (const state of orders) {
    if (floorRemaining <= 0) break;
    const available = state.order.quantity - state.consumed;
    if (available <= 0) continue;
    const take = Math.min(available, floorRemaining);
    state.consumed += take;
    floorRemaining -= take;
  }

  const actions: ChangeCandidate[] = [];
  for (const { order, consumed, firstNeed } of orders) {
    const target = {
      purchaseOrderLineId: order.purchaseOrderLineId ?? null,
      jobId: order.jobId ?? null,
      requiresManualAction: order.requiresManualAction,
      supplierId: order.supplierId ?? null,
      policyName: null,
      triggerValues: null
    };

    if (consumed <= 0) {
      const period = periodFor(order.dueDate);
      actions.push({
        ...target,
        type: "Cancel",
        periodId: period.id,
        suggestedQuantity: order.quantity,
        suggestedDate: order.dueDate,
        isASAP: false,
        reason: "No remaining requirement for this order"
      });
      continue;
    }

    if (firstNeed) {
      // gap > 0: the order lands AFTER it is needed
      const gap = daysBetween(order.dueDate, firstNeed.startDate);
      if (gap > toleranceDays) {
        actions.push({
          ...target,
          type: "Expedite",
          periodId: firstNeed.periodId,
          suggestedQuantity: order.quantity,
          suggestedDate: firstNeed.startDate,
          isASAP: daysBetween(firstNeed.startDate, todayDate) < 0,
          reason: `Needed ${gap} days earlier than its current date`
        });
        continue;
      }
      if (gap < -toleranceDays) {
        actions.push({
          ...target,
          type: "Defer",
          periodId: firstNeed.periodId,
          suggestedQuantity: order.quantity,
          suggestedDate: firstNeed.startDate,
          isASAP: false,
          reason: `Not needed until ${-gap} days after its current date`
        });
        continue;
      }
    }

    const leftover = order.quantity - consumed;
    if (leftover > 0) {
      const period = periodFor(order.dueDate);
      actions.push({
        ...target,
        type: "Decrease",
        periodId: period.id,
        suggestedQuantity: consumed,
        suggestedDate: order.dueDate,
        isASAP: false,
        reason: `Only ${consumed} of ${order.quantity} is required`
      });
    }
  }

  return actions;
}

/**
 * Fold a new-supply suggestion into an existing open order landing in the same
 * window: instead of "create another order" AND leaving the existing one
 * unchanged, emit ONE Increase on that order (to existing + suggested). Only
 * orders that received no other action are eligible — one action per target.
 */
export function convertOrdersToIncreases(args: {
  sizingCandidates: ChangeCandidate[];
  openOrders: OpenSupplyOrder[];
  changeActions: ChangeCandidate[];
  toleranceDays: number;
}): ChangeCandidate[] {
  const { sizingCandidates, openOrders, changeActions, toleranceDays } = args;

  const targeted = new Set(
    changeActions.map((a) => a.purchaseOrderLineId ?? a.jobId ?? "")
  );
  const used = new Set<string>();

  return sizingCandidates.map((candidate) => {
    if (candidate.type !== "Order" && candidate.type !== "Make") {
      return candidate;
    }
    const match = openOrders.find((order) => {
      const ref = order.purchaseOrderLineId ?? order.jobId ?? "";
      if (!ref || targeted.has(ref) || used.has(ref)) return false;
      const isBuy = Boolean(order.purchaseOrderLineId);
      if (candidate.type === "Order" && !isBuy) return false;
      if (candidate.type === "Make" && isBuy) return false;
      return (
        Math.abs(daysBetween(order.dueDate, candidate.suggestedDate)) <=
        toleranceDays
      );
    });
    if (!match) return candidate;
    used.add(match.purchaseOrderLineId ?? match.jobId ?? "");
    return {
      ...candidate,
      type: "Increase",
      purchaseOrderLineId: match.purchaseOrderLineId ?? null,
      jobId: match.jobId ?? null,
      requiresManualAction: match.requiresManualAction,
      suggestedQuantity: match.quantity + candidate.suggestedQuantity,
      reason: `Increase from ${match.quantity} to cover a shortfall of ${candidate.suggestedQuantity}`
    };
  });
}

export function naturalKey(action: {
  itemId: string;
  locationId: string;
  type: string;
  periodId: string;
  purchaseOrderLineId: string | null;
  jobId: string | null;
}): string {
  return [
    action.itemId,
    action.locationId,
    action.type,
    action.periodId,
    action.purchaseOrderLineId ?? action.jobId ?? ""
  ].join(KEY_SEP);
}

export type PlanningActionDiff = {
  inserts: PlanningActionCandidate[];
  updates: {
    id: string;
    patch: Record<string, unknown>;
  }[];
  deleteIds: string[];
};

/**
 * Diff-write plan: never delete-and-recreate — assignment and dismissal state
 * must survive a run. Two identical consecutive runs produce zero changes.
 */
export function diffPlanningActions(args: {
  existing: ExistingPlanningAction[];
  candidates: PlanningActionCandidate[];
  toleranceDays: number;
}): PlanningActionDiff {
  const { existing, candidates, toleranceDays } = args;

  const existingByKey = new Map(existing.map((e) => [naturalKey(e), e]));
  const seen = new Set<string>();

  const inserts: PlanningActionCandidate[] = [];
  const updates: PlanningActionDiff["updates"] = [];

  for (const candidate of candidates) {
    const key = naturalKey(candidate);
    if (seen.has(key)) continue; // one action per natural key
    seen.add(key);

    const current = existingByKey.get(key);
    if (!current) {
      inserts.push(candidate);
      continue;
    }

    const materialChange =
      current.suggestedQuantity !== candidate.suggestedQuantity ||
      Math.abs(daysBetween(current.suggestedDate, candidate.suggestedDate)) >
        toleranceDays;

    if (current.status === "Dismissed" && !materialChange) {
      // dismissed suppresses a persisting, unchanged need
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (current.status === "Dismissed") patch.status = "Open";
    if (current.suggestedQuantity !== candidate.suggestedQuantity) {
      patch.suggestedQuantity = candidate.suggestedQuantity;
    }
    if (current.suggestedDate !== candidate.suggestedDate) {
      patch.suggestedDate = candidate.suggestedDate;
    }
    if (current.isASAP !== candidate.isASAP) patch.isASAP = candidate.isASAP;
    if (current.requiresManualAction !== candidate.requiresManualAction) {
      patch.requiresManualAction = candidate.requiresManualAction;
    }
    if ((current.supplierId ?? null) !== candidate.supplierId) {
      patch.supplierId = candidate.supplierId;
    }
    if ((current.policyName ?? null) !== candidate.policyName) {
      patch.policyName = candidate.policyName;
    }
    if ((current.reason ?? null) !== candidate.reason) {
      patch.reason = candidate.reason;
    }
    if (
      JSON.stringify(current.triggerValues ?? null) !==
      JSON.stringify(candidate.triggerValues ?? null)
    ) {
      patch.triggerValues = candidate.triggerValues;
    }
    if (
      !current.assigneeOverridden &&
      (current.assignee ?? null) !== candidate.assignee
    ) {
      patch.assignee = candidate.assignee;
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ id: current.id, patch });
    }
  }

  const deleteIds = existing
    .filter((e) => !seen.has(naturalKey(e)))
    .map((e) => e.id);

  return { inserts, updates, deleteIds };
}

// ──────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────

type RpcPlanningRow =
  Database["public"]["Functions"]["get_purchasing_planning"]["Returns"][number];
type ProductionPlanningRow =
  Database["public"]["Functions"]["get_production_planning"]["Returns"][number];

function policyFloorFor(row: {
  reorderingPolicy: string;
  demandAccumulationSafetyStock: number;
  reorderPoint: number;
  supersessionMode: string | null;
  minimumReserveQuantity: number;
}): number {
  if (row.supersessionMode === "Stock Only") {
    return Number(row.minimumReserveQuantity) || 0;
  }
  switch (row.reorderingPolicy) {
    case "Demand-Based Reorder":
      return Number(row.demandAccumulationSafetyStock) || 0;
    case "Fixed Reorder Quantity":
    case "Maximum Quantity":
      return Number(row.reorderPoint) || 0;
    default:
      return 0;
  }
}

export async function generatePlanningActions(
  client: SupabaseClient<Database>,
  db: Kysely<DB>,
  args: { companyId: string; userId: string }
): Promise<{ inserted: number; updated: number; deleted: number }> {
  const { companyId, userId } = args;

  const timeZone = await getCompanyTimeZone(db, companyId);
  const todayDate = datetime.today(timeZone).toString();
  const weekStart = startOfWeek(datetime.today(timeZone), "en-US").toString();

  const [settings, locations, periodRows] = await Promise.all([
    db
      .selectFrom("companySettings")
      .select(["rescheduleToleranceDays"])
      .where("id", "=", companyId)
      .executeTakeFirst(),
    db
      .selectFrom("location")
      .select(["id"])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("period")
      .select(["id", "startDate"])
      .where("periodType", "=", "Week")
      .where("startDate", ">=", weekStart)
      .orderBy("startDate", "asc")
      .limit(WEEKS_TO_PLAN)
      .execute()
  ]);

  const toleranceDays = Number(settings?.rescheduleToleranceDays ?? 7);
  const periods = periodRows.map((p) => ({
    id: p.id,
    startDate: toIsoDate(p.startDate as unknown as string | Date)!
  }));
  const periodIds = periods.map((p) => p.id);
  const periodIdSet = new Set(periodIds);
  const periodById = new Map(periods.map((p) => [p.id, p]));

  if (periods.length === 0 || locations.length === 0) {
    return { inserted: 0, updated: 0, deleted: 0 };
  }

  const resolveAssignee = await loadResponsibleEmployeeResolver(db, companyId);

  // ── demand per (item, location, period): actual + forecast + projection,
  //    the same union the planning RPCs read
  const [demandActuals, demandForecasts, demandProjections] = await Promise.all(
    [
      db
        .selectFrom("demandActual")
        .select(["itemId", "locationId", "periodId", "actualQuantity"])
        .where("companyId", "=", companyId)
        .execute(),
      db
        .selectFrom("demandForecast")
        .select(["itemId", "locationId", "periodId", "forecastQuantity"])
        .where("companyId", "=", companyId)
        .execute(),
      db
        .selectFrom("demandProjection")
        .select(["itemId", "locationId", "periodId", "forecastQuantity"])
        .where("companyId", "=", companyId)
        .execute()
    ]
  );

  const demandByItemLocation = new Map<string, Map<string, number>>();
  const addDemand = (
    itemId: string | null,
    locationId: string | null,
    periodId: string | null,
    quantity: number | null
  ) => {
    if (!itemId || !locationId || !periodId) return;
    if (!periodIdSet.has(periodId)) return;
    const key = `${itemId}${KEY_SEP}${locationId}`;
    const byPeriod = demandByItemLocation.get(key) ?? new Map<string, number>();
    byPeriod.set(
      periodId,
      (byPeriod.get(periodId) ?? 0) + (Number(quantity) || 0)
    );
    demandByItemLocation.set(key, byPeriod);
  };
  for (const row of demandActuals) {
    addDemand(row.itemId, row.locationId, row.periodId, row.actualQuantity);
  }
  for (const row of demandForecasts) {
    addDemand(row.itemId, row.locationId, row.periodId, row.forecastQuantity);
  }
  for (const row of demandProjections) {
    addDemand(row.itemId, row.locationId, row.periodId, row.forecastQuantity);
  }

  // ── on-hand
  const inventoryRows = await db
    .selectFrom("itemStockQuantities")
    .select(["itemId", "locationId", "quantityOnHand"])
    .where("companyId", "=", companyId)
    .execute();
  const onHandByItemLocation = new Map<string, number>();
  for (const row of inventoryRows) {
    if (row.itemId && row.locationId) {
      onHandByItemLocation.set(
        `${row.itemId}${KEY_SEP}${row.locationId}`,
        Number(row.quantityOnHand) || 0
      );
    }
  }

  // ── open supply (real documents change actions target)
  const openPoLines = await fetchAll<
    Database["public"]["Views"]["openPurchaseOrderLines"]["Row"]
  >(() =>
    client
      .from("openPurchaseOrderLines")
      .select("*")
      .eq("companyId", companyId)
      .order("id")
  );

  const openJobs = await fetchAll<
    Database["public"]["Views"]["openProductionOrders"]["Row"]
  >(() =>
    client
      .from("openProductionOrders")
      .select("*")
      .eq("companyId", companyId)
      .order("id")
  );

  if (openPoLines.error) throw openPoLines.error;
  if (openJobs.error) throw openJobs.error;
  const poLineRows = openPoLines.data ?? [];
  const jobRows = openJobs.data ?? [];

  // openProductionOrders does not expose job status — bulk-read it
  const jobIds = jobRows.map((j) => j.id).filter(Boolean) as string[];
  const jobStatusById = new Map<string, string>();
  for (let i = 0; i < jobIds.length; i += BATCH_SIZE) {
    const chunk = jobIds.slice(i, i + BATCH_SIZE);
    const rows = await db
      .selectFrom("job")
      .select(["id", "status"])
      .where("companyId", "=", companyId)
      .where("id", "in", chunk)
      .execute();
    for (const row of rows) {
      if (row.status) jobStatusById.set(row.id, row.status);
    }
  }

  const openOrdersByItemLocation = new Map<string, OpenSupplyOrder[]>();
  const pushOrder = (key: string, order: OpenSupplyOrder) => {
    const list = openOrdersByItemLocation.get(key) ?? [];
    list.push(order);
    openOrdersByItemLocation.set(key, list);
  };
  for (const line of poLineRows) {
    if (!line.id || !line.itemId || !line.locationId) continue;
    const quantity = Number(line.quantityToReceive) || 0;
    if (quantity <= 0) continue;
    const dueDate =
      line.dueDate ??
      line.promisedDate ??
      (line.orderDate
        ? parseDate(line.orderDate)
            .add({ days: Number(line.leadTime) || 0 })
            .toString()
        : null);
    if (!dueDate) continue;
    pushOrder(`${line.itemId}${KEY_SEP}${line.locationId}`, {
      purchaseOrderLineId: line.id,
      quantity,
      dueDate,
      requiresManualAction: isCommittedPurchaseOrderStatus(line.status ?? ""),
      supplierId: line.supplierId
    });
  }
  for (const job of jobRows) {
    if (!job.id || !job.itemId || !job.locationId) continue;
    const quantity = Number(job.quantityToReceive) || 0;
    if (quantity <= 0 || !job.dueDate) continue;
    pushOrder(`${job.itemId}${KEY_SEP}${job.locationId}`, {
      jobId: job.id,
      quantity,
      dueDate: job.dueDate,
      requiresManualAction: isCommittedJobStatus(
        jobStatusById.get(job.id) ?? ""
      )
    });
  }

  // ── planning rows (projections + reorder params) per location
  const candidates: PlanningActionCandidate[] = [];

  for (const location of locations) {
    const [purchasing, production] = await Promise.all([
      client.rpc("get_purchasing_planning", {
        company_id: companyId,
        location_id: location.id,
        periods: periodIds
      }),
      client.rpc("get_production_planning", {
        company_id: companyId,
        location_id: location.id,
        periods: periodIds
      })
    ]);
    if (purchasing.error) throw new Error(purchasing.error.message);
    if (production.error) throw new Error(production.error.message);

    const process = (
      row: RpcPlanningRow | ProductionPlanningRow,
      kind: "Order" | "Make"
    ) => {
      const itemLocationKey = `${row.id}${KEY_SEP}${location.id}`;
      const openOrders = openOrdersByItemLocation.get(itemLocationKey) ?? [];

      // new-supply suggestions from the shared sizing (same math as the grid)
      let sizing: ChangeCandidate[] = [];
      if (row.supersessionMode === "Stock Only") {
        const shortfall = Math.max(0, Number(row.quantityToOrder) || 0);
        const firstPeriod = periods[0];
        if (shortfall > 0 && firstPeriod) {
          const startDate = parseDate(firstPeriod.startDate)
            .subtract({ days: Number(row.leadTime) || 0 })
            .toString();
          sizing = [
            {
              type: kind,
              periodId: firstPeriod.id,
              suggestedQuantity: shortfall,
              suggestedDate: firstPeriod.startDate,
              isASAP: daysBetween(startDate, todayDate) < 0,
              purchaseOrderLineId: null,
              jobId: null,
              requiresManualAction: false,
              supplierId:
                kind === "Order"
                  ? ((row as RpcPlanningRow).preferredSupplierId ?? null)
                  : null,
              policyName: "Stock Only",
              reason: "Below the minimum reserve for a superseded item",
              triggerValues: {
                projectedStock: Number(row.quantityOnHand) || 0,
                reorderPoint: Number(row.minimumReserveQuantity) || 0,
                leadTime: Number(row.leadTime) || 0
              }
            }
          ];
        }
      } else {
        const projections = periods.map((_, i) => {
          const value = row[`week${i + 1}` as keyof typeof row];
          return Number(value) || 0;
        });
        sizing = computePlanningOrders({
          reorderingPolicy: row.reorderingPolicy,
          periods,
          projections,
          todayDate,
          params: {
            reorderPoint: Number(row.reorderPoint) || 0,
            reorderQuantity: Number(row.reorderQuantity) || 0,
            minimumOrderQuantity: Number(row.minimumOrderQuantity) || 0,
            maximumOrderQuantity: Number(row.maximumOrderQuantity) || 0,
            orderMultiple: Number(row.orderMultiple) || 0,
            lotSize: Number(row.lotSize) || 0,
            maximumInventoryQuantity: Number(row.maximumInventoryQuantity) || 0,
            demandAccumulationPeriod: Number(row.demandAccumulationPeriod) || 1,
            demandAccumulationSafetyStock:
              Number(row.demandAccumulationSafetyStock) || 0,
            leadTime: Number(row.leadTime) || 0
          }
        }).map((order) => ({
          type: kind,
          periodId: order.periodId,
          suggestedQuantity: order.quantity,
          suggestedDate: order.dueDate,
          isASAP: order.isASAP,
          purchaseOrderLineId: null,
          jobId: null,
          requiresManualAction: false,
          supplierId:
            kind === "Order"
              ? ((row as RpcPlanningRow).preferredSupplierId ?? null)
              : null,
          policyName: order.policyName,
          reason: null,
          triggerValues: order.triggerValues
        }));
      }

      // change actions against real open documents
      const demandMap =
        demandByItemLocation.get(itemLocationKey) ?? new Map<string, number>();
      const demandPeriods = periods
        .filter((p) => (demandMap.get(p.id) ?? 0) > 0)
        .map((p) => ({
          periodId: p.id,
          startDate: p.startDate,
          quantity: demandMap.get(p.id) ?? 0
        }));

      const changeActions = deriveChangeActions({
        onHand: onHandByItemLocation.get(itemLocationKey) ?? 0,
        demandPeriods,
        openOrders,
        periods,
        policyFloor: policyFloorFor(row),
        toleranceDays,
        todayDate
      });

      const merged = convertOrdersToIncreases({
        sizingCandidates: sizing,
        openOrders,
        changeActions,
        toleranceDays
      });

      const assignee = resolveAssignee(row.id, location.id);
      for (const action of [...merged, ...changeActions]) {
        if (!action.periodId || !periodById.has(action.periodId)) continue;
        candidates.push({
          ...action,
          itemId: row.id,
          locationId: location.id,
          assignee
        });
      }
    };

    for (const row of purchasing.data ?? []) process(row, "Order");
    for (const row of production.data ?? []) process(row, "Make");
  }

  // ── diff-write
  const existingRows = await db
    .selectFrom("planningAction")
    .select([
      "id",
      "itemId",
      "locationId",
      "periodId",
      "type",
      "status",
      "suggestedQuantity",
      "suggestedDate",
      "isASAP",
      "purchaseOrderLineId",
      "jobId",
      "requiresManualAction",
      "supplierId",
      "policyName",
      "reason",
      "triggerValues",
      "assignee",
      "assigneeOverridden"
    ])
    .where("companyId", "=", companyId)
    .where("status", "!=", "Actioned")
    .execute();

  const existing: ExistingPlanningAction[] = existingRows.map((row) => ({
    ...row,
    type: row.type as PlanningActionType,
    status: row.status as "Open" | "Dismissed",
    suggestedQuantity: Number(row.suggestedQuantity),
    suggestedDate: toIsoDate(row.suggestedDate as unknown as string | Date)!,
    triggerValues: row.triggerValues ?? null
  }));

  const diff = diffPlanningActions({
    existing,
    candidates,
    toleranceDays
  });

  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < diff.deleteIds.length; i += BATCH_SIZE) {
      const chunk = diff.deleteIds.slice(i, i + BATCH_SIZE);
      await trx
        .deleteFrom("planningAction")
        .where("companyId", "=", companyId)
        .where("id", "in", chunk)
        .execute();
    }

    for (const update of diff.updates) {
      await trx
        .updateTable("planningAction")
        .set({
          ...update.patch,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("companyId", "=", companyId)
        .where("id", "=", update.id)
        .execute();
    }

    for (let i = 0; i < diff.inserts.length; i += BATCH_SIZE) {
      const chunk = diff.inserts.slice(i, i + BATCH_SIZE);
      await trx
        .insertInto("planningAction")
        .values(
          chunk.map((candidate) => ({
            companyId,
            itemId: candidate.itemId,
            locationId: candidate.locationId,
            periodId: candidate.periodId,
            type: candidate.type,
            suggestedQuantity: candidate.suggestedQuantity,
            suggestedDate: candidate.suggestedDate,
            isASAP: candidate.isASAP,
            purchaseOrderLineId: candidate.purchaseOrderLineId,
            jobId: candidate.jobId,
            requiresManualAction: candidate.requiresManualAction,
            supplierId: candidate.supplierId,
            policyName: candidate.policyName,
            reason: candidate.reason,
            triggerValues: candidate.triggerValues
              ? JSON.stringify(candidate.triggerValues)
              : null,
            assignee: candidate.assignee,
            createdBy: userId
          }))
        )
        .execute();
    }
  });

  logger.info("planning actions written", {
    companyId,
    inserted: diff.inserts.length,
    updated: diff.updates.length,
    deleted: diff.deleteIds.length
  });

  return {
    inserted: diff.inserts.length,
    updated: diff.updates.length,
    deleted: diff.deleteIds.length
  };
}
