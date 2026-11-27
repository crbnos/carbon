// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Planning action messages (spec §P1) — the persisted, assignable output of an
// MRP run. One row per suggested action:
//
//   Order / Make          — create new supply (from the shared reorder sizing)
//   Expedite / Defer      — move an existing open PO line / job (date)
//   Increase / Decrease   — change an existing order's quantity
//   Cancel                — an existing order has no remaining requirement
//   Transfer              — move common stock a project segment needs into
//                           the project (from the common segment's true surplus),
//                           or a planning group member's permanent excess to a
//                           short sibling (Projects Phase 3)
//   Borrow                — lend a member's stock to a short sibling until the
//                           member needs it back (Projects Phase 3)
//
// Every action belongs to a netting segment (`planningSegmentId`): '' is
// common, a project id is a project with project stock. Each segment is
// planned on its own; a project segment is lot-for-lot, with no reorder
// point, safety stock or Stock Only reserve.
//
// This file reads the inputs and orchestrates (`generatePlanningActions`).
// One row's actions are `row-actions.ts` (the change actions follow the SAP
// "rescheduling check on a firmed receipt" model); the diff-write keyed on
// each action's natural key is `planning-action-write.ts`.
//
// Actions are generated over the WHOLE planning window. The per-item planning
// horizon (time fence) is a read-time lens applied by the planning grids, which
// compare each row's `horizonDate` with today + horizon days — so a planner can
// widen the fence on screen without a run. Nothing here reads the horizon.

import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { fetchAll } from "@carbon/database/fetch-all";
import { COMMON_SEGMENT, KEY_SEP } from "@carbon/database/mrp-engine";
import type {
  GroupPegInput,
  MemberMove,
  MemberPosition,
  PegPriorityRule
} from "@carbon/ee/pegging";
import { getLogger } from "@carbon/logger";
import { datetime, round } from "@carbon/utils";
import { parseDate, startOfWeek } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { toIsoDate } from "../scheduling/date-utils.ts";
import {
  buildOpenSupplyOrders,
  itemLocationSegmentKey,
  type OpenJobDetails
} from "./open-supply-orders.ts";
import { groupByProjectOf, planningSegmentOf } from "./plan-company.ts";
import type { PlannedOrderSnapshot } from "./planned-order-write.ts";
import type {
  PlannedOrderChangeAction,
  PlannedOrderSignal
} from "./planned-orders.ts";
import type {
  ChangeCandidate,
  PlanningActionCandidate
} from "./planning-action-types.ts";
import {
  naturalKey,
  type PlanningActionPegging,
  writePlanningActions
} from "./planning-action-write.ts";
import { loadResponsibleEmployeeResolver } from "./responsible-employee.ts";
import {
  deriveRowActions,
  type ProductionPlanningRow,
  plannedOrderActions,
  type RpcPlanningRow
} from "./row-actions.ts";
import {
  DAYS_PER_PERIOD,
  daysBetween,
  laterDate,
  weekIndexOn
} from "./row-sizing.ts";

const logger = getLogger("planning", "planning-actions");

const WEEKS_TO_PLAN = 48;

const MEMBER_TRANSFER_REASON = "Sibling stock not needed within the horizon";
const MEMBER_BORROW_REASON = "Sibling stock lent until the sibling needs it";

/** The pure pegging functions `memberMoveCandidates` uses (`@carbon/ee/pegging`). */
export type MemberMovePegging = {
  proposeMemberMoves: (args: {
    members: MemberPosition[];
    horizonEndDate: string;
    leadTimeDays: number;
    today: string;
    priorityRule?: PegPriorityRule;
  }) => MemberMove[];
  memberPositionsOf: (
    input: GroupPegInput,
    memberProjectIds: readonly string[],
    priorityByProject: Readonly<Record<string, number>>
  ) => MemberPosition[];
  applyMemberMoves: (
    input: GroupPegInput,
    moves: readonly MemberMove[],
    today: string
  ) => GroupPegInput;
};

