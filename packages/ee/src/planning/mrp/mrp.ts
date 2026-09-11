import type { Database } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { datetime, getCompanyTimeZone } from "@carbon/database/datetime";
import { fetchAll } from "@carbon/database/fetch-all";
import { getFunctionLogger } from "@carbon/database/logging";
import {
  type BomChild,
  type DemandContributor,
  explodeBom,
  type MethodType,
  makeActualKey,
  makeKey,
  makeLocationItemKey,
  type ReplenishmentSystem,
  splitActualKey,
  splitKey
} from "@carbon/database/mrp-engine";
import { buildSupersessionRedirectMap } from "@carbon/database/supersession-pick";
import { round } from "@carbon/utils";
import {
  type CalendarDate,
  parseDate,
  startOfWeek
} from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { toIsoDate } from "../scheduling/date-utils.ts";
import { consumeForecast } from "./forecast-consumption.ts";
import { generatePlanningActions } from "./planning-actions.ts";

const logger = getFunctionLogger("mrp");

const WEEKS_TO_FORECAST = 18 * 4;

// The period objects this module builds carry CalendarDate start/end (via
// parseDate) and are compared with CalendarDate.compare — the previous
// Omit<period.Row> annotation typed the dates as string and was never enforced
// under Deno. This matches the actual runtime shape.
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
 * Material Requirements Planning, run in-process in Node. Extracted from the
 * former `mrp` Supabase edge function: the caller supplies a service-role
 * Supabase client (PostgREST reads) and a Kysely handle (the atomic Phase-7
 * write), and authenticates before calling — this function does not re-check
 * permissions. Throws on failure so the caller (ERP route / Inngest cron) can
 * report it. Behavior is identical to the edge function.
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
      demandProjections
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

    // Forecast-consumption window (weekly periods): how far an actual reaches
    // to consume forecast beyond its own week — backward first, then forward.
    const consumptionSettings = await client
      .from("companySettings")
      .select(
        "forecastConsumptionBackwardPeriods, forecastConsumptionForwardPeriods"
      )
      .eq("id", companyId)
      .maybeSingle();
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

    const replenishmentSystemByItem = new Map<string, ReplenishmentSystem>();
    for (const item of allItems) {
      replenishmentSystemByItem.set(
        item.id,
        item.replenishmentSystem as ReplenishmentSystem
      );
    }

    const leadTimeByItem = new Map<string, number>();
    for (const rep of allReplenishments) {
      leadTimeByItem.set(rep.itemId, rep.leadTime ?? 7);
    }

    // Supersession config per discontinued item (drives demand redirection).
    // Loaded via the supabase client (like the other demand inputs) so DATE
    // columns come back as "YYYY-MM-DD" strings — Kysely/node-pg would hand back
    // JS Date objects, which parseDate() can't take.
    const supersessions = await fetchAll<{
      itemId: string;
      supersessionMode: string;
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
    const supersessionByItem = new Map<
      string,
      {
        supersessionMode: string;
        successorItemId: string | null;
        successorEffectivityDate: string | null;
        conversionFactor: number;
      }
    >();
    for (const s of supersessions.data ?? []) {
      supersessionByItem.set(s.itemId, {
        supersessionMode: s.supersessionMode,
        successorItemId: s.successorItemId,
        successorEffectivityDate: s.successorEffectivityDate,
        conversionFactor: Number(s.conversionFactor ?? 1) || 1
      });
    }

    // Resolve which superseded items currently redirect to a successor (effective
    // phase-out modes), collapsing multi-hop chains with the cumulative conversion
    // factor. Shared with job creation (get-method) via lib/supersession-pick so the
    // two can never diverge — MRP gates on `today`, get-method gates on the job's
    // build date. (supersessionByItem above is kept for the Consume-First on-hand
    // draw-down below.)
    const redirectByItem = buildSupersessionRedirectMap(
      supersessions.data ?? [],
      today.toString()
    );

    // Bulk-load inventory by location+item from the trigger-maintained
    // aggregate: transactionally current and an indexed read of a few hundred
    // rows, where the previous full-ledger GROUP BY grew with total history
    // (~6-8s of an 8M-row tenant's run). Semantics deliberately follow the
    // aggregate: Rejected tracked stock is NOT available to plan against,
    // matching get_inventory_quantities — the raw ledger sum counted it.
    const inventoryRows = await db
      .selectFrom("itemStockQuantities")
      .select(["itemId", "locationId", "quantityOnHand"])
      .where("companyId", "=", companyId)
      .execute();

    const baseInventoryByLocationItem = new Map<string, number>();
    for (const row of inventoryRows) {
      if (row.itemId && row.locationId) {
        baseInventoryByLocationItem.set(
          makeLocationItemKey(row.locationId, row.itemId),
          Number(row.quantityOnHand) || 0
        );
      }
    }

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

    const methodIdByItem = new Map<string, string>();
    for (const m of activeMethodsResult.data ?? []) {
      if (m.id && m.itemId) {
        methodIdByItem.set(m.itemId, m.id);
      }
    }

    const allMethodIds = Array.from(methodIdByItem.values());
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

    // Build BOM structure: itemId -> direct children
    // Map makeMethodId -> its direct material children
    const materialsByMethodId = new Map<string, typeof allMaterials>();
    for (const mat of allMaterials) {
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

    for (const line of productionLines.data ?? []) {
      // locationId is part of the supplyActual primary key (hence NOT NULL) and
      // an FK to location. A line with no location has nowhere to be planned and
      // would write locationId="" (via the ?? "" key fallback), violating
      // supplyActual_locationId_fkey and aborting the whole run. Skip it.
      if (!line.itemId || !line.quantityToReceive || !line.locationId) continue;

      const dueDate = line.dueDate
        ? parseDate(line.dueDate)
        : line.deadlineType === "No Deadline"
          ? today.add({ days: 30 })
          : today;

      const period = findPeriod(dueDate, today, periods);
      if (!period) continue;

      const periodKey = makeKey(
        line.locationId ?? "",
        period.id ?? "",
        line.itemId
      );
      jobSupplyByLocationPeriodItem.set(
        periodKey,
        (jobSupplyByLocationPeriodItem.get(periodKey) ?? 0) +
          line.quantityToReceive
      );
    }

    const poSupplyByLocationPeriodItem = new Map<string, number>();

    for (const line of purchaseOrderLines.data ?? []) {
      // See the productionLines guard above: a null locationId would write
      // supplyActual with locationId="" and violate its FK.
      if (!line.itemId || !line.quantityToReceive || !line.locationId) continue;

      const dueDate = line.promisedDate
        ? parseDate(line.promisedDate)
        : line.orderDate
          ? parseDate(line.orderDate).add({ days: line.leadTime ?? 7 })
          : today.add({ days: line.leadTime ?? 7 });

      const period = findPeriod(dueDate, today, periods);
      if (!period) continue;

      const periodKey = makeKey(
        line.locationId ?? "",
        period.id ?? "",
        line.itemId
      );
      poSupplyByLocationPeriodItem.set(
        periodKey,
        (poSupplyByLocationPeriodItem.get(periodKey) ?? 0) +
          line.quantityToReceive
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

    // Top-level contributors (from sales orders and job materials) — keyed by
    // grossDemand key. Used as the starting contributor set when BOM explosion
    // first reaches a level-0 Make item.
    const topLevelContributors = new Map<string, DemandContributor[]>();

    type DemandForecastSourceInsert =
      Database["public"]["Tables"]["demandForecastSource"]["Insert"];

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
    for (const line of salesOrderLines.data ?? []) {
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

      addConsumption(
        line.locationId,
        line.itemId,
        period.id,
        quantityToConsume
      );
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
    for (const line of jobMaterialLines.data ?? []) {
      // A null locationId would write demandForecast/demandActual with
      // locationId="" and violate their locationId FK — skip (see above).
      if (!line.itemId || !line.quantityToIssue || !line.locationId) continue;

      const dueDate = line.dueDate ? parseDate(line.dueDate) : today;
      const requiredDate = dueDate.add({ days: -(line.leadTime ?? 7) });
      const period = findPeriod(requiredDate, today, periods);
      if (!period) continue;

      // Real dependent demand consumes component-level forecast too.
      addConsumption(
        line.locationId,
        line.itemId,
        period.id,
        line.quantityToIssue
      );

      const key = makeKey(line.locationId ?? "", period.id ?? "", line.itemId);
      grossDemand.set(key, (grossDemand.get(key) ?? 0) + line.quantityToIssue);

      const actualKey = makeActualKey(
        line.itemId,
        line.locationId ?? "",
        period.id ?? "",
        "Job Material"
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
          quantity: line.quantityToIssue
        });
        topLevelContributors.set(key, contributors);
      }
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
      Array<Database["public"]["Tables"]["demandProjection"]["Row"]>
    >();
    for (const projection of demandProjections.data ?? []) {
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

        const remainder = remainderByPeriod.get(periodIndex) ?? 0;
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
    for (const [oldItemId, { to: successorId, factor }] of redirectByItem) {
      const consumeOnHand =
        supersessionByItem.get(oldItemId)?.supersessionMode === "Consume First";

      for (const location of locations.data) {
        // Consume First draws down the old item's on-hand before redirecting.
        let oldOnHand = consumeOnHand
          ? (baseInventoryByLocationItem.get(
              makeLocationItemKey(location.id, oldItemId)
            ) ?? 0)
          : 0;

        for (const period of periods) {
          const oldKey = makeKey(location.id, period.id ?? "", oldItemId);
          const demand = grossDemand.get(oldKey);
          if (!demand) continue;

          const consumed = Math.min(oldOnHand, demand);
          oldOnHand -= consumed;
          // Convert the redirected (old-part) shortfall into successor units.
          const redirect = (demand - consumed) * factor;

          grossDemand.delete(oldKey);
          const contributors = topLevelContributors.get(oldKey);
          topLevelContributors.delete(oldKey);

          if (redirect > 0) {
            const newKey = makeKey(location.id, period.id ?? "", successorId);
            grossDemand.set(newKey, (grossDemand.get(newKey) ?? 0) + redirect);
            if (contributors) {
              // Mark the moved demand so it can be shown as redirected from the
              // old part on the successor's planning row (in successor units).
              const stamped = contributors.map((c) => ({
                ...c,
                quantity: c.quantity * factor,
                redirectedFromItemId: oldItemId
              }));
              topLevelContributors.set(
                newKey,
                (topLevelContributors.get(newKey) ?? []).concat(stamped)
              );
            }
          }
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
    for (const [key, qty] of poSupplyByLocationPeriodItem) {
      jobAndPoSupplyByLocationPeriodItem.set(
        key,
        (jobAndPoSupplyByLocationPeriodItem.get(key) ?? 0) + qty
      );
    }

    // Substitute superseded components in the BOMs so a parent's explosion
    // generates the successor's demand instead of the old part's. (Top-level
    // demand was handled above; component demand is created here, during
    // explosion, so it must be redirected at the BOM level.)
    if (redirectByItem.size > 0) {
      for (const children of bomByItem.values()) {
        for (const child of children) {
          const redirect = redirectByItem.get(child.itemId);
          if (redirect) {
            child.redirectedFromItemId = child.itemId;
            child.itemId = redirect.to;
            // 1 old part = `factor` successors.
            child.quantity = child.quantity * redirect.factor;
          }
        }
      }
    }

    const { bomDerivedDemand, demandContributors, cycleItemIds } = explodeBom({
      grossDemand,
      bomByItem,
      replenishmentSystemByItem,
      leadTimeByItem,
      periods: periods.map((p) => ({ id: p.id ?? "" })),
      onHandByLocationItem: new Map(baseInventoryByLocationItem),
      jobSupplyByLocationPeriodItem: jobAndPoSupplyByLocationPeriodItem,
      topLevelContributors
    });

    if (cycleItemIds.size > 0) {
      logger.warn(
        "BOM cycle detected — cycle items were planned as leaf items (no explosion through them)",
        { companyId, itemIds: [...cycleItemIds] }
      );
    }

    // demandForecast output: Map<"itemId-locationId-periodId", record>
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
      const [locationId, periodId, itemId] = splitKey(key);

      const forecastKey = makeKey(locationId, periodId, itemId);
      const existing = demandForecastMap.get(forecastKey);
      if (existing) {
        existing.forecastQuantity = Number(existing.forecastQuantity) + qty;
      } else {
        demandForecastMap.set(forecastKey, {
          itemId,
          locationId,
          periodId,
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
            sourceType: "Sales Order",
            jobId: null,
            salesOrderLineId: c.salesOrderLineId,
            demandProjectionId: null,
            parentItemId: c.parentItemId,
            quantity: c.quantity,
            redirectedFromItemId: c.redirectedFromItemId ?? null,
            companyId
          });
        } else {
          // sourceType === "Demand Projection"
          demandForecastSourceInserts.push({
            itemId,
            locationId,
            periodId,
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
      )
    ]);

    if (demandActualsError) throw demandActualsError;
    if (supplyActualsError) throw supplyActualsError;

    // Zero out existing demand actuals (they'll be overwritten if still relevant)
    if (existingDemandActuals) {
      for (const existing of existingDemandActuals) {
        const key = makeActualKey(
          existing.itemId,
          existing.locationId ?? "",
          existing.periodId,
          existing.sourceType
        );
        demandActualsMap.set(key, {
          itemId: existing.itemId,
          locationId: existing.locationId,
          periodId: existing.periodId,
          actualQuantity: 0,
          sourceType: existing.sourceType,
          companyId,
          createdBy: userId,
          updatedBy: userId
        });
      }
    }

    // Sales order demand actuals
    for (const [key, quantity] of salesDemandByKey) {
      if (quantity > 0) {
        const [itemId, locationId, periodId] = splitActualKey(key);
        demandActualsMap.set(key, {
          itemId,
          locationId,
          periodId,
          actualQuantity: quantity,
          sourceType: "Sales Order",
          companyId,
          createdBy: userId,
          updatedBy: userId
        });
      }
    }

    // Job material demand actuals
    for (const [key, quantity] of jobMaterialDemandByKey) {
      if (quantity > 0) {
        const [itemId, locationId, periodId] = splitActualKey(key);
        demandActualsMap.set(key, {
          itemId,
          locationId,
          periodId,
          actualQuantity: quantity,
          sourceType: "Job Material",
          companyId,
          createdBy: userId,
          updatedBy: userId
        });
      }
    }

    // Zero out existing supply actuals
    if (existingSupplyActuals) {
      for (const existing of existingSupplyActuals) {
        const key = makeActualKey(
          existing.itemId,
          existing.locationId ?? "",
          existing.periodId,
          existing.sourceType
        );
        supplyActualsMap.set(key, {
          itemId: existing.itemId,
          locationId: existing.locationId,
          periodId: existing.periodId,
          actualQuantity: 0,
          sourceType: existing.sourceType,
          companyId,
          createdBy: userId,
          updatedBy: userId
        });
      }
    }

    // Production order supply actuals
    for (const [key, quantity] of jobSupplyByLocationPeriodItem) {
      if (quantity > 0) {
        const [locationId, periodId, itemId] = splitKey(key);
        const actualKey = makeActualKey(
          itemId,
          locationId,
          periodId,
          "Production Order"
        );
        supplyActualsMap.set(actualKey, {
          itemId,
          locationId,
          periodId,
          actualQuantity: quantity,
          sourceType: "Production Order",
          companyId,
          createdBy: userId,
          updatedBy: userId
        });
      }
    }

    // Purchase order supply actuals
    for (const [key, quantity] of poSupplyByLocationPeriodItem) {
      if (quantity > 0) {
        const [locationId, periodId, itemId] = splitKey(key);
        const actualKey = makeActualKey(
          itemId,
          locationId,
          periodId,
          "Purchase Order"
        );
        supplyActualsMap.set(actualKey, {
          itemId,
          locationId,
          periodId,
          actualQuantity: quantity,
          sourceType: "Purchase Order",
          companyId,
          createdBy: userId,
          updatedBy: userId
        });
      }
    }

    // ──────────────────────────────────────────────────────────────
    // PHASE 7: Persist results (chunked batch writes)
    // ──────────────────────────────────────────────────────────────

    const demandForecastUpserts = Array.from(demandForecastMap.values());
    const demandActualUpserts = Array.from(demandActualsMap.values());
    const supplyActualUpserts = Array.from(supplyActualsMap.values());

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
              oc.columns(["itemId", "locationId", "periodId"]).doUpdateSet({
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
                .columns(["itemId", "locationId", "periodId", "sourceType"])
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
                .columns(["itemId", "locationId", "periodId", "sourceType"])
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
        for (let i = 0; i < consumptionUpdates.length; i += BATCH_SIZE) {
          const batch = consumptionUpdates.slice(i, i + BATCH_SIZE);
          await sql`
            UPDATE "demandProjection" AS dp
            SET "consumedQuantity" = v."consumedQuantity"::numeric,
                "updatedAt" = ${datetime.timestamp()},
                "updatedBy" = ${userId}
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
          `.execute(trx);
        }
      });

      // Persist the planning action messages (spec §P1) in their own atomic
      // transaction AFTER the forecast/actual write commits — the planning
      // RPCs it reads see only committed data. Errors PROPAGATE: the run must
      // not report success with stale actions (forecasts are committed and
      // correct; actions self-heal on the next successful run).
      await generatePlanningActions(client, db, { companyId, userId });

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

function findPeriod(
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
