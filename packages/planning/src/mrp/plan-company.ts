// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The pure core of `runMrp` (Phases 3–6): every value it plans from is an
// input, and every row Phase 7 writes is an output. No database reads, no
// clock, no logging — so a fixture pins its output row for row
// (`plan-company.test.ts`).

import type { Database } from "@carbon/database";
import {
  type BomChild,
  COMMON_SEGMENT,
  type DemandContributor,
  explodeBom,
  KEY_SEP,
  type MethodType,
  makeActualKey,
  makeKey,
  makeLocationItemKey,
  netConsumeFirstContributors,
  type ReplenishmentSystem,
  splitActualKey,
  splitKey
} from "@carbon/database/mrp-engine";
import {
  buildConsumeFirstHops,
  buildSupersessionRedirectMap,
  type Redirect
} from "@carbon/database/supersession-pick";
import type {
  GroupPegInput,
  PegDemand,
  PegDemandSourceType,
  PegSupply
} from "@carbon/ee/pegging";
import { round } from "@carbon/utils";
import { type CalendarDate, parseDate } from "@internationalized/date";
import {
  actualConsumesForecast,
  consumeForecast
} from "./forecast-consumption.ts";
import {
  jobCompletionDate,
  purchaseOrderLineArrivalDate
} from "./supply-date.ts";

type Views = Database["public"]["Views"];
type Tables = Database["public"]["Tables"];

// The period objects this module builds carry CalendarDate start/end (via
// parseDate) and are compared with CalendarDate.compare.
export type DemandPeriod = {
  id: string;
  startDate: CalendarDate;
  endDate: CalendarDate;
};

/** Every value Phases 1 and 2 of `runMrp` load. Dates are ISO strings. */
export type PlanCompanyInputs = {
  companyId: string;
  userId: string;
  /** Today on the company's clock. */
  today: string;
  /** The weekly planning periods, in order. */
  periods: { id: string; startDate: string; endDate: string }[];
  /** The company's locations, in the order `runMrp` read them. */
  locationIds: string[];
  consumptionWindow: { backwardPeriods: number; forwardPeriods: number };
  salesOrderLines: (Pick<
    Views["openSalesOrderLines"]["Row"],
    | "id"
    | "itemId"
    | "locationId"
    | "promisedDate"
    | "quantityToConsume"
    | "quantityToSend"
  > &
    Segmented)[];
  jobMaterialLines: (Pick<
    Views["openJobMaterialLines"]["Row"],
    | "dueDate"
    | "itemId"
    | "jobId"
    | "leadTime"
    | "locationId"
    | "quantityPerParent"
    | "quantityToIssue"
  > &
    Partial<
      Pick<
        Views["openJobMaterialLines"]["Row"],
        "ownerProjectId" | "projectElementId"
      >
    > &
    Segmented)[];
  productionLines: (Pick<
    Views["openProductionOrders"]["Row"],
    "deadlineType" | "dueDate" | "itemId" | "locationId" | "quantityToReceive"
  > &
    Partial<
      Pick<Views["openProductionOrders"]["Row"], "id" | "ownerProjectId">
    > &
    Segmented)[];
  purchaseOrderLines: (Pick<
    Views["openPurchaseOrderLines"]["Row"],
    | "dueDate"
    | "itemId"
    | "leadTime"
    | "locationId"
    | "orderDate"
    | "promisedDate"
    | "quantityToReceive"
  > &
    Partial<
      Pick<Views["openPurchaseOrderLines"]["Row"], "id" | "ownerProjectId">
    > &
    Segmented)[];
  /** Open plan-line materials (`openProjectMaterialLines`). */
  projectMaterialLines?: (Pick<
    Views["openProjectMaterialLines"]["Row"],
    | "id"
    | "itemId"
    | "locationId"
    | "planningSegmentId"
    | "quantity"
    | "requiredDate"
  > &
    Partial<
      Pick<
        Views["openProjectMaterialLines"]["Row"],
        "projectElementId" | "projectId"
      >
    >)[];
  /** Open borrows between projects (`openProjectBorrows`). */
  projectBorrows?: (Pick<
    Views["openProjectBorrows"]["Row"],
    | "borrowerSegmentId"
    | "id"
    | "itemId"
    | "lenderSegmentId"
    | "locationId"
    | "paybackDueDate"
    | "quantity"
  > &
    Partial<
      Pick<
        Views["openProjectBorrows"]["Row"],
        "borrowerProjectId" | "lenderProjectId"
      >
    >)[];
  /** The ids of the company's projects with project stock. */
  stockedProjectIds?: string[];
  /**
   * Projects Phase 3: the company's active planning groups and their member
   * projects (with project stock). Passed only when the company has the
   * `PLANNING_GROUPS` feature. A member's stock and demand net in the group.
   */
  planningGroups?: { id: string; memberProjectIds: string[] }[];
  /**
   * Group ids whose rows the views put in a group segment while the company
   * lacks `PLANNING_GROUPS`. Their demand nets in each member's own segment;
   * grouped supply (no owner project) nets as common supply.
   */
  ungroupedPlanningGroupIds?: string[];
  /** Each group member's `planningPriority` (default 100), for the pegging. */
  projectPriorities?: { projectId: string; priority: number }[];
  /**
   * The items and locations whose `itemPlanning` turns
   * `allowCommonSupplyForProjects` off: their project segments never draw
   * common stock.
   */
  commonSupplyBlocked?: { itemId: string; locationId: string }[];
  demandProjections: Pick<
    Tables["demandProjection"]["Row"],
    "forecastQuantity" | "id" | "itemId" | "locationId" | "periodId"
  >[];
  items: { id: string; replenishmentSystem: string | null }[];
  replenishments: { itemId: string; leadTime: number | null }[];
  supersessions: {
    itemId: string;
    supersessionMode: Database["public"]["Enums"]["supersessionMode"];
    successorItemId: string | null;
    successorEffectivityDate: string | null;
    conversionFactor: number | null;
  }[];
  /** On-hand per stripe; `projectId` '' (or absent) is common stock. */
  onHand: {
    itemId: string | null;
    locationId: string | null;
    projectId?: string | null;
    quantityOnHand: number | string | null;
  }[];
  activeMethods: { id: string | null; itemId: string | null }[];
  materials: {
    id: string;
    makeMethodId: string;
    materialMakeMethodId: string | null;
    itemId: string;
    quantity: number;
    methodType: MethodType;
  }[];
  /** The actuals an earlier run wrote in these periods; this run zeroes them. */
  existingDemandActuals: (Pick<
    Tables["demandActual"]["Row"],
    "itemId" | "locationId" | "periodId" | "sourceType"
  > &
    Segmented)[];
  existingSupplyActuals: (Pick<
    Tables["supplyActual"]["Row"],
    "itemId" | "locationId" | "periodId" | "sourceType"
  > &
    Segmented)[];
};