/**
 * Projects Phase 3: the member Transfers and Borrows of every planning group.
 * Per (group, item, location) peg input, `proposeMemberMoves` moves stock
 * from a sibling with excess to a short member. Each move is a candidate in
 * the group's segment; moves with one natural key add up. The returned peg
 * inputs carry the moved stock, so the short member's own stock covers its
 * demand before pegging. A move never changes the group's net requirement.
 */
export function memberMoveCandidates(
  args: {
    inputs: GroupPegInput[];
    planningGroups: { id: string; memberProjectIds: string[] }[];
    priorityRuleByGroup: Record<string, PegPriorityRule>;
    priorityByProject: Record<string, number>;
    /** `itemId + KEY_SEP + locationId` -> the item's lead time in days. */
    leadTimeByItemLocation: ReadonlyMap<string, number>;
    periods: { id: string; startDate: string }[];
    todayDate: string;
    assigneeOf: (
      itemId: string,
      locationId: string,
      segmentId: string
    ) => string | null;
  },
  pegging: MemberMovePegging
): { candidates: PlanningActionCandidate[]; inputs: GroupPegInput[] } {
  const { periods, todayDate } = args;
  const lastPeriod = periods[periods.length - 1];
  if (!lastPeriod) return { candidates: [], inputs: args.inputs };
  const horizonEndDate = parseDate(lastPeriod.startDate)
    .add({ days: DAYS_PER_PERIOD - 1 })
    .toString();
  const membersByGroup = new Map(
    args.planningGroups.map((group) => [group.id, group.memberProjectIds])
  );
  const periodFor = (dateIso: string) =>
    periods[weekIndexOn(periods, dateIso)]!;

  const byKey = new Map<string, PlanningActionCandidate>();
  const inputs = args.inputs.map((input) => {
    const memberIds = membersByGroup.get(input.planningGroupId) ?? [];
    if (memberIds.length < 2) return input;
    const moves = pegging.proposeMemberMoves({
      members: pegging.memberPositionsOf(
        input,
        memberIds,
        args.priorityByProject
      ),
      horizonEndDate,
      leadTimeDays:
        args.leadTimeByItemLocation.get(
          input.itemId + KEY_SEP + input.locationId
        ) ?? 0,
      today: todayDate,
      priorityRule: args.priorityRuleByGroup[input.planningGroupId]
    });
    for (const move of moves) {
      const date = laterDate(move.needDate, todayDate);
      const candidate: PlanningActionCandidate = {
        itemId: input.itemId,
        locationId: input.locationId,
        periodId: periodFor(date).id,
        type: move.type,
        suggestedQuantity: move.quantity,
        suggestedDate: date,
        horizonDate: date,
        latestOrderDate: null,
        isASAP: daysBetween(move.needDate, todayDate) <= 0,
        purchaseOrderLineId: null,
        jobId: null,
        plannedOrderId: null,
        requiresManualAction: false,
        supplierId: null,
        policyName: null,
        reason:
          move.type === "Borrow"
            ? MEMBER_BORROW_REASON
            : MEMBER_TRANSFER_REASON,
        triggerValues: move.paybackDueDate
          ? { paybackDueDate: move.paybackDueDate }
          : null,
        assignee: args.assigneeOf(
          input.itemId,
          input.locationId,
          input.planningGroupId
        ),
        planningSegmentId: input.planningGroupId,
        fromProjectId: move.fromProjectId,
        toProjectId: move.toProjectId
      };
      const key = naturalKey(candidate);
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, candidate);
        continue;
      }
      current.suggestedQuantity = round(
        current.suggestedQuantity + candidate.suggestedQuantity
      );
      current.isASAP = current.isASAP || candidate.isASAP;
      // the earliest payback of the moves it holds
      const payback = candidate.triggerValues?.paybackDueDate;
      const held = current.triggerValues?.paybackDueDate;
      if (
        typeof payback === "string" &&
        typeof held === "string" &&
        payback < held
      ) {
        current.triggerValues = { paybackDueDate: payback };
      }
    }
    return pegging.applyMemberMoves(input, moves, todayDate);
  });
  return { candidates: [...byKey.values()], inputs };
}

