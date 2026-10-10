// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomUUID } from "node:crypto";
import { type Database, getCompanyTimeZone } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { fetchAll } from "@carbon/database/fetch-all";
import type { MethodType } from "@carbon/database/mrp-engine";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import {
  type CalendarDate,
  parseDate,
  startOfWeek
} from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { toIsoDate } from "../scheduling/date-utils.ts";
import { activeMethodIdByItem, planCompany } from "./plan-company.ts";
import { generatePlanningActions } from "./planning-actions.ts";

const logger = getLogger("planning", "mrp");

const WEEKS_TO_FORECAST = 18 * 4;

// The period objects this module builds carry CalendarDate start/end (via
// parseDate) and are compared with CalendarDate.compare — the previous
// Omit<period.Row> annotation typed the dates as string and was never enforced.
// This matches the actual runtime shape.
type DemandPeriod = {
  id: string;
  startDate: CalendarDate;
  endDate: CalendarDate;
  periodType: Database["public"]["Tables"]["period"]["Row"]["periodType"];
  createdAt: string;
};

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("company"),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("location"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("item"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("job"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("purchaseOrder"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string()
  }),
  z.object({
    type: z.literal("salesOrder"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string()
  })
]);

export type MrpPayload = z.infer<typeof payloadValidator>;
export type MrpResult = { success: true };

/**
 * Material Requirements Planning, run in-process in Node. The caller supplies
 * a service-role Supabase client (PostgREST reads) and a Kysely handle (the
 * atomic Phase-7 write), and authenticates before calling — this function does
 * not re-check permissions. Throws on failure so the caller (ERP route /
 * Inngest cron) can report it.
 */
export async function runMrp(
  client: SupabaseClient<Database>,
  db: Kysely<DB>,
  payload: unknown
): Promise<MrpResult> {
  const parsedPayload = payloadValidator.parse(payload);
  const { type, companyId, userId } = parsedPayload;

  logger.info("run started", { type, companyId, userId });

  const today = datetime.today(await getCompanyTimeZone(db, companyId));
  const ranges = getStartAndEndDates(today, "Week");
  const periods = await getOrCreateDemandPeriods(db, ranges, "Week");

  const locations = await client
    .from("location")
    .select("*")
    .eq("companyId", companyId);
  if (locations.error) throw locations.error;

  try {
    // ──────────────────────────────────────────────────────────────
    // PHASE 1: Bulk data pre-loading
    //
    // Every PostgREST read is paginated via fetchAll: production caps
    // responses at max_rows = 1000, and tenants exceed that on these views
    // (2,497 open job material lines observed) — an uncapped read plans on
    // silently truncated demand. The `.order("id")` keeps pages stable.
    // ──────────────────────────────────────────────────────────────

    const [
      salesOrderLines,
      jobMaterialLines,
      productionLines,
      purchaseOrderLines,
      demandProjections,
      projectMaterialLines,
      projectBorrows
    ] = await Promise.all([
      fetchAll<Database["public"]["Views"]["openSalesOrderLines"]["Row"]>(() =>
        client
          .from("openSalesOrderLines")
          .select("*")
          .eq("companyId", companyId)
          .order("id")
      ),
      fetchAll<Database["public"]["Views"]["openJobMaterialLines"]["Row"]>(() =>
        client
          .from("openJobMaterialLines")
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
      ),
      fetchAll<Database["public"]["Views"]["openPurchaseOrderLines"]["Row"]>(
        () =>
          client
            .from("openPurchaseOrderLines")
            .select("*")
            .eq("companyId", companyId)
            .order("id")
      ),
      fetchAll<Database["public"]["Tables"]["demandProjection"]["Row"]>(() =>
        client
          .from("demandProjection")
          .select("*")
          .eq("companyId", companyId)
          .in(
            "periodId",
            periods.map((p: DemandPeriod) => p.id ?? "").filter(Boolean)
          )
          .order("id")
      ),
      fetchAll<Database["public"]["Views"]["openProjectMaterialLines"]["Row"]>(
        () =>
          client
            .from("openProjectMaterialLines")
            .select("*")
            .eq("companyId", companyId)
            .order("id")
      ),
      fetchAll<Database["public"]["Views"]["openProjectBorrows"]["Row"]>(() =>
        client
          .from("openProjectBorrows")
          .select("*")
          .eq("companyId", companyId)
          .order("id")
      )
    ]);

    if (salesOrderLines.error)
      throw new Error("Failed to load sales order lines");
    if (jobMaterialLines.error)
      throw new Error("Failed to load job material lines");
    if (productionLines.error)
      throw new Error("Failed to load production orders");
    if (purchaseOrderLines.error)
      throw new Error("Failed to load purchase order lines");
    if (demandProjections.error)
      throw new Error("Failed to load demand projections");
    if (projectMaterialLines.error)
      throw new Error("Failed to load project material lines");
    if (projectBorrows.error) throw new Error("Failed to load project borrows");

    // Forecast-consumption window (weekly periods): how far an actual reaches
    // to consume forecast beyond its own week — backward first, then forward.
    const consumptionSettings = await client
      .from("companySettings")
      .select(
        "forecastConsumptionBackwardPeriods, forecastConsumptionForwardPeriods"
      )
      .eq("id", companyId)
      .maybeSingle();
    // No fallback to the defaults on a failed read: the window decides how much
    // forecast is consumed, and that result is persisted for every read path.
    if (consumptionSettings.error) throw consumptionSettings.error;
    const consumptionWindow = {
      backwardPeriods:
        consumptionSettings.data?.forecastConsumptionBackwardPeriods ?? 4,
      forwardPeriods:
        consumptionSettings.data?.forecastConsumptionForwardPeriods ?? 1
    };

    // Bulk-load item metadata
    const [allItems, allReplenishments] = await Promise.all([
      db
        .selectFrom("item")
        .select(["id", "replenishmentSystem"])
        .where("companyId", "=", companyId)
        .execute(),
      db
        .selectFrom("itemReplenishment")
        .select(["itemId", "leadTime"])
        .where("companyId", "=", companyId)
        .execute()
    ]);

    // Supersession config per discontinued item (drives demand redirection).
    // Loaded via the supabase client (like the other demand inputs) so DATE
    // columns come back as "YYYY-MM-DD" strings — Kysely/node-pg would hand back
    // JS Date objects, which parseDate() can't take.
    const supersessions = await fetchAll<{
      itemId: string;
      supersessionMode: Database["public"]["Enums"]["supersessionMode"];
      successorItemId: string | null;
      successorEffectivityDate: string | null;
      conversionFactor: number | null;
    }>(() =>
      client
        .from("itemSupersession")
        .select(
          "itemId, supersessionMode, successorItemId, successorEffectivityDate, conversionFactor"
        )
        .eq("companyId", companyId)
        .order("itemId")
    );
    if (supersessions.error) throw new Error("Failed to load supersessions");

    // Bulk-load inventory by location+item from the trigger-maintained
    // aggregate: transactionally current and an indexed read of a few hundred
    // rows, where the previous full-ledger GROUP BY grew with total history
    // (~6-8s of an 8M-row tenant's run). Semantics deliberately follow the
    // aggregate: Rejected tracked stock is NOT available to plan against,
    // matching get_inventory_quantities — the raw ledger sum counted it.
    //
    // Every stripe is read: planCompany sums each into its netting segment
    // (a project with project stock, else common), the rule of the SQL
    // project_planning_segment. The projects with project stock are read
    // once for that mapping.
    const [
      inventoryRows,
      stockedProjects,
      commonSupplyBlocked,
      planningGroupRows,
      groupMemberRows
    ] = await Promise.all([
      db
        .selectFrom("itemStockQuantities")
        .select(["itemId", "locationId", "projectId", "quantityOnHand"])
        .where("companyId", "=", companyId)
        .execute(),
      db
        .selectFrom("project")
        .select(["id"])
        .where("companyId", "=", companyId)
        .where("projectStock", "=", true)
        .execute(),
      // Items whose project segments may not draw common stock.
      db
        .selectFrom("itemPlanning")
        .select(["itemId", "locationId"])
        .where("companyId", "=", companyId)
        .where("allowCommonSupplyForProjects", "=", false)
        .execute(),
      // Projects Phase 3: the planning groups and their members. A member
      // has project stock (project_planningGroup_stock_check).
      db
        .selectFrom("planningGroup")
        .select(["id", "active", "priorityRule"])
        .where("companyId", "=", companyId)
        .execute(),
      db
        .selectFrom("project")
        .select(["id", "planningGroupId", "planningPriority"])
        .where("companyId", "=", companyId)
        .where("planningGroupId", "is not", null)
        .where("projectStock", "=", true)
        .execute()
    ]);

    // Planning groups are commercial (PLANNING_GROUPS). Without the feature
    // the run degrades: members net in their own segments and no group
    // segment exists. The plan is read only when the company has a group.
    const planningGroupsEnabled =
      planningGroupRows.length > 0 &&
      (await companyHasPlanningGroups(client, companyId));
    const activeGroupIds = new Set(
      planningGroupRows.filter((group) => group.active).map((group) => group.id)
    );
    const planningGroups = planningGroupsEnabled
      ? [...activeGroupIds].map((id) => ({
          id,
          memberProjectIds: groupMemberRows
            .filter((project) => project.planningGroupId === id)
            .map((project) => project.id)
        }))
      : [];
    const ungroupedPlanningGroupIds = planningGroupsEnabled
      ? []
      : planningGroupRows.map((group) => group.id);

    // Bulk-load all BOMs: use activeMakeMethods view (returns one method per item,
    // prioritizing 'Active' status then highest version — same logic as get_method_tree)
    const activeMethodsResult = await fetchAll<{
      id: string | null;
      itemId: string | null;
    }>(() =>
      client
        .from("activeMakeMethods")
        .select("id, itemId")
        .eq("companyId", companyId)
        .order("id")
    );
    if (activeMethodsResult.error) throw activeMethodsResult.error;

    const allMethodIds = Array.from(
      activeMethodIdByItem(activeMethodsResult.data ?? []).values()
    );
    let allMaterials: {
      id: string;
      makeMethodId: string;
      materialMakeMethodId: string | null;
      itemId: string;
      quantity: number;
      methodType: MethodType;
    }[] = [];

    if (allMethodIds.length > 0) {
      allMaterials = (await db
        .selectFrom("methodMaterial")
        .select([
          "id",
          "makeMethodId",
          "materialMakeMethodId",
          "itemId",
          "quantity",
          "methodType"
        ])
        .where("companyId", "=", companyId)
        .where("makeMethodId", "in", allMethodIds)
        .execute()) as typeof allMaterials;
    }

    // Paginated: a single tenant's actuals exceed the production max_rows cap
    // (9,391 rows observed), and a truncated read here leaves stale actuals
    // un-zeroed. Ordering by the primary key keeps pages stable.
    const [
      { data: existingDemandActuals, error: demandActualsError },
      { data: existingSupplyActuals, error: supplyActualsError }
    ] = await Promise.all([
      fetchAll<Database["public"]["Tables"]["demandActual"]["Row"]>(() =>
        client
          .from("demandActual")
          .select("*")
          .eq("companyId", companyId)
          .in(
            "periodId",
            periods.map((p) => p.id ?? "")
          )
          .order("itemId")
          .order("locationId")
          .order("periodId")
          .order("sourceType")
          .order("planningSegmentId")
      ),
      fetchAll<Database["public"]["Tables"]["supplyActual"]["Row"]>(() =>
        client
          .from("supplyActual")
          .select("*")
          .eq("companyId", companyId)
          .in(
            "periodId",
            periods.map((p: DemandPeriod) => p.id ?? "").filter(Boolean)
          )
          .order("itemId")
          .order("locationId")
          .order("periodId")
          .order("sourceType")
          .order("planningSegmentId")
      )
    ]);

    if (demandActualsError) throw demandActualsError;
    if (supplyActualsError) throw supplyActualsError;

    // ──────────────────────────────────────────────────────────────
    // PHASES 3–6: the pure planning core (plan-company.ts)
    // ──────────────────────────────────────────────────────────────

    const {
      demandForecastUpserts,
      demandForecastSourceInserts,
      demandActualUpserts,
      supplyActualUpserts,
      consumptionUpdates,
      cycleItemIds,
      commonSurplusDraws,
      groupPegInputs
    } = planCompany({
      companyId,
      userId,
      today: today.toString(),
      periods: periods.map((p: DemandPeriod) => ({
        id: p.id ?? "",
        startDate: p.startDate.toString(),
        endDate: p.endDate.toString()
      })),
      locationIds: locations.data.map((l) => l.id),
      consumptionWindow,
      salesOrderLines: salesOrderLines.data ?? [],
      jobMaterialLines: jobMaterialLines.data ?? [],
      productionLines: productionLines.data ?? [],
      purchaseOrderLines: purchaseOrderLines.data ?? [],
      demandProjections: demandProjections.data ?? [],
      projectMaterialLines: projectMaterialLines.data ?? [],
      projectBorrows: projectBorrows.data ?? [],
      stockedProjectIds: stockedProjects.map((project) => project.id),
      planningGroups,
      ungroupedPlanningGroupIds,
      projectPriorities: groupMemberRows.map((project) => ({
        projectId: project.id,
        priority: project.planningPriority
      })),
      commonSupplyBlocked,
      items: allItems,
      replenishments: allReplenishments,
      supersessions: supersessions.data ?? [],
      onHand: inventoryRows,
      activeMethods: activeMethodsResult.data ?? [],
      materials: allMaterials,
      existingDemandActuals: existingDemandActuals ?? [],
      existingSupplyActuals: existingSupplyActuals ?? []
    });

    if (cycleItemIds.length > 0) {
      logger.warn(
        "BOM cycle detected — cycle items were planned as leaf items (no explosion through them)",
        { companyId, itemIds: cycleItemIds }
      );
    }

    // ──────────────────────────────────────────────────────────────
    // PHASE 7: Persist results (chunked batch writes)
    // ──────────────────────────────────────────────────────────────

    const BATCH_SIZE = 500;

    try {
      // One transaction for the whole delete-and-rewrite: these statements
      // previously ran independently, so a crash mid-sequence (or a reader
      // between the delete and the inserts) saw planning data half-written —
      // fresh forecasts with empty actuals. All-or-nothing now; Kysely rolls
      // everything back on any throw.
      await db.transaction().execute(async (trx) => {
        // Delete existing MRP forecasts
        await trx
          .deleteFrom("demandForecast")
          .where("companyId", "=", companyId)
          .where("forecastMethod", "=", "mrp")
          .execute();

        // Delete existing MRP forecast source rows. The demandForecast delete
        // above removes the parent rows; this removes their attribution rows.
        // demandForecastSource only ever holds MRP-derived rows.
        await trx
          .deleteFrom("demandForecastSource")
          .where("companyId", "=", companyId)
          .execute();

        // Guarded: an empty array renders as `IN ()`, which is a syntax error
        // (42601), so a company with no locations configured crashed the whole
        // run. Nothing to clear in that case anyway.
        if (locations.data.length > 0) {
          await trx
            .deleteFrom("supplyForecast")
            .where(
              "locationId",
              "in",
              locations.data.map((l) => l.id)
            )
            .where("companyId", "=", companyId)
            .execute();
        }

        // Insert demand forecasts in batches
        for (let i = 0; i < demandForecastUpserts.length; i += BATCH_SIZE) {
          const batch = demandForecastUpserts.slice(i, i + BATCH_SIZE);
          await trx
            .insertInto("demandForecast")
            .values(batch)
            .onConflict((oc) =>
              oc
                .columns([
                  "itemId",
                  "locationId",
                  "periodId",
                  "planningSegmentId"
                ])
                .doUpdateSet({
                  forecastQuantity: (eb) => eb.ref("excluded.forecastQuantity"),
                  forecastMethod: (eb) => eb.ref("excluded.forecastMethod"),
                  updatedAt: datetime.timestamp(),
                  updatedBy: userId
                })
            )
            .execute();
        }

        // Insert demand forecast source rows in batches. No onConflict — the
        // upstream delete guarantees no key collisions.
        for (
          let i = 0;
          i < demandForecastSourceInserts.length;
          i += BATCH_SIZE
        ) {
          const batch = demandForecastSourceInserts.slice(i, i + BATCH_SIZE);
          await trx.insertInto("demandForecastSource").values(batch).execute();
        }

        // Insert demand actuals in batches
        for (let i = 0; i < demandActualUpserts.length; i += BATCH_SIZE) {
          const batch = demandActualUpserts.slice(i, i + BATCH_SIZE);
          await trx
            .insertInto("demandActual")
            .values(batch)
            .onConflict((oc) =>
              oc
                .columns([
                  "itemId",
                  "locationId",
                  "periodId",
                  "sourceType",
                  "planningSegmentId"
                ])
                .doUpdateSet({
                  actualQuantity: (eb) => eb.ref("excluded.actualQuantity"),
                  updatedAt: datetime.timestamp(),
                  updatedBy: userId
                })
            )
            .execute();
        }

        // Insert supply actuals in batches
        for (let i = 0; i < supplyActualUpserts.length; i += BATCH_SIZE) {
          const batch = supplyActualUpserts.slice(i, i + BATCH_SIZE);
          await trx
            .insertInto("supplyActual")
            .values(batch)
            .onConflict((oc) =>
              oc
                .columns([
                  "itemId",
                  "locationId",
                  "periodId",
                  "sourceType",
                  "planningSegmentId"
                ])
                .doUpdateSet({
                  actualQuantity: (eb) => eb.ref("excluded.actualQuantity"),
                  updatedAt: datetime.timestamp(),
                  updatedBy: userId
                })
            )
            .execute();
        }

        // Persist forecast consumption in batches — an UPDATE, not an upsert,
        // so a projection deleted mid-run can never be resurrected by the
        // write phase. Every loaded projection has a row here (0 included),
        // so stale consumption from a prior run is always overwritten.
        // Consumption is derived data, not an edit: the row's updatedAt /
        // updatedBy stay with the planner who entered the forecast, and a row
        // whose consumption did not change is not written at all.
        for (let i = 0; i < consumptionUpdates.length; i += BATCH_SIZE) {
          const batch = consumptionUpdates.slice(i, i + BATCH_SIZE);
          await sql`
            UPDATE "demandProjection" AS dp
            SET "consumedQuantity" = v."consumedQuantity"::numeric
            FROM (VALUES ${sql.join(
              batch.map(
                (r) =>
                  sql`(${r.itemId}, ${r.locationId}, ${r.periodId}, ${r.consumedQuantity})`
              )
            )}) AS v("itemId", "locationId", "periodId", "consumedQuantity")
            WHERE dp."itemId" = v."itemId"
              AND dp."locationId" = v."locationId"
              AND dp."periodId" = v."periodId"
              AND dp."companyId" = ${companyId}
              AND dp."consumedQuantity" IS DISTINCT FROM v."consumedQuantity"::numeric
          `.execute(trx);
        }
      });

      // Persist the planning action messages (spec §P1) in their own atomic
      // transaction AFTER the forecast/actual write commits — the planning
      // RPCs it reads see only committed data. Errors PROPAGATE: the run must
      // not report success with stale actions (forecasts are committed and
      // correct; actions self-heal on the next successful run).
      // The common stock each project segment draws becomes a Transfer.
      // With PLANNING_GROUPS the planning-action transaction also
      // diff-writes the pegs. It runs even with no active group, so the Soft
      // pegs of a group that turned inactive are superseded.
      await generatePlanningActions(client, db, {
        companyId,
        userId,
        commonSurplusDraws,
        planningGroups,
        pegging: planningGroupsEnabled
          ? {
              runId: randomUUID(),
              inputs: groupPegInputs,
              priorityRuleByGroup: Object.fromEntries(
                planningGroupRows.map((group) => [group.id, group.priorityRule])
              ),
              priorityByProject: Object.fromEntries(
                groupMemberRows.map((project) => [
                  project.id,
                  project.planningPriority
                ])
              )
            }
          : undefined
      });

      return { success: true };
    } catch (err) {
      logger.error("write phase failed", { companyId, error: String(err) });
      throw err;
    }
  } catch (err) {
    logger.error("run failed", { companyId, error: String(err) });
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────────────────────

/**
 * Whether the company has the commercial PLANNING_GROUPS feature. The check
 * lives in `@carbon/ee`; it is imported only for a company that has a
 * planning group, so every other run loads no commercial code. A failed
 * check degrades to "no", as `companyHasFeature` callers do.
 */
async function companyHasPlanningGroups(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<boolean> {
  try {
    const { companyHasFeature } = await import("@carbon/ee/plan.server");
    return await companyHasFeature(client, companyId, {
      feature: "PLANNING_GROUPS"
    });
  } catch (err) {
    logger.warn("could not read the planning groups feature", {
      companyId,
      error: String(err)
    });
    return false;
  }
}

function getStartAndEndDates(
  today: CalendarDate,
  groupBy: "Week" | "Day" | "Month"
): { startDate: string; endDate: string }[] {
  const periods: { startDate: string; endDate: string }[] = [];
  const start = startOfWeek(today, "en-US");
  const end = start.add({ weeks: WEEKS_TO_FORECAST });

  switch (groupBy) {
    case "Week": {
      let currentStart = start;
      while (currentStart.compare(end) < 0) {
        const periodEnd = currentStart.add({ days: 6 });
        periods.push({
          startDate: currentStart.toString(),
          endDate: periodEnd.toString()
        });
        currentStart = periodEnd.add({ days: 1 });
      }
      return periods;
    }
    case "Month":
      throw new Error("Not implemented");
    case "Day":
      throw new Error("Not implemented");
    default:
      throw new Error("Invalid groupBy");
  }
}

async function getOrCreateDemandPeriods(
  db: Kysely<DB>,
  periods: { startDate: string; endDate: string }[],
  periodType: "Week" | "Day" | "Month"
) {
  const existingPeriods = await db
    .selectFrom("period")
    .selectAll()
    .where(
      "startDate",
      "in",
      periods.map((p) => p.startDate)
    )
    .where("periodType", "=", periodType)
    .execute();

  if (existingPeriods.length === periods.length) {
    return existingPeriods.map((p) => ({
      id: p.id,
      // pg returns DATE columns as JS Date objects; normalize to "YYYY-MM-DD"
      startDate: parseDate(toIsoDate(p.startDate)!),
      endDate: parseDate(toIsoDate(p.endDate)!),
      periodType: p.periodType,
      createdAt: p.createdAt
    }));
  }

  const existingPeriodMap = new Map(
    existingPeriods.map((p) => [toIsoDate(p.startDate)!, p])
  );

  const periodsToCreate = periods.filter(
    (period) => !existingPeriodMap.has(period.startDate)
  );

  const created = await db.transaction().execute(async (trx) => {
    return await trx
      .insertInto("period")
      .values(
        periodsToCreate.map((period) => ({
          startDate: period.startDate,
          endDate: period.endDate,
          periodType,
          createdAt: datetime.timestamp()
        }))
      )
      .returningAll()
      .execute();
  });

  return [...existingPeriods, ...created].map((p) => ({
    id: p.id,
    // pg returns DATE columns as JS Date objects; normalize to "YYYY-MM-DD"
    startDate: parseDate(toIsoDate(p.startDate)!),
    endDate: parseDate(toIsoDate(p.endDate)!),
    periodType: p.periodType,
    createdAt: p.createdAt
  }));
}