/** The netting segment of a demand or supply row; absent is common (''). */
type Segmented = { planningSegmentId?: string | null };

/**
 * The netting segment of a project's stock or demand, the rule of the SQL
 * `project_planning_segment`: a project with project stock is its own
 * segment, any other project (or none) is common ('').
 */
export function planningSegmentOf(
  projectId: string | null | undefined,
  stockedProjectIds: ReadonlySet<string>,
  // Projects Phase 3: project id -> its active planning group.
  groupByProject?: ReadonlyMap<string, string>
): string {
  if (!projectId) return COMMON_SEGMENT;
  const group = groupByProject?.get(projectId);
  if (group) return group;
  return stockedProjectIds.has(projectId) ? projectId : COMMON_SEGMENT;
}

/** Project id -> planning group id, from `PlanCompanyInputs.planningGroups`. */
export function groupByProjectOf(
  planningGroups: { id: string; memberProjectIds: string[] }[] | undefined
): Map<string, string> {
  const groupByProject = new Map<string, string>();
  for (const group of planningGroups ?? []) {
    for (const projectId of group.memberProjectIds) {
      groupByProject.set(projectId, group.id);
    }
  }
  return groupByProject;
}

/**
 * The `planningSegmentId` column of an output row. Common rows leave it out
 * and take the column default (''), so a company with no project stock
 * writes the same rows as before Phase 2b.
 */
function segmentColumn(segmentId: string): { planningSegmentId?: string } {
  return segmentId === COMMON_SEGMENT ? {} : { planningSegmentId: segmentId };
}

type DemandForecastSourceInsert =
  Database["public"]["Tables"]["demandForecastSource"]["Insert"];

/** Every row Phase 7 of `runMrp` writes, plus the BOM cycle it logs. */
export type PlanCompanyOutputs = {
  demandForecastUpserts: Database["public"]["Tables"]["demandForecast"]["Insert"][];
  demandForecastSourceInserts: DemandForecastSourceInsert[];
  demandActualUpserts: Database["public"]["Tables"]["demandActual"]["Insert"][];
  supplyActualUpserts: Database["public"]["Tables"]["supplyActual"]["Insert"][];
  consumptionUpdates: Array<{
    itemId: string;
    locationId: string;
    periodId: string;
    consumedQuantity: number;
  }>;
  /** Items on a BOM cycle, planned as leaf items. */
  cycleItemIds: string[];
  /**
   * What each project segment takes from the common segment's true surplus,
   * per period. Planning actions turn each draw into a Transfer.
   */
  commonSurplusDraws: Array<{
    itemId: string;
    locationId: string;
    periodId: string;
    planningSegmentId: string;
    quantity: number;
  }>;
  /**
   * Projects Phase 3: the demand and the open supply of each planning group
   * segment, per item and location, for the peg writer. The planning actions
   * add the planned Order and Make supply. Empty when no group segment exists.
   */
  groupPegInputs: GroupPegInput[];
};