/**
 * On-hand per item, location and netting segment (`itemLocationSegmentKey`).
 * itemStockQuantities holds one row per project stock stripe ('' is common).
 * Each stripe sums into its segment by the rule of the SQL
 * `project_planning_segment` (`planningSegmentOf`): a project with project
 * stock is its own segment, any other stripe is common.
 */
export async function loadSegmentOnHand(
  db: Kysely<DB>,
  companyId: string,
  // Projects Phase 3: project id -> its active planning group, when the
  // company has PLANNING_GROUPS. A member's stock is its group's.
  groupByProject?: ReadonlyMap<string, string>
): Promise<Map<string, number>> {
  const [rows, stockedProjects] = await Promise.all([
    // Nettable on-hand, the figure runMrp plans against.
    db
      .selectFrom("itemStockQuantities")
      .select((eb) => [
        "itemId",
        "locationId",
        "projectId",
        eb("quantityOnHand", "-", eb.ref("quantityNonNettable")).as(
          "quantityOnHand"
        )
      ])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("project")
      .select(["id"])
      .where("companyId", "=", companyId)
      .where("projectStock", "=", true)
      .execute()
  ]);
  const stockedProjectIds = new Set(stockedProjects.map((p) => p.id));
  const onHand = new Map<string, number>();
  for (const row of rows) {
    if (!row.itemId || !row.locationId) continue;
    const key = itemLocationSegmentKey(
      row.itemId,
      row.locationId,
      planningSegmentOf(row.projectId, stockedProjectIds, groupByProject)
    );
    onHand.set(key, (onHand.get(key) ?? 0) + (Number(row.quantityOnHand) || 0));
  }
  return onHand;
}

/**
 * What the open-supply views do not expose: each open job's status and
 * good-unit quantity, and the conversion factor of each open PO line bought
 * in a unit other than the inventory unit. One read each of the company's
 * open documents (the views' own filters), no id list.
 */
export async function loadOpenSupplyDetails(
  db: Kysely<DB>,
  companyId: string
): Promise<{
  jobDetailsById: Map<string, OpenJobDetails>;
  conversionFactorByLineId: Map<string, number>;
}> {
  const [openJobRows, poLineFactorRows] = await Promise.all([
    db
      .selectFrom("job")
      .select(["id", "status"])
      .where("companyId", "=", companyId)
      .where("status", "in", ["Planned", "Ready", "In Progress", "Paused"])
      .execute(),
    // Only the lines bought in a unit other than the inventory unit: every
    // other line's factor is 1, the default.
    db
      .selectFrom("purchaseOrderLine as pol")
      .innerJoin("purchaseOrder as po", "po.id", "pol.purchaseOrderId")
      .select(["pol.id", "pol.conversionFactor"])
      .where("pol.companyId", "=", companyId)
      .where("po.status", "in", [
        "To Receive",
        "To Receive and Invoice",
        "Planned"
      ])
      .where("pol.receivedComplete", "=", false)
      .where("pol.conversionFactor", "!=", 1)
      .execute()
  ]);

  const jobDetailsById = new Map<string, OpenJobDetails>();
  for (const row of openJobRows) {
    if (!row.status) continue;
    jobDetailsById.set(row.id, { status: row.status });
  }
  return {
    jobDetailsById,
    conversionFactorByLineId: new Map(
      poLineFactorRows.map((row) => [row.id, Number(row.conversionFactor)])
    )
  };
}

/** What one project segment takes from common stock in one period. */
export type CommonSurplusDraw = {
  itemId: string;
  locationId: string;
  periodId: string;
  planningSegmentId: string;
  quantity: number;
};

/** MRP v2: what the run's planned-order write leaves for the worklist. */
export type PlannedOrderWorklistInputs = {
  /**
   * The engine's new supply per common row (`itemLocationSegmentKey`). A row
   * present here takes its Order, Make and Increase actions from it instead
   * of sizing the RPC row again.
   */
  newSupplyByRow: ReadonlyMap<string, ChangeCandidate[]>;
  /**
   * The engine's change actions on the open jobs and PO lines of each row in
   * `newSupplyByRow`. Such a row takes them instead of the RPC row's
   * (`deriveRowActions`' `engine`).
   */
  documentChangeActionsByRow: ReadonlyMap<string, ChangeCandidate[]>;
  /** The engine's change actions on held planned orders. */
  changeActions: PlannedOrderChangeAction[];
  /** The new planned orders the time fence moved. */
  signals: PlannedOrderSignal[];
  /** `plannedOrderNaturalKey` -> `plannedOrder.id`, as written. */
  idByKey: ReadonlyMap<string, string>;
  /** The planned orders held this run (Firm, or Planned inside the time fence). */
  heldIds: string[];
  /**
   * The planned orders as the run's Phase-7 write committed them
   * (`readPlannedOrderSnapshot`). The write checks them under its lock
   * (`writePlanningActions`).
   */
  snapshot: PlannedOrderSnapshot;
};

/**
 * The engine's sizing of one row, when the engine planned it: the planned
 * key has both its new supply and its document change actions.
 */
function engineRowOf(
  plannedOrders: PlannedOrderWorklistInputs | undefined,
  rowKey: string
): { supply: ChangeCandidate[]; changeActions: ChangeCandidate[] } | undefined {
  const supply = plannedOrders?.newSupplyByRow.get(rowKey);
  const changeActions = plannedOrders?.documentChangeActionsByRow.get(rowKey);
  return supply && changeActions ? { supply, changeActions } : undefined;
}