export function planCompany(input: PlanCompanyInputs): PlanCompanyOutputs {
  const { companyId, userId, consumptionWindow } = input;
  const today = parseDate(input.today);
  const periods: DemandPeriod[] = input.periods.map((p) => ({
    id: p.id,
    startDate: parseDate(p.startDate),
    endDate: parseDate(p.endDate)
  }));
  const locations = input.locationIds.map((id) => ({ id }));

  const replenishmentSystemByItem = new Map<string, ReplenishmentSystem>();
  for (const item of input.items) {
    replenishmentSystemByItem.set(
      item.id,
      item.replenishmentSystem as ReplenishmentSystem
    );
  }

  const leadTimeByItem = new Map<string, number>();
  for (const rep of input.replenishments) {
    leadTimeByItem.set(rep.itemId, rep.leadTime ?? 7);
  }

  const supersessionByItem = new Map<
    string,
    {
      supersessionMode: Database["public"]["Enums"]["supersessionMode"];
      successorItemId: string | null;
      successorEffectivityDate: string | null;
      conversionFactor: number;
    }
  >();
  for (const s of input.supersessions) {
    supersessionByItem.set(s.itemId, {
      supersessionMode: s.supersessionMode,
      successorItemId: s.successorItemId,
      successorEffectivityDate: s.successorEffectivityDate,
      conversionFactor: Number(s.conversionFactor ?? 1) || 1
    });
  }

  // Resolve which superseded items currently redirect to a successor (effective
  // phase-out modes), collapsing multi-hop chains with the cumulative conversion
  // factor. Shared with job creation (get-method) via @carbon/database/supersession-pick so the
  // two can never diverge — MRP gates on `today`, get-method gates on the job's
  // build date. (supersessionByItem above is kept for the Consume-First on-hand
  // draw-down below.)
  const redirectByItem = buildSupersessionRedirectMap(
    input.supersessions,
    today.toString()
  );
  const consumeFirstHops = buildConsumeFirstHops(
    input.supersessions,
    today.toString()
  );

  // On-hand per segment: a stripe of a project with project stock is that
  // project's segment; common stock (and any other stripe) is ''.
  const stockedProjectIds = new Set(input.stockedProjectIds ?? []);
  // Projects Phase 3: a member's stock nets in its planning group.
  const groupByProject = groupByProjectOf(input.planningGroups);
  const groupSegments = new Set(
    (input.planningGroups ?? []).map((group) => group.id)
  );
  // Without PLANNING_GROUPS, a row the views put in a group segment nets in
  // its owner project's own segment, or as common when it has no owner.
  const ungroupedSegments = new Set(input.ungroupedPlanningGroupIds ?? []);
  const segmentOf = (
    viewSegment: string | null | undefined,
    ownerProjectId: string | null | undefined
  ) => {
    const segment = viewSegment ?? COMMON_SEGMENT;
    return ungroupedSegments.has(segment)
      ? planningSegmentOf(ownerProjectId, stockedProjectIds)
      : segment;
  };
  // A group segment's contributor names its member project, element and
  // need date, so the pegging can attribute the group's supply.
  const memberAttribution = (
    segmentId: string,
    projectId: string | null | undefined,
    projectElementId: string | null | undefined,
    needDate: string
  ) =>
    groupSegments.has(segmentId)
      ? {
          ...(projectId ? { projectId } : {}),
          ...(projectElementId ? { projectElementId } : {}),
          needDate
        }
      : {};
  const baseInventoryByLocationItem = new Map<string, number>();
  for (const row of input.onHand) {
    if (row.itemId && row.locationId) {
      const key = makeLocationItemKey(
        row.locationId,
        row.itemId,
        planningSegmentOf(row.projectId, stockedProjectIds, groupByProject)
      );
      baseInventoryByLocationItem.set(
        key,
        (baseInventoryByLocationItem.get(key) ?? 0) +
          (Number(row.quantityOnHand) || 0)
      );
    }
  }

  const methodIdByItem = activeMethodIdByItem(input.activeMethods);

  // Build BOM structure: itemId -> direct children
  // Map makeMethodId -> its direct material children
  const materialsByMethodId = new Map<string, PlanCompanyInputs["materials"]>();
  for (const mat of input.materials) {
    const existing = materialsByMethodId.get(mat.makeMethodId) ?? [];
    existing.push(mat);
    materialsByMethodId.set(mat.makeMethodId, existing);
  }

  // Build itemId -> direct BOM children (one level only)
  const bomByItem = new Map<string, BomChild[]>();
  for (const [itemId, methodId] of methodIdByItem) {
    const materials = materialsByMethodId.get(methodId) ?? [];
    const children: BomChild[] = [];
    for (const mat of materials) {
      children.push({
        itemId: mat.itemId,
        quantity: Number(mat.quantity) || 1,
        methodType: mat.methodType as MethodType
      });
    }
    if (children.length > 0) {
      bomByItem.set(itemId, children);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // PHASE 3: Collect supply from open orders
  // ──────────────────────────────────────────────────────────────

  // Supply bucketed by location+period+item (for demand projection netting + supplyActual output)
  const jobSupplyByLocationPeriodItem = new Map<string, number>();

  for (const line of input.productionLines) {
    // locationId is part of the supplyActual primary key (hence NOT NULL) and
    // an FK to location. A line with no location has nowhere to be planned and
    // would write locationId="" (via the ?? "" key fallback), violating
    // supplyActual_locationId_fkey and aborting the whole run. Skip it.
    if (!line.itemId || !line.quantityToReceive || !line.locationId) continue;

    const dueDate = parseDate(jobCompletionDate(line, today.toString()));

    const period = findPeriod(dueDate, today, periods);
    if (!period) continue;

    const periodKey = makeKey(
      line.locationId ?? "",
      period.id ?? "",
      line.itemId,
      segmentOf(line.planningSegmentId, line.ownerProjectId)
    );
    jobSupplyByLocationPeriodItem.set(
      periodKey,
      (jobSupplyByLocationPeriodItem.get(periodKey) ?? 0) +
        line.quantityToReceive
    );
  }

  const poSupplyByLocationPeriodItem = new Map<string, number>();

  for (const line of input.purchaseOrderLines) {
    // See the productionLines guard above: a null locationId would write
    // supplyActual with locationId="" and violate its FK.
    if (!line.itemId || !line.quantityToReceive || !line.locationId) continue;

    // Same date the reschedule check walks (supply-date.ts) — the projection
    // and the Expedite / Defer verdicts must see one arrival date per line.
    const dueDate = parseDate(
      purchaseOrderLineArrivalDate(line, today.toString())
    );

    const period = findPeriod(dueDate, today, periods);
    if (!period) continue;

    const periodKey = makeKey(
      line.locationId ?? "",
      period.id ?? "",
      line.itemId,
      segmentOf(line.planningSegmentId, line.ownerProjectId)
    );
    poSupplyByLocationPeriodItem.set(
      periodKey,
      (poSupplyByLocationPeriodItem.get(periodKey) ?? 0) +
        line.quantityToReceive
    );
  }

  // An open borrow is firm supply to the lender: the borrower pays it back
  // on the payback due date.
  const borrowSupplyByLocationPeriodItem = new Map<string, number>();
  for (const borrow of input.projectBorrows ?? []) {
    if (!borrow.itemId || !borrow.locationId || !borrow.quantity) continue;
    if (borrow.quantity <= 0) continue;
    const period = borrowPeriod(borrow.paybackDueDate, today, periods);
    if (!period) continue;
    const periodKey = makeKey(
      borrow.locationId,
      period.id,
      borrow.itemId,
      segmentOf(borrow.lenderSegmentId, borrow.lenderProjectId)
    );
    borrowSupplyByLocationPeriodItem.set(
      periodKey,
      (borrowSupplyByLocationPeriodItem.get(periodKey) ?? 0) + borrow.quantity
    );
  }

  // ──────────────────────────────────────────────────────────────
  // PHASE 4: Collect independent demands (no BOM explosion yet)
  // ──────────────────────────────────────────────────────────────

  // grossDemand: Map<"locationId-periodId-itemId", quantity>
  const grossDemand = new Map<string, number>();

  // Track actual demands separately for demandActual output
  const salesDemandByKey = new Map<string, number>();
  const jobMaterialDemandByKey = new Map<string, number>();
  const projectMaterialDemandByKey = new Map<string, number>();
  const borrowDemandByKey = new Map<string, number>();

  // Top-level contributors (from sales orders and job materials) — keyed by
  // grossDemand key. Used as the starting contributor set when BOM explosion
  // first reaches a level-0 Make item.
  const topLevelContributors = new Map<string, DemandContributor[]>();

  // Forecast-consumption prelude. The projections loop moved BELOW the two
  // actual-demand loops so their quantities can consume the forecast before
  // it enters gross demand. Actuals consume at their own period first, then
  // backward/forward per the company window (consumeForecast).
  const periodIndexById = new Map<string, number>();
  periods.forEach((p: DemandPeriod, index: number) => {
    if (p.id) periodIndexById.set(p.id, index);
  });
  // locationId␟itemId (makeLocationItemKey) -> periodIndex -> consuming qty
  const consumptionActuals = new Map<string, Map<number, number>>();
  // Actuals dated before this are backlog and consume no forecast.
  const firstPeriodStart = periods[0]?.startDate ?? today;
  const addConsumption = (
    locationId: string,
    itemId: string,
    periodId: string,
    quantity: number
  ) => {
    const periodIndex = periodIndexById.get(periodId);
    if (periodIndex === undefined || quantity <= 0) return;
    const key = makeLocationItemKey(locationId, itemId);
    const byPeriod = consumptionActuals.get(key) ?? new Map<number, number>();
    byPeriod.set(periodIndex, (byPeriod.get(periodIndex) ?? 0) + quantity);
    consumptionActuals.set(key, byPeriod);
  };
  // Persisted in Phase 7 for EVERY loaded projection row (0 included, so a
  // stale consumedQuantity from a prior run is always overwritten).
  const consumptionUpdates: Array<{
    itemId: string;
    locationId: string;
    periodId: string;
    consumedQuantity: number;
  }> = [];

  // Sales order lines
  for (const line of input.salesOrderLines) {
    // A null locationId would write demandForecast/demandActual with
    // locationId="" and violate their locationId FK — skip (see above).
    // quantityToConsume is the line's PRE-job-dedup open quantity: an MTO
    // line fully covered by its linked job has quantityToSend 0 but must
    // still consume the forecast that predicted it — otherwise the forecast
    // remainder drives phantom stock production on top of the job.
    const quantityToSend = line.quantityToSend ?? 0;
    const quantityToConsume = line.quantityToConsume ?? 0;
    if (!line.itemId || !line.locationId) continue;
    if (quantityToSend <= 0 && quantityToConsume <= 0) continue;

    const promiseDate = line.promisedDate
      ? parseDate(line.promisedDate)
      : today;
    const period = findPeriod(promiseDate, today, periods);
    if (!period) continue;

    if (actualConsumesForecast(promiseDate, firstPeriodStart)) {
      addConsumption(
        line.locationId,
        line.itemId,
        period.id,
        quantityToConsume
      );
    }
    if (quantityToSend <= 0) continue;

    const key = makeKey(line.locationId ?? "", period.id ?? "", line.itemId);
    grossDemand.set(key, (grossDemand.get(key) ?? 0) + quantityToSend);

    const actualKey = makeActualKey(
      line.itemId,
      line.locationId ?? "",
      period.id ?? "",
      "Sales Order"
    );
    salesDemandByKey.set(
      actualKey,
      (salesDemandByKey.get(actualKey) ?? 0) + quantityToSend
    );

    if (line.id && line.itemId) {
      const contributors = topLevelContributors.get(key) ?? [];
      contributors.push({
        sourceType: "Sales Order",
        salesOrderLineId: line.id,
        parentItemId: line.itemId,
        quantity: quantityToSend
      });
      topLevelContributors.set(key, contributors);
    }
  }

  // Job material lines
  for (const line of input.jobMaterialLines) {
    // A null locationId would write demandForecast/demandActual with
    // locationId="" and violate their locationId FK — skip (see above).
    if (!line.itemId || !line.quantityToIssue || !line.locationId) continue;
    const segmentId = segmentOf(line.planningSegmentId, line.ownerProjectId);

    const dueDate = line.dueDate ? parseDate(line.dueDate) : today;
    const requiredDate = dueDate.add({ days: -(line.leadTime ?? 7) });
    const period = findPeriod(requiredDate, today, periods);
    if (!period) continue;

    // Real dependent demand consumes component-level forecast too. Backlog
    // is judged on the job's due date, not the lead-time-shifted required
    // date: a job due this week whose material should have been ordered
    // last week is this week's demand. Forecasts are common, so only common
    // demand consumes them.
    if (
      segmentId === COMMON_SEGMENT &&
      actualConsumesForecast(dueDate, firstPeriodStart)
    ) {
      addConsumption(
        line.locationId,
        line.itemId,
        period.id,
        line.quantityToIssue
      );
    }

    const key = makeKey(
      line.locationId ?? "",
      period.id ?? "",
      line.itemId,
      segmentId
    );
    grossDemand.set(key, (grossDemand.get(key) ?? 0) + line.quantityToIssue);

    const actualKey = makeActualKey(
      line.itemId,
      line.locationId ?? "",
      period.id ?? "",
      "Job Material",
      segmentId
    );
    jobMaterialDemandByKey.set(
      actualKey,
      (jobMaterialDemandByKey.get(actualKey) ?? 0) + line.quantityToIssue
    );

    if (line.jobId && line.itemId) {
      const contributors = topLevelContributors.get(key) ?? [];
      contributors.push({
        sourceType: "Job Material",
        jobId: line.jobId,
        parentItemId: line.itemId,
        quantity: line.quantityToIssue,
        perAssemblyQuantity: Number(line.quantityPerParent) || undefined,
        ...(segmentId === COMMON_SEGMENT ? {} : { segmentId }),
        // A grouped job has no project: its pegs split this demand later.
        ...memberAttribution(
          segmentId,
          line.ownerProjectId,
          line.projectElementId,
          requiredDate.toString()
        )
      });
      topLevelContributors.set(key, contributors);
    }
  }

  // Project materials: open plan-line materials, demand on their required
  // date in their project's segment. They consume no forecast.
  for (const line of input.projectMaterialLines ?? []) {
    if (!line.id || !line.itemId || !line.locationId || !line.quantity)
      continue;
    if (line.quantity <= 0) continue;
    const segmentId = segmentOf(line.planningSegmentId, line.projectId);
    const requiredDate = line.requiredDate
      ? parseDate(line.requiredDate)
      : today;
    const period = findPeriod(requiredDate, today, periods);
    if (!period) continue;

    const key = makeKey(line.locationId, period.id, line.itemId, segmentId);
    grossDemand.set(key, (grossDemand.get(key) ?? 0) + line.quantity);

    const actualKey = makeActualKey(
      line.itemId,
      line.locationId,
      period.id,
      "Project Material",
      segmentId
    );
    projectMaterialDemandByKey.set(
      actualKey,
      (projectMaterialDemandByKey.get(actualKey) ?? 0) + line.quantity
    );

    const contributors = topLevelContributors.get(key) ?? [];
    contributors.push({
      sourceType: "Project Material",
      projectElementMaterialId: line.id,
      parentItemId: line.itemId,
      quantity: line.quantity,
      ...(segmentId === COMMON_SEGMENT ? {} : { segmentId }),
      ...memberAttribution(
        segmentId,
        line.projectId,
        line.projectElementId,
        requiredDate.toString()
      )
    });
    topLevelContributors.set(key, contributors);
  }

  // An open borrow is firm demand on the borrower: it pays the lender back
  // on the payback due date. It has no lineage source type: only a group
  // segment gets a contributor, for the pegging, and it writes no lineage row.
  for (const borrow of input.projectBorrows ?? []) {
    if (!borrow.itemId || !borrow.locationId || !borrow.quantity) continue;
    if (borrow.quantity <= 0) continue;
    const period = borrowPeriod(borrow.paybackDueDate, today, periods);
    if (!period) continue;
    const segmentId = segmentOf(
      borrow.borrowerSegmentId,
      borrow.borrowerProjectId
    );
    const key = makeKey(borrow.locationId, period.id, borrow.itemId, segmentId);
    grossDemand.set(key, (grossDemand.get(key) ?? 0) + borrow.quantity);
    if (groupSegments.has(segmentId) && borrow.id) {
      const contributors = topLevelContributors.get(key) ?? [];
      contributors.push({
        sourceType: "Project Borrow",
        projectBorrowId: borrow.id,
        parentItemId: borrow.itemId,
        quantity: borrow.quantity,
        segmentId,
        ...memberAttribution(
          segmentId,
          borrow.borrowerProjectId,
          null,
          borrow.paybackDueDate ?? today.toString()
        )
      });
      topLevelContributors.set(key, contributors);
    }
    const actualKey = makeActualKey(
      borrow.itemId,
      borrow.locationId,
      period.id,
      "Project Borrow",
      segmentId
    );
    borrowDemandByKey.set(
      actualKey,
      (borrowDemandByKey.get(actualKey) ?? 0) + borrow.quantity
    );
  }

  // Demand projections, net of forecast consumption. Do NOT net firm job/PO
  // supply here — supply is credited exactly once by explodeBom's running
  // balance (which receives jobAndPoSupplyByLocationPeriodItem below);
  // netting it here as well would double-count supply and under-drive child
  // demand. Consumption is a different reconciliation: the actual DEMAND
  // accumulated above consumes the forecast (own period, then backward/
  // forward per the company window), so forecast and actuals never
  // double-count. Only the unconsumed remainder enters gross demand.
  // Consumption runs BEFORE the Phase 4.5 supersession redirect on purpose:
  // the read paths (planning RPCs) do not redirect projections/actuals
  // either, so netting on authored identity keeps engine and grid agreeing.
  const projectionsByLocationItem = new Map<
    string,
    Array<PlanCompanyInputs["demandProjections"][number]>
  >();
  for (const projection of input.demandProjections) {
    // locationId is part of the demandForecast primary key (hence NOT NULL)
    // and an FK to location; a null one would write locationId="" and violate
    // demandForecast_locationId_fkey, aborting the run.
    if (!projection.itemId || !projection.locationId) continue;
    const locationItemKey = makeLocationItemKey(
      projection.locationId,
      projection.itemId
    );
    const rows = projectionsByLocationItem.get(locationItemKey) ?? [];
    rows.push(projection);
    projectionsByLocationItem.set(locationItemKey, rows);
  }

  for (const [locationItemKey, rows] of projectionsByLocationItem) {
    const forecast = new Map<number, number>();
    for (const projection of rows) {
      const periodIndex = periodIndexById.get(projection.periodId);
      if (periodIndex === undefined) continue;
      forecast.set(
        periodIndex,
        (forecast.get(periodIndex) ?? 0) + (projection.forecastQuantity ?? 0)
      );
    }

    const { consumedByPeriod, remainderByPeriod } = consumeForecast({
      forecast,
      actuals: consumptionActuals.get(locationItemKey) ?? new Map(),
      window: consumptionWindow
    });

    for (const projection of rows) {
      const { itemId, locationId, periodId } = projection;
      if (!itemId || !locationId) continue;
      const periodIndex = periodIndexById.get(periodId);
      if (periodIndex === undefined) continue;

      consumptionUpdates.push({
        itemId,
        locationId,
        periodId,
        consumedQuantity: round(consumedByPeriod.get(periodIndex) ?? 0)
      });

      // Round at the compare: the consumed side is a float sum, so an
      // exactly-consumed forecast can leave a ~1e-16 remainder.
      const remainder = round(remainderByPeriod.get(periodIndex) ?? 0);
      if (remainder <= 0) continue;

      const key = makeKey(locationId, periodId, itemId);
      grossDemand.set(key, (grossDemand.get(key) ?? 0) + remainder);

      // Seed top-level contributor for this projection. Use the projection's
      // surrogate id (added in 20260527110002_demand-forecast-source.sql).
      const projectionId = projection.id;
      if (projectionId) {
        const contributors = topLevelContributors.get(key) ?? [];
        contributors.push({
          sourceType: "Demand Projection",
          demandProjectionId: projectionId,
          parentItemId: itemId,
          quantity: remainder
        });
        topLevelContributors.set(key, contributors);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // PHASE 4.5: Supersession demand redirection
  // ──────────────────────────────────────────────────────────────
  // Once a discontinued item's successor is effective, move its demand to the
  // successor before BOM explosion. Consume First exhausts the old item's
  // on-hand first (per location, earliest periods first); Prefer New switches
  // outright (the old part stays available only as a manual fallback). The
  // effectivity check is item-level: redirection begins on the first MRP run
  // on/after successorEffectivityDate.
  const remainingConsumeFirstOnHand = new Map<string, number>();
  const redirectOrder: string[] = [];
  const ordered = new Set<string>();
  const orderAfterHops = (id: string) => {
    if (ordered.has(id) || !redirectByItem.has(id)) return;
    ordered.add(id);
    const next = consumeFirstHops.get(id)?.to;
    if (next) orderAfterHops(next);
    redirectOrder.push(id);
  };
  for (const id of redirectByItem.keys()) orderAfterHops(id);
  redirectOrder.reverse();
  for (const oldItemId of redirectOrder) {
    const collapsed = redirectByItem.get(oldItemId)!;
    const consumeOnHand =
      supersessionByItem.get(oldItemId)?.supersessionMode === "Consume First";
    const { to: successorId, factor } =
      (consumeOnHand ? consumeFirstHops.get(oldItemId) : undefined) ??
      collapsed;

    for (const location of locations) {
      // Consume First draws down the old item's on-hand before redirecting.
      const locationItemKey = makeLocationItemKey(location.id, oldItemId);
      let oldOnHand = consumeOnHand
        ? (baseInventoryByLocationItem.get(locationItemKey) ?? 0)
        : 0;

      for (const period of periods) {
        const oldKey = makeKey(location.id, period.id ?? "", oldItemId);
        const demand = grossDemand.get(oldKey);
        if (!demand) continue;

        const contributors = topLevelContributors.get(oldKey) ?? [];
        topLevelContributors.delete(oldKey);
        const netted = netConsumeFirstContributors({
          itemId: oldItemId,
          contributors,
          grossQty: demand,
          running: consumeOnHand ? oldOnHand : 0,
          factor,
          perAssemblyOf: (c) => c.perAssemblyQuantity ?? 0
        });
        const consumed = netted.consumed;
        if (consumeOnHand) oldOnHand = netted.running;
        const movedContributors = netted.moved;
        // Convert the redirected (old-part) shortfall into successor units.
        const redirect = (demand - consumed) * factor;

        grossDemand.delete(oldKey);

        const keptShare = demand > 0 ? consumed / demand : 1;
        const sumByType = (list: DemandContributor[], type: string) =>
          list
            .filter((c) => c.sourceType === type)
            .reduce((sum, c) => sum + c.quantity, 0);
        for (const [actuals, sourceType] of [
          [jobMaterialDemandByKey, "Job Material"],
          [salesDemandByKey, "Sales Order"]
        ] as const) {
          const actualKey = makeActualKey(
            oldItemId,
            location.id,
            period.id ?? "",
            sourceType
          );
          const actual = actuals.get(actualKey);
          if (!actual) continue;
          const attributed = contributors.some(
            (c) => c.sourceType === sourceType
          );
          const kept = attributed
            ? Math.min(actual, sumByType(netted.kept, sourceType))
            : actual * keptShare;
          if (kept > 0) actuals.set(actualKey, kept);
          else actuals.delete(actualKey);
          const moved = attributed
            ? sumByType(movedContributors, sourceType)
            : (actual - kept) * factor;
          if (moved > 0) {
            const newActualKey = makeActualKey(
              successorId,
              location.id,
              period.id ?? "",
              sourceType
            );
            actuals.set(newActualKey, (actuals.get(newActualKey) ?? 0) + moved);
          }
        }

        if (redirect > 0) {
          const newKey = makeKey(location.id, period.id ?? "", successorId);
          grossDemand.set(newKey, (grossDemand.get(newKey) ?? 0) + redirect);
          if (movedContributors.length > 0) {
            topLevelContributors.set(
              newKey,
              (topLevelContributors.get(newKey) ?? []).concat(movedContributors)
            );
          }
        }
      }
      if (consumeOnHand) {
        remainingConsumeFirstOnHand.set(locationItemKey, oldOnHand);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // PHASE 5: Level-by-level BOM explosion with inventory netting
  // ──────────────────────────────────────────────────────────────

  // Merge open-PO supply into the job-supply map for BOM netting. POs
  // offset gross demand the same way production does, but they're tracked
  // separately above because Phase 4's projection netting and the
  // supplyActual output (later in this function) consume them differently.
  const jobAndPoSupplyByLocationPeriodItem = new Map(
    jobSupplyByLocationPeriodItem
  );
  for (const supply of [
    poSupplyByLocationPeriodItem,
    borrowSupplyByLocationPeriodItem
  ]) {
    for (const [key, qty] of supply) {
      jobAndPoSupplyByLocationPeriodItem.set(
        key,
        (jobAndPoSupplyByLocationPeriodItem.get(key) ?? 0) + qty
      );
    }
  }

  // Project segments explode through the BOM as authored: supersession
  // applies to the common segment only (spec decision 24). The copy is made
  // only when a swap can happen and some demand is in a project segment, so
  // a company with no project stock levels its BOM exactly as before.
  const hasSegmentDemand = [...grossDemand.keys()].some(
    (key) => splitKey(key)[3] !== COMMON_SEGMENT
  );
  const segmentBomByItem =
    redirectByItem.size > 0 && hasSegmentDemand
      ? new Map(
          [...bomByItem].map(([itemId, children]) => [
            itemId,
            children.map((child) => ({ ...child }))
          ])
        )
      : undefined;

  // Substitute superseded components in the BOMs so a parent's explosion
  // generates the successor's demand instead of the old part's. (Top-level
  // demand was handled above; component demand is created here, during
  // explosion, so it must be redirected at the BOM level.)
  const consumeFirstRedirect = new Map<string, Redirect>(consumeFirstHops);
  if (redirectByItem.size > 0) {
    for (const children of bomByItem.values()) {
      for (const child of children) {
        const redirect = redirectByItem.get(child.itemId);
        if (!redirect) continue;
        if (
          supersessionByItem.get(child.itemId)?.supersessionMode ===
          "Consume First"
        ) {
          continue;
        }
        child.redirectedFromItemId = child.itemId;
        child.itemId = redirect.to;
        child.quantity = child.quantity * redirect.factor;
      }
    }
  }

  const onHandForExplosion = new Map(baseInventoryByLocationItem);
  for (const [locationItemKey, remaining] of remainingConsumeFirstOnHand) {
    onHandForExplosion.set(locationItemKey, remaining);
  }

  const {
    bomDerivedDemand,
    demandContributors,
    cycleItemIds,
    commonSurplusDraws
  } = explodeBom({
    grossDemand,
    bomByItem,
    replenishmentSystemByItem,
    leadTimeByItem,
    periods: periods.map((p) => ({ id: p.id ?? "" })),
    onHandByLocationItem: onHandForExplosion,
    jobSupplyByLocationPeriodItem: jobAndPoSupplyByLocationPeriodItem,
    topLevelContributors,
    consumeFirstRedirect,
    commonSurplusBlocked: new Set(
      (input.commonSupplyBlocked ?? []).map((row) =>
        makeLocationItemKey(row.locationId, row.itemId)
      )
    ),
    // A surplus looks over the whole MRP window.
    horizonPeriods: periods.length,
    segmentBomByItem,
    groupSegments
  });

  const groupPegInputs =
    groupSegments.size > 0
      ? groupPegInputsOf({
          groupSegments,
          groupByProject,
          priorityByProject: new Map(
            (input.projectPriorities ?? []).map((row) => [
              row.projectId,
              row.priority
            ])
          ),
          today: today.toString(),
          contributorsByKey: [topLevelContributors, demandContributors],
          onHand: input.onHand,
          purchaseOrderLines: input.purchaseOrderLines.map((line) => ({
            id: line.id,
            itemId: line.itemId,
            locationId: line.locationId,
            segmentId: segmentOf(line.planningSegmentId, line.ownerProjectId),
            ownerProjectId: line.ownerProjectId ?? null,
            availableDate: purchaseOrderLineArrivalDate(line, today.toString()),
            quantity: line.quantityToReceive
          })),
          productionLines: input.productionLines.map((line) => ({
            id: line.id,
            itemId: line.itemId,
            locationId: line.locationId,
            segmentId: segmentOf(line.planningSegmentId, line.ownerProjectId),
            ownerProjectId: line.ownerProjectId ?? null,
            availableDate: jobCompletionDate(line, today.toString()),
            quantity: line.quantityToReceive
          }))
        })
      : [];

  // demandForecast output, keyed by makeKey(location, period, item, segment)
  const demandForecastMap = new Map<
    string,
    Database["public"]["Tables"]["demandForecast"]["Insert"]
  >();

  // Write BOM-derived demand to demandForecast.
  // The demand is already at the correct period (lead-time-offset
  // was applied during propagation), so no further offset needed.
  const demandForecastSourceInserts: DemandForecastSourceInsert[] = [];
  for (const [key, qty] of bomDerivedDemand) {
    if (qty <= 0) continue;
    const [locationId, periodId, itemId, segmentId] = splitKey(key);
    const segment = segmentColumn(segmentId);

    const forecastKey = makeKey(locationId, periodId, itemId, segmentId);
    const existing = demandForecastMap.get(forecastKey);
    if (existing) {
      existing.forecastQuantity = Number(existing.forecastQuantity) + qty;
    } else {
      demandForecastMap.set(forecastKey, {
        itemId,
        locationId,
        periodId,
        ...segment,
        forecastQuantity: qty,
        forecastMethod: "mrp",
        companyId,
        createdBy: userId,
        updatedBy: userId
      });
    }

    const contributors = demandContributors.get(key) ?? [];
    for (const c of contributors) {
      if (c.quantity <= 0) continue;
      if (c.sourceType === "Job Material") {
        demandForecastSourceInserts.push({
          itemId,
          locationId,
          periodId,
          ...segment,
          sourceType: "Job Material",
          jobId: c.jobId,
          salesOrderLineId: null,
          demandProjectionId: null,
          parentItemId: c.parentItemId,
          quantity: c.quantity,
          redirectedFromItemId: c.redirectedFromItemId ?? null,
          companyId
        });
      } else if (c.sourceType === "Sales Order") {
        demandForecastSourceInserts.push({
          itemId,
          locationId,
          periodId,
          ...segment,
          sourceType: "Sales Order",
          jobId: null,
          salesOrderLineId: c.salesOrderLineId,
          demandProjectionId: null,
          parentItemId: c.parentItemId,
          quantity: c.quantity,
          redirectedFromItemId: c.redirectedFromItemId ?? null,
          companyId
        });
      } else if (c.sourceType === "Demand Projection") {
        demandForecastSourceInserts.push({
          itemId,
          locationId,
          periodId,
          ...segment,
          sourceType: "Demand Projection",
          jobId: null,
          salesOrderLineId: null,
          demandProjectionId: c.demandProjectionId,
          parentItemId: c.parentItemId,
          quantity: c.quantity,
          redirectedFromItemId: c.redirectedFromItemId ?? null,
          companyId
        });
      }
      // A Project Material contributor writes no lineage row:
      // demandForecastSource has no column for a plan-line material.
    }
  }

  // ──────────────────────────────────────────────────────────────
  // PHASE 6: Build demandActual and supplyActual records
  // ──────────────────────────────────────────────────────────────

  const demandActualsMap = new Map<
    string,
    Database["public"]["Tables"]["demandActual"]["Insert"]
  >();
  const supplyActualsMap = new Map<
    string,
    Database["public"]["Tables"]["supplyActual"]["Insert"]
  >();

  // Zero out existing demand actuals (they'll be overwritten if still relevant)
  for (const existing of input.existingDemandActuals) {
    const segmentId = existing.planningSegmentId ?? COMMON_SEGMENT;
    const key = makeActualKey(
      existing.itemId,
      existing.locationId ?? "",
      existing.periodId,
      existing.sourceType,
      segmentId
    );
    demandActualsMap.set(key, {
      itemId: existing.itemId,
      locationId: existing.locationId,
      periodId: existing.periodId,
      ...segmentColumn(segmentId),
      actualQuantity: 0,
      sourceType: existing.sourceType,
      companyId,
      createdBy: userId,
      updatedBy: userId
    });
  }

  // Sales order demand actuals
  for (const [key, quantity] of salesDemandByKey) {
    if (quantity > 0) {
      const [itemId, locationId, periodId, , segmentId] = splitActualKey(key);
      demandActualsMap.set(key, {
        itemId,
        locationId,
        periodId,
        ...segmentColumn(segmentId),
        actualQuantity: quantity,
        sourceType: "Sales Order",
        companyId,
        createdBy: userId,
        updatedBy: userId
      });
    }
  }

  // Job material, project material and borrow demand actuals
  for (const [actuals, sourceType] of [
    [jobMaterialDemandByKey, "Job Material"],
    [projectMaterialDemandByKey, "Project Material"],
    [borrowDemandByKey, "Project Borrow"]
  ] as const) {
    for (const [key, quantity] of actuals) {
      if (quantity > 0) {
        const [itemId, locationId, periodId, , segmentId] = splitActualKey(key);
        demandActualsMap.set(key, {
          itemId,
          locationId,
          periodId,
          ...segmentColumn(segmentId),
          actualQuantity: quantity,
          sourceType,
          companyId,
          createdBy: userId,
          updatedBy: userId
        });
      }
    }
  }

  // Zero out existing supply actuals
  for (const existing of input.existingSupplyActuals) {
    const segmentId = existing.planningSegmentId ?? COMMON_SEGMENT;
    const key = makeActualKey(
      existing.itemId,
      existing.locationId ?? "",
      existing.periodId,
      existing.sourceType,
      segmentId
    );
    supplyActualsMap.set(key, {
      itemId: existing.itemId,
      locationId: existing.locationId,
      periodId: existing.periodId,
      ...segmentColumn(segmentId),
      actualQuantity: 0,
      sourceType: existing.sourceType,
      companyId,
      createdBy: userId,
      updatedBy: userId
    });
  }

  // Production order, purchase order and borrow supply actuals
  for (const [supply, sourceType] of [
    [jobSupplyByLocationPeriodItem, "Production Order"],
    [poSupplyByLocationPeriodItem, "Purchase Order"],
    [borrowSupplyByLocationPeriodItem, "Project Borrow"]
  ] as const) {
    for (const [key, quantity] of supply) {
      if (quantity > 0) {
        const [locationId, periodId, itemId, segmentId] = splitKey(key);
        const actualKey = makeActualKey(
          itemId,
          locationId,
          periodId,
          sourceType,
          segmentId
        );
        supplyActualsMap.set(actualKey, {
          itemId,
          locationId,
          periodId,
          ...segmentColumn(segmentId),
          actualQuantity: quantity,
          sourceType,
          companyId,
          createdBy: userId,
          updatedBy: userId
        });
      }
    }
  }

  return {
    demandForecastUpserts: Array.from(demandForecastMap.values()),
    demandForecastSourceInserts,
    demandActualUpserts: Array.from(demandActualsMap.values()),
    supplyActualUpserts: Array.from(supplyActualsMap.values()),
    consumptionUpdates,
    cycleItemIds: [...cycleItemIds],
    commonSurplusDraws: [...commonSurplusDraws].map(([key, quantity]) => {
      const [locationId, periodId, itemId, planningSegmentId] = splitKey(key);
      return { itemId, locationId, periodId, planningSegmentId, quantity };
    }),
    groupPegInputs
  };
}

/** The peg demand source of a contributor; a projection is never pegged. */
function pegSourceOf(
  contributor: DemandContributor
): { sourceType: PegDemandSourceType; sourceId: string } | null {
  switch (contributor.sourceType) {
    case "Job Material":
      return { sourceType: "Job Material", sourceId: contributor.jobId };
    case "Project Material":
      return {
        sourceType: "Project Material",
        sourceId: contributor.projectElementMaterialId
      };
    case "Project Borrow":
      return {
        sourceType: "Project Borrow",
        sourceId: contributor.projectBorrowId
      };
    case "Sales Order":
      return {
        sourceType: "Sales Order",
        sourceId: contributor.salesOrderLineId
      };
    default:
      return null;
  }
}

type PegSupplyRow = {
  id?: string | null;
  itemId: string | null;
  locationId: string | null;
  segmentId: string;
  ownerProjectId: string | null;
  availableDate: string;
  quantity: number | null;
};

/**
 * The demand and the open supply of each planning group segment, per item and
 * location:
 * - demand: every contributor of a group segment key, top-level and
 *   BOM-derived. A grouped job's material has no project; the peg writer
 *   splits it by the job's pegs (`parentSupply`).
 * - supply: each member's own stock, and the open PO lines and jobs of the
 *   segment, grouped (no owner) or owned by a member.
 */
function groupPegInputsOf(args: {
  groupSegments: ReadonlySet<string>;
  groupByProject: ReadonlyMap<string, string>;
  priorityByProject: ReadonlyMap<string, number>;
  today: string;
  contributorsByKey: Map<string, DemandContributor[]>[];
  onHand: PlanCompanyInputs["onHand"];
  purchaseOrderLines: PegSupplyRow[];
  productionLines: PegSupplyRow[];
}): GroupPegInput[] {
  const inputs = new Map<string, GroupPegInput>();
  const inputFor = (groupId: string, itemId: string, locationId: string) => {
    const key = [groupId, itemId, locationId].join(KEY_SEP);
    let input = inputs.get(key);
    if (!input) {
      input = {
        planningGroupId: groupId,
        itemId,
        locationId,
        demands: [],
        supplies: []
      };
      inputs.set(key, input);
    }
    return input;
  };

  for (const contributorsByKey of args.contributorsByKey) {
    for (const [key, contributors] of contributorsByKey) {
      const [locationId, , itemId, segmentId] = splitKey(key);
      if (!args.groupSegments.has(segmentId)) continue;
      for (const contributor of contributors) {
        const source = pegSourceOf(contributor);
        if (!source || contributor.quantity <= 0) continue;
        const projectId = contributor.projectId ?? "";
        const demand: PegDemand = {
          projectId,
          projectElementId: contributor.projectElementId ?? null,
          priority: args.priorityByProject.get(projectId) ?? 100,
          ...source,
          needDate: contributor.needDate ?? args.today,
          quantity: contributor.quantity
        };
        if (!projectId && contributor.sourceType === "Job Material") {
          demand.parentSupply = {
            supplyType: "Job",
            supplyId: contributor.jobId
          };
        }
        inputFor(segmentId, itemId, locationId).demands.push(demand);
      }
    }
  }

  for (const row of args.onHand) {
    const groupId = row.projectId
      ? args.groupByProject.get(row.projectId)
      : undefined;
    const quantity = Number(row.quantityOnHand) || 0;
    if (!groupId || !row.itemId || !row.locationId || quantity <= 0) continue;
    inputFor(groupId, row.itemId, row.locationId).supplies.push({
      supplyType: "Stock",
      supplyId: row.projectId!,
      ownerProjectId: row.projectId!,
      availableDate: args.today,
      quantity
    });
  }

  for (const [rows, supplyType] of [
    [args.purchaseOrderLines, "Purchase Order Line"],
    [args.productionLines, "Job"]
  ] as const) {
    for (const row of rows) {
      const quantity = Number(row.quantity) || 0;
      if (!row.id || !row.itemId || !row.locationId || quantity <= 0) continue;
      if (!args.groupSegments.has(row.segmentId)) continue;
      const supply: PegSupply = {
        supplyType,
        supplyId: row.id,
        ownerProjectId: row.ownerProjectId,
        availableDate: row.availableDate,
        quantity
      };
      inputFor(row.segmentId, row.itemId, row.locationId).supplies.push(supply);
    }
  }

  return [...inputs.values()];
}

/** The active make method of each item (one per item, the last row wins). */
export function activeMethodIdByItem(
  activeMethods: PlanCompanyInputs["activeMethods"]
): Map<string, string> {
  const methodIdByItem = new Map<string, string>();
  for (const m of activeMethods) {
    if (m.id && m.itemId) {
      methodIdByItem.set(m.itemId, m.id);
    }
  }
  return methodIdByItem;
}

/** The period of a borrow's payback due date; an overdue borrow is due now. */
function borrowPeriod(
  paybackDueDate: string | null,
  today: CalendarDate,
  periods: DemandPeriod[]
): DemandPeriod | undefined {
  return findPeriod(
    paybackDueDate ? parseDate(paybackDueDate) : today,
    today,
    periods
  );
}

export function findPeriod(
  date: CalendarDate,
  today: CalendarDate,
  periods: DemandPeriod[]
): DemandPeriod | undefined {
  if (date.compare(today) < 0) {
    return periods[0];
  }
  return periods.find(
    (p) => p.startDate?.compare(date) <= 0 && p.endDate?.compare(date) >= 0
  );
}