export async function generatePlanningActions(
  client: SupabaseClient<Database>,
  db: Kysely<DB>,
  args: {
    companyId: string;
    userId: string;
    /**
     * When the calling MRP run started (`databaseNow`). Its forecasts are
     * committed by now; when a run that started later has saved since, that
     * run writes the actions and this one writes none.
     */
    runStartedAt?: string;
    /**
     * What each project segment takes from common stock (`planCompany`'s
     * `commonSurplusDraws`). Each draw becomes a Transfer action.
     */
    commonSurplusDraws?: CommonSurplusDraw[];
    /**
     * Projects Phase 3: the active planning groups and their members, as
     * `runMrp` passed them to `planCompany` (empty without PLANNING_GROUPS).
     */
    planningGroups?: { id: string; memberProjectIds: string[] }[];
    /**
     * Projects Phase 3: the peg writer's inputs, passed only when the company
     * has PLANNING_GROUPS (`PlanningActionPegging`), diff-written in this
     * function's transaction after the actions.
     */
    pegging?: PlanningActionPegging;
    /** MRP v2: the engine's planned-order outputs, as the run wrote them. */
    plannedOrders?: PlannedOrderWorklistInputs;
  }
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

  // Every read below is independent of the others, so they run together in
  // two groups instead of one after another (they were six waits in a row).
  // Two groups, not one: the resolver alone takes five Kysely reads from the
  // shared process pool, so a bounded group leaves connections for the run's
  // other work — the PostgREST views ride alongside it.
  const [resolveAssignee, openPoLines, openJobs] = await Promise.all([
    loadResponsibleEmployeeResolver(db, companyId),
    // ── open supply (real documents change actions target)
    fetchAll<Database["public"]["Views"]["openPurchaseOrderLines"]["Row"]>(() =>
      client
        .from("openPurchaseOrderLines")
        .select("*")
        .eq("companyId", companyId)
        .order("id")
    ),
    fetchAll<Database["public"]["Views"]["openProductionOrders"]["Row"]>(() =>
      client
        .from("openProductionOrders")
        .select("*")
        .eq("companyId", companyId)
        .order("id")
    )
  ]);
  if (openPoLines.error) throw openPoLines.error;
  if (openJobs.error) throw openJobs.error;
  const poLineRows = openPoLines.data ?? [];
  const jobRows = openJobs.data ?? [];

  // ── demand per (item, location, segment, period): actual + forecast +
  //    projection (net of consumption), the same union the planning RPCs
  //    read; on-hand per segment; the open jobs' status and the open PO
  //    lines' conversion factor, which the
  //    openProductionOrders / openPurchaseOrderLines views do not expose —
  //    one read each of the company's open documents (the views' own
  //    filters), no id list. Projections are common demand.
  const [
    demandActuals,
    demandForecasts,
    demandProjections,
    onHandByItemLocation,
    { jobDetailsById, conversionFactorByLineId }
  ] = await Promise.all([
    db
      .selectFrom("demandActual")
      .select([
        "itemId",
        "locationId",
        "periodId",
        "planningSegmentId",
        "actualQuantity"
      ])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("demandForecast")
      .select([
        "itemId",
        "locationId",
        "periodId",
        "planningSegmentId",
        "forecastQuantity"
      ])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("demandProjection")
      .select([
        "itemId",
        "locationId",
        "periodId",
        "forecastQuantity",
        "consumedQuantity"
      ])
      .where("companyId", "=", companyId)
      .execute(),
    loadSegmentOnHand(db, companyId, groupByProjectOf(args.planningGroups)),
    loadOpenSupplyDetails(db, companyId)
  ]);

  const demandByItemLocation = new Map<string, Map<string, number>>();
  const addDemand = (
    itemId: string | null,
    locationId: string | null,
    segmentId: string | null,
    periodId: string | null,
    quantity: number | null
  ) => {
    if (!itemId || !locationId || !periodId) return;
    if (!periodIdSet.has(periodId)) return;
    const key = itemLocationSegmentKey(
      itemId,
      locationId,
      segmentId || COMMON_SEGMENT
    );
    const byPeriod = demandByItemLocation.get(key) ?? new Map<string, number>();
    byPeriod.set(
      periodId,
      (byPeriod.get(periodId) ?? 0) + (Number(quantity) || 0)
    );
    demandByItemLocation.set(key, byPeriod);
  };
  for (const row of demandActuals) {
    addDemand(
      row.itemId,
      row.locationId,
      row.planningSegmentId,
      row.periodId,
      row.actualQuantity
    );
  }
  for (const row of demandForecasts) {
    addDemand(
      row.itemId,
      row.locationId,
      row.planningSegmentId,
      row.periodId,
      row.forecastQuantity
    );
  }
  for (const row of demandProjections) {
    addDemand(
      row.itemId,
      row.locationId,
      COMMON_SEGMENT,
      row.periodId,
      Math.max(
        (Number(row.forecastQuantity) || 0) -
          (Number(row.consumedQuantity) || 0),
        0
      )
    );
  }

  const openOrdersByItemLocation = buildOpenSupplyOrders({
    poLineRows,
    jobRows,
    jobDetailsById,
    conversionFactorByLineId,
    todayDate
  });

  // ── the common stock each project segment draws, per item and location
  const drawsByItemLocation = new Map<
    string,
    { periodId: string; quantity: number }[]
  >();
  for (const draw of args.commonSurplusDraws ?? []) {
    if (!draw.planningSegmentId || draw.quantity <= 0) continue;
    const key = itemLocationSegmentKey(
      draw.itemId,
      draw.locationId,
      draw.planningSegmentId
    );
    const list = drawsByItemLocation.get(key) ?? [];
    list.push({ periodId: draw.periodId, quantity: draw.quantity });
    drawsByItemLocation.set(key, list);
  }

  // ── planning rows (projections + reorder params) per location and segment
  const candidates: PlanningActionCandidate[] = [];
  // The lead time of each item at each location, for the member Borrows.
  const leadTimeByItemLocation = new Map<string, number>();

  for (const location of locations) {
    // Paged like every other read in the run: a bare RPC call stops at
    // PostgREST's max_rows, and an item missing from these rows has no
    // candidates — the diff below would then DELETE its existing actions,
    // dismissals and assignee overrides included. A row is one item in one
    // segment, so the pages order by the item id, then the segment: a total
    // order, so the pages neither overlap nor skip.
    const [purchasing, production] = await Promise.all([
      fetchAll<RpcPlanningRow>(() =>
        client
          .rpc("get_purchasing_planning", {
            company_id: companyId,
            location_id: location.id,
            periods: periodIds
          })
          .order("id")
          .order("planningSegmentId")
      ),
      fetchAll<ProductionPlanningRow>(() =>
        client
          .rpc("get_production_planning", {
            company_id: companyId,
            location_id: location.id,
            periods: periodIds
          })
          .order("id")
          .order("planningSegmentId")
      )
    ]);
    if (purchasing.error) throw new Error(purchasing.error.message);
    if (production.error) throw new Error(production.error.message);

    const process = (
      row: RpcPlanningRow | ProductionPlanningRow,
      kind: "Order" | "Make"
    ) => {
      const key = itemLocationSegmentKey(
        row.id,
        location.id,
        row.planningSegmentId || COMMON_SEGMENT
      );
      const actions = deriveRowActions({
        row,
        kind,
        periods,
        demandByPeriod:
          demandByItemLocation.get(key) ?? new Map<string, number>(),
        openOrders: openOrdersByItemLocation.get(key) ?? [],
        onHand: onHandByItemLocation.get(key) ?? 0,
        draws: drawsByItemLocation.get(key) ?? [],
        toleranceDays,
        todayDate,
        engine: engineRowOf(args.plannedOrders, key)
      });

      leadTimeByItemLocation.set(
        row.id + KEY_SEP + location.id,
        Number(row.leadTime) || 0
      );
      const assignee = resolveAssignee(
        row.id,
        location.id,
        row.planningSegmentId || COMMON_SEGMENT
      );
      for (const action of actions) {
        if (!action.periodId || !periodById.has(action.periodId)) continue;
        candidates.push({
          ...action,
          // Persist boundary: every source above is float arithmetic.
          suggestedQuantity: round(action.suggestedQuantity),
          itemId: row.id,
          locationId: location.id,
          assignee
        });
      }
    };

    for (const row of purchasing.data ?? []) process(row, "Order");
    for (const row of production.data ?? []) process(row, "Make");
  }

  // ── MRP v2: the actions on planned orders, with or without an RPC row
  const { plannedOrders } = args;
  if (plannedOrders) {
    for (const action of plannedOrderActions({
      changeActions: plannedOrders.changeActions,
      signals: plannedOrders.signals,
      newSupplyByRow: plannedOrders.newSupplyByRow,
      plannedOrderIdByKey: plannedOrders.idByKey,
      heldPlannedOrderIds: new Set(plannedOrders.heldIds),
      periods,
      todayDate
    })) {
      if (!periodById.has(action.periodId)) continue;
      candidates.push({
        ...action,
        suggestedQuantity: round(action.suggestedQuantity),
        assignee: resolveAssignee(
          action.itemId,
          action.locationId,
          action.planningSegmentId ?? COMMON_SEGMENT
        )
      });
    }
  }

  // ── Projects Phase 3: member Transfers and Borrows inside each planning
  // group. Only with PLANNING_GROUPS (`args.pegging`); the commercial
  // functions load lazily, so a company without the feature loads none.
  let pegging = args.pegging;
  if (pegging && (args.planningGroups ?? []).length > 0) {
    const moves = memberMoveCandidates(
      {
        inputs: pegging.inputs,
        planningGroups: args.planningGroups ?? [],
        priorityRuleByGroup: pegging.priorityRuleByGroup,
        priorityByProject: pegging.priorityByProject,
        leadTimeByItemLocation,
        periods,
        todayDate,
        assigneeOf: resolveAssignee
      },
      await import("@carbon/ee/pegging")
    );
    candidates.push(...moves.candidates);
    pegging = { ...pegging, inputs: moves.inputs };
  }

  const diff = await writePlanningActions(db, {
    companyId,
    userId,
    candidates,
    periods,
    toleranceDays,
    pegging,
    plannedOrderSnapshot: plannedOrders?.snapshot,
    runStartedAt: args.runStartedAt
  });
  if (!diff) return { inserted: 0, updated: 0, deleted: 0 };

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
