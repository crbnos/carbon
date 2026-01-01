import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
    getLocalTimeZone,
    today as getToday,
    parseDate,
    startOfWeek,
    type CalendarDate,
} from "npm:@internationalized/date";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { Kysely } from "kysely";
import z from "npm:zod@^3.24.1";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const WEEKS_TO_FORECAST = 18 * 4;

type DemandPeriod = Omit<
  Database["public"]["Tables"]["period"]["Row"],
  "createdAt"
>;

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("company"),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("location"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("item"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("job"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("purchaseOrder"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("salesOrder"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
]);

// TODO: we can do a reduced version based on the type of the payload, but for now, we're just running full MRP any time it's called

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  const parsedPayload = payloadValidator.parse(payload);
  const { type, companyId, userId } = parsedPayload;

  console.log({
    function: "mrp",
    type,
    companyId,
    userId,
  });

  const today = getToday(getLocalTimeZone());
  const ranges = getStartAndEndDates(today, "Week");
  const periods = await getOrCreateDemandPeriods(db, ranges, "Week");

  const client = await getSupabaseServiceRole(
    req.headers.get("Authorization"),
    req.headers.get("carbon-key") ?? "",
    companyId
  );

  const locations = await client
    .from("location")
    .select("*")
    .eq("companyId", companyId);
  if (locations.error) throw locations.error;

  // Create map to store demand by location, period and item
  const demandProjectionByLocationAndPeriod = new Map<
    string,
    Map<string, Map<string, number>>
  >();

  const requirementsByProjectedItem = new Map<
    string,
    {
      estimatedQuantity: number;
      leadTimeOffset: number;
      replenishmentSystem: "Buy" | "Make";
      methodType: "Make" | "Pick" | "Buy";
    }
  >();

  const salesDemandByLocationAndPeriod = new Map<
    string,
    Map<string, Map<string, number>>
  >();

  const jobMaterialDemandByLocationAndPeriod = new Map<
    string,
    Map<string, Map<string, number>>
  >();

  const jobSupplyByLocationAndPeriod = new Map<
    string,
    Map<string, Map<string, number>>
  >();

  const purchaseOrderSupplyByLocationAndPeriod = new Map<
    string,
    Map<string, Map<string, number>>
  >();

  // Initialize locations in map
  for (const location of locations.data) {
    demandProjectionByLocationAndPeriod.set(
      location.id,
      new Map<string, Map<string, number>>()
    );

    salesDemandByLocationAndPeriod.set(
      location.id,
      new Map<string, Map<string, number>>()
    );

    jobMaterialDemandByLocationAndPeriod.set(
      location.id,
      new Map<string, Map<string, number>>()
    );

    jobSupplyByLocationAndPeriod.set(
      location.id,
      new Map<string, Map<string, number>>()
    );

    purchaseOrderSupplyByLocationAndPeriod.set(
      location.id,
      new Map<string, Map<string, number>>()
    );

    // Initialize periods for each location
    const salesLocationPeriods = salesDemandByLocationAndPeriod.get(
      location.id
    );
    if (salesLocationPeriods) {
      for (const period of periods) {
        salesLocationPeriods.set(period.id ?? "", new Map<string, number>());
      }
    }

    const jobMaterialLocationPeriods = jobMaterialDemandByLocationAndPeriod.get(
      location.id
    );
    if (jobMaterialLocationPeriods) {
      for (const period of periods) {
        jobMaterialLocationPeriods.set(
          period.id ?? "",
          new Map<string, number>()
        );
      }
    }

    const jobSupplyLocationPeriods = jobSupplyByLocationAndPeriod.get(
      location.id
    );
    if (jobSupplyLocationPeriods) {
      for (const period of periods) {
        jobSupplyLocationPeriods.set(
          period.id ?? "",
          new Map<string, number>()
        );
      }
    }

    const purchaseOrderSupplyLocationPeriods =
      purchaseOrderSupplyByLocationAndPeriod.get(location.id);
    if (purchaseOrderSupplyLocationPeriods) {
      for (const period of periods) {
        purchaseOrderSupplyLocationPeriods.set(
          period.id ?? "",
          new Map<string, number>()
        );
      }
    }
  }

  try {
    const [
      salesOrderLines,
      jobMaterialLines,
      productionLines,
      purchaseOrderLines,
      demandProjections,
    ] = await Promise.all([
      client.from("openSalesOrderLines").select("*").eq("companyId", companyId),
      client
        .from("openJobMaterialLines")
        .select("*")
        .eq("companyId", companyId),
      client
        .from("openProductionOrders")
        .select("*")
        .eq("companyId", companyId),
      client
        .from("openPurchaseOrderLines")
        .select("*")
        .eq("companyId", companyId),
      client
        .from("demandProjection")
        .select("*")
        .eq("companyId", companyId)
        .in(
          "periodId",
          periods.map((p) => p.id ?? "")
        ),
    ]);

    if (salesOrderLines.error) {
      throw new Error("No sales order lines found");
    }

    if (jobMaterialLines.error) {
      throw new Error("No job material lines found");
    }

    if (productionLines.error) {
      throw new Error("No job lines found");
    }

    if (purchaseOrderLines.error) {
      throw new Error("No purchase order lines found");
    }

    if (demandProjections.error) {
      throw new Error("No demand projections found");
    }

    // Expand demand projections through BOM tree with on-demand fetching
    // Caches for BOM requirements and metadata
    const leadTimeByItem = new Map<string, number>();
    const replenishmentSystemByItem = new Map<
      string,
      "Buy" | "Make" | "Buy and Make"
    >();

    // Cache for base requirements by item
    const baseRequirementsByItem = new Map<string, ItemRequirement[]>();

    // Helper to fetch item metadata (lead time and replenishment system)
    const fetchItemMetadata = async (itemId: string) => {
      if (leadTimeByItem.has(itemId) && replenishmentSystemByItem.has(itemId)) {
        return; // Already cached
      }

      const [itemReplenishment, item] = await Promise.all([
        client
          .from("itemReplenishment")
          .select("itemId, leadTime")
          .eq("itemId", itemId)
          .eq("companyId", companyId)
          .maybeSingle(),
        client
          .from("item")
          .select("id, replenishmentSystem")
          .eq("id", itemId)
          .eq("companyId", companyId)
          .single(),
      ]);

      if (!itemReplenishment.error && itemReplenishment.data) {
        leadTimeByItem.set(itemId, itemReplenishment.data.leadTime ?? 7);
      } else {
        leadTimeByItem.set(itemId, 7); // Default
      }

      if (!item.error && item.data) {
        replenishmentSystemByItem.set(
          itemId,
          item.data.replenishmentSystem as "Buy" | "Make" | "Buy and Make"
        );
      } else {
        replenishmentSystemByItem.set(itemId, "Buy"); // Default
      }
    };

    // Traverse tree to accumulate quantities and lead times
    const traverseBomTree = (
      node: BomNode,
      parentQuantity: number,
      parentLeadTime: number
    ) => {
      const itemLeadTime = leadTimeByItem.get(node.itemId) ?? 7;
      node.accumulatedQuantity = node.quantity * parentQuantity;
      node.accumulatedLeadTime = parentLeadTime + itemLeadTime;

      // Process children
      for (const child of node.children) {
        traverseBomTree(
          child,
          node.accumulatedQuantity,
          node.accumulatedLeadTime
        );
      }
    };

    // Async function to fetch and process BOM for an item
    const fetchBomRequirements = async (
      itemId: string
    ): Promise<ItemRequirement[]> => {
      // Check cache first
      if (baseRequirementsByItem.has(itemId)) {
        return baseRequirementsByItem.get(itemId)!;
      }

      // Get active make method
      const makeMethod = await client
        .from("activeMakeMethods")
        .select("id")
        .eq("itemId", itemId)
        .eq("companyId", companyId)
        .maybeSingle();

      if (makeMethod.error || !makeMethod.data) {
        baseRequirementsByItem.set(itemId, []);
        return [];
      }

      // Get BOM tree using RPC
      const tree = await client.rpc("get_method_tree", {
        uid: makeMethod.data.id!,
      });

      if (tree.error || !tree.data) {
        console.error(`Failed to get BOM tree for ${itemId}:`, tree.error);
        baseRequirementsByItem.set(itemId, []);
        return [];
      }

      // Fetch metadata for all items in this BOM
      const itemsInBom = new Set<string>();
      for (const node of tree.data) {
        if (node.itemId) {
          itemsInBom.add(node.itemId);
        }
      }
      await Promise.all(Array.from(itemsInBom).map(fetchItemMetadata));

      // Build tree structure
      const nodeMap = new Map<string, BomNode>();

      for (const treeNode of tree.data) {
        const node: BomNode = {
          methodMaterialId: treeNode.methodMaterialId,
          itemId: treeNode.itemId,
          quantity: Number(treeNode.quantity ?? 1),
          parentMaterialId: treeNode.parentMaterialId,
          isRoot: treeNode.isRoot ?? false,
          children: [],
          accumulatedQuantity: 0,
          accumulatedLeadTime: 0,
        };
        nodeMap.set(treeNode.methodMaterialId, node);
      }

      // Build tree relationships
      const roots: BomNode[] = [];
      for (const node of nodeMap.values()) {
        if (node.isRoot || !node.parentMaterialId) {
          roots.push(node);
        } else {
          const parent = nodeMap.get(node.parentMaterialId);
          if (parent) {
            parent.children.push(node);
          }
        }
      }

      // Traverse tree with base quantity of 1
      for (const root of roots) {
        traverseBomTree(root, 1, 0);
      }

      // Collect requirements
      const requirements: ItemRequirement[] = [];
      for (const node of nodeMap.values()) {
        if (node.isRoot) continue;

        const replenishmentSystem =
          replenishmentSystemByItem.get(node.itemId) ?? "Buy";

        const treeNode = tree.data.find(
          (t: { methodMaterialId: string }) =>
            t.methodMaterialId === node.methodMaterialId
        );

        requirements.push({
          itemId: node.itemId,
          baseQuantity: node.accumulatedQuantity,
          leadTimeOffset: node.accumulatedLeadTime,
          replenishmentSystem:
            replenishmentSystem === "Buy and Make"
              ? "Make"
              : (replenishmentSystem as "Buy" | "Make"),
          methodType: (treeNode?.methodType ?? "Buy") as
            | "Make"
            | "Pick"
            | "Buy",
        });
      }

      baseRequirementsByItem.set(itemId, requirements);
      return requirements;
    };

    // Recursively process requirements to expand Pick+Make items
    const processRequirement = async (
      locationId: string,
      periodId: string,
      itemId: string,
      quantity: number,
      accumulatedLeadTime: number
    ): Promise<void> => {
      // Fetch BOM requirements for this item (uses cache if available)
      const baseRequirements = await fetchBomRequirements(itemId);

      if (baseRequirements.length === 0) {
        return;
      }

      for (const req of baseRequirements) {
        const requiredQuantity = req.baseQuantity * quantity;
        const totalLeadTime = accumulatedLeadTime + req.leadTimeOffset;

        // Skip Make+Make items - they will be produced, not procured
        if (req.methodType === "Make" && req.replenishmentSystem === "Make") {
          continue;
        }

        // Add this item to requirements (unless it's Make+Make)
        const key = `${locationId}-${periodId}-${req.itemId}`;
        const existing = requirementsByProjectedItem.get(key);

        if (existing) {
          existing.estimatedQuantity += requiredQuantity;
        } else {
          requirementsByProjectedItem.set(key, {
            estimatedQuantity: requiredQuantity,
            leadTimeOffset: totalLeadTime,
            replenishmentSystem: req.replenishmentSystem,
            methodType: req.methodType,
          });
        }

        // If this is a Pick item with Make replenishment, recursively expand its BOM
        if (req.methodType === "Pick" && req.replenishmentSystem === "Make") {
          await processRequirement(
            locationId,
            periodId,
            req.itemId,
            requiredQuantity,
            totalLeadTime
          );
        }
      }
    };

    // First, group production orders by location/period/item to offset demand projections
    // This prevents double-counting of planned production
    for (const line of productionLines.data) {
      if (!line.itemId || !line.quantityToReceive) continue;

      const dueDate = line.dueDate
        ? parseDate(line.dueDate)
        : line.deadlineType === "No Deadline"
        ? today.add({ days: 30 })
        : today;

      // If required date is before today, use first period
      let period;
      if (dueDate.compare(today) < 0) {
        period = periods[0];
      } else {
        // Find matching period for required date
        period = periods.find((p) => {
          return (
            p.startDate?.compare(dueDate) <= 0 &&
            p.endDate?.compare(dueDate) >= 0
          );
        });
      }

      if (period) {
        const locationDemand = jobSupplyByLocationAndPeriod.get(
          line.locationId ?? ""
        );
        if (locationDemand) {
          const periodDemand = locationDemand.get(period.id ?? "");
          if (periodDemand) {
            const currentDemand = periodDemand.get(line.itemId) ?? 0;
            periodDemand.set(
              line.itemId,
              currentDemand + line.quantityToReceive
            );
          }
        }
      }
    }

    // Now apply demand projections by multiplying base requirements
    // Subtract planned production orders to avoid double-counting
    for (const projection of demandProjections.data) {
      if (!projection.itemId || !projection.forecastQuantity) {
        continue;
      }

      // Calculate net demand after subtracting planned production orders
      let netDemand = projection.forecastQuantity;
      const locationSupply = jobSupplyByLocationAndPeriod.get(
        projection.locationId ?? ""
      );
      if (locationSupply) {
        const periodSupply = locationSupply.get(projection.periodId);
        if (periodSupply) {
          const plannedProduction = periodSupply.get(projection.itemId) ?? 0;
          netDemand = Math.max(0, projection.forecastQuantity - plannedProduction);
        }
      }

      // Only process if there's net demand after offsetting
      if (netDemand > 0) {
        await processRequirement(
          projection.locationId!,
          projection.periodId,
          projection.itemId,
          netDemand,
          0
        );
      }
    }

    // Group sales order lines into demand periods AND process their BOM requirements
    for (const line of salesOrderLines.data) {
      if (!line.itemId || !line.quantityToSend) continue;

      const promiseDate = line.promisedDate
        ? parseDate(line.promisedDate)
        : today;
      const requiredDate = promiseDate;

      // If promised date is before today, use first period
      let period;
      if (requiredDate.compare(today) < 0) {
        period = periods[0];
      } else {
        // Find matching period for promised date
        period = periods.find((p) => {
          return (
            p.startDate?.compare(requiredDate) <= 0 &&
            p.endDate?.compare(requiredDate) >= 0
          );
        });
      }

      if (period) {
        const locationDemand = salesDemandByLocationAndPeriod.get(
          line.locationId ?? ""
        );
        if (locationDemand) {
          const periodDemand = locationDemand.get(period.id ?? "");
          if (periodDemand) {
            const currentDemand = periodDemand.get(line.itemId) ?? 0;
            periodDemand.set(line.itemId, currentDemand + line.quantityToSend);
          }
        }

        // Process BOM requirements for this sales order line
        await processRequirement(
          line.locationId ?? "",
          period.id ?? "",
          line.itemId,
          line.quantityToSend,
          0
        );
      }
    }

    // Group job material lines into demand periods AND process their BOM requirements
    for (const line of jobMaterialLines.data) {
      if (!line.itemId || !line.quantityToIssue) continue;

      const dueDate = line.dueDate ? parseDate(line.dueDate) : today;
      const requiredDate = dueDate.add({ days: -(line.leadTime ?? 7) });

      // If required date is before today, use first period
      let period;
      if (requiredDate.compare(today) < 0) {
        period = periods[0];
      } else {
        // Find matching period for required date
        period = periods.find((p) => {
          return (
            p.startDate?.compare(requiredDate) <= 0 &&
            p.endDate?.compare(requiredDate) >= 0
          );
        });
      }

      if (period) {
        const locationDemand = jobMaterialDemandByLocationAndPeriod.get(
          line.locationId ?? ""
        );
        if (locationDemand) {
          const periodDemand = locationDemand.get(period.id ?? "");
          if (periodDemand) {
            const currentDemand = periodDemand.get(line.itemId) ?? 0;
            periodDemand.set(line.itemId, currentDemand + line.quantityToIssue);
          }
        }

        // Process BOM requirements for this job material line
        await processRequirement(
          line.locationId ?? "",
          period.id ?? "",
          line.itemId,
          line.quantityToIssue,
          0
        );
      }
    }

    // Convert requirements to demandForecast records with period offsetting
    // Use a Map to aggregate by (itemId, locationId, periodId) to avoid duplicates
    const demandForecastMap = new Map<
      string,
      Database["public"]["Tables"]["demandForecast"]["Insert"]
    >();

    for (const [key, requirement] of requirementsByProjectedItem) {
      const [locationId, sourcePeriodId, itemId] = key.split("-");

      // Find the source period
      const sourcePeriod = periods.find((p) => p.id === sourcePeriodId);
      if (!sourcePeriod) {
        continue;
      }

      // Calculate how many days to offset backwards based on lead time
      const leadTimeDays = requirement.leadTimeOffset;
      const leadTimeWeeks = Math.ceil(leadTimeDays / 7); // Round up to nearest week

      // Find the target period by going backwards leadTimeWeeks from source period
      const sourcePeriodIndex = periods.findIndex(
        (p) => p.id === sourcePeriodId
      );
      const targetPeriodIndex = Math.max(0, sourcePeriodIndex - leadTimeWeeks);
      const targetPeriod = periods[targetPeriodIndex];

      if (!targetPeriod) {
        continue;
      }

      // Create unique key for aggregation
      const forecastKey = `${itemId}-${locationId}-${targetPeriod.id}`;
      const existing = demandForecastMap.get(forecastKey);

      if (existing) {
        // Aggregate quantities for same item/location/period
        existing.forecastQuantity =
          Number(existing.forecastQuantity) + requirement.estimatedQuantity;
      } else {
        demandForecastMap.set(forecastKey, {
          itemId,
          locationId,
          periodId: targetPeriod.id!,
          forecastQuantity: requirement.estimatedQuantity,
          forecastMethod: "mrp",
          companyId,
          createdBy: userId,
          updatedBy: userId,
        });
      }
    }

    const demandForecastUpserts = Array.from(demandForecastMap.values());

    // Group purchase order lines into supply periods
    for (const line of purchaseOrderLines.data) {
      if (!line.itemId || !line.quantityToReceive) continue;

      const dueDate = line.promisedDate
        ? parseDate(line.promisedDate)
        : line.orderDate
        ? parseDate(line.orderDate).add({ days: line.leadTime ?? 7 })
        : today.add({ days: line.leadTime ?? 7 });

      // If required date is before today, use first period
      let period;
      if (dueDate.compare(today) < 0) {
        period = periods[0];
      } else {
        // Find matching period for required date
        period = periods.find((p) => {
          return (
            p.startDate?.compare(dueDate) <= 0 &&
            p.endDate?.compare(dueDate) >= 0
          );
        });
      }

      if (period) {
        const locationDemand = purchaseOrderSupplyByLocationAndPeriod.get(
          line.locationId ?? ""
        );
        if (locationDemand) {
          const periodDemand = locationDemand.get(period.id ?? "");
          if (periodDemand) {
            const currentDemand = periodDemand.get(line.itemId) ?? 0;
            periodDemand.set(
              line.itemId,
              currentDemand + line.quantityToReceive
            );
          }
        }
      }
    }

    const demandActualUpserts: Database["public"]["Tables"]["demandActual"]["Insert"][] =
      [];
    // Create a Map to store unique demand actuals by composite key
    const demandActualsMap = new Map<
      string,
      Database["public"]["Tables"]["demandActual"]["Insert"]
    >();

    const supplyActualUpserts: Database["public"]["Tables"]["supplyActual"]["Insert"][] =
      [];
    const supplyActualsMap = new Map<
      string,
      Database["public"]["Tables"]["supplyActual"]["Insert"]
    >();

    const [
      { data: existingDemandActuals, error: demandActualsError },
      { data: existingSupplyActuals, error: supplyActualsError },
    ] = await Promise.all([
      client
        .from("demandActual")
        .select("*")
        .eq("companyId", companyId)
        .in(
          "periodId",
          periods.map((p) => p.id ?? "")
        ),
      client
        .from("supplyActual")
        .select("*")
        .eq("companyId", companyId)
        .in(
          "periodId",
          periods.map((p) => p.id ?? "")
        ),
    ]);

    if (demandActualsError) throw demandActualsError;
    if (supplyActualsError) throw supplyActualsError;

    // First add all existing records with quantity 0
    if (existingDemandActuals) {
      for (const existing of existingDemandActuals) {
        const key = `${existing.itemId}-${existing.locationId}-${existing.periodId}-${existing.sourceType}`;
        demandActualsMap.set(key, {
          itemId: existing.itemId,
          locationId: existing.locationId,
          periodId: existing.periodId,
          actualQuantity: 0,
          sourceType: existing.sourceType,
          companyId,
          createdBy: userId,
          updatedBy: userId,
        });
      }
    }

    // Then add/update current demand for sales order lines
    for (const [locationId, periodMap] of salesDemandByLocationAndPeriod) {
      for (const [periodId, itemMap] of periodMap) {
        for (const [itemId, quantity] of itemMap) {
          if (quantity > 0) {
            const key = `${itemId}-${locationId}-${periodId}-Sales Order`;
            demandActualsMap.set(key, {
              itemId,
              locationId,
              periodId: periodId,
              actualQuantity: quantity,
              sourceType: "Sales Order",
              companyId,
              createdBy: userId,
              updatedBy: userId,
            });
          }
        }
      }
    }

    // Then add/update current demand for job material lines
    for (const [
      locationId,
      periodMap,
    ] of jobMaterialDemandByLocationAndPeriod) {
      for (const [periodId, itemMap] of periodMap) {
        for (const [itemId, quantity] of itemMap) {
          if (quantity > 0) {
            const key = `${itemId}-${locationId}-${periodId}-Job Material`;
            demandActualsMap.set(key, {
              itemId,
              locationId,
              periodId: periodId,
              actualQuantity: quantity,
              sourceType: "Job Material",
              companyId,
              createdBy: userId,
              updatedBy: userId,
            });
          }
        }
      }
    }

    if (existingSupplyActuals) {
      for (const existing of existingSupplyActuals) {
        const key = `${existing.itemId}-${existing.locationId}-${existing.periodId}-${existing.sourceType}`;
        supplyActualsMap.set(key, {
          itemId: existing.itemId,
          locationId: existing.locationId,
          periodId: existing.periodId,
          actualQuantity: 0,
          sourceType: existing.sourceType,
          companyId,
          createdBy: userId,
          updatedBy: userId,
        });
      }
    }

    // Then add/update current demand for sales order lines
    for (const [locationId, periodMap] of jobSupplyByLocationAndPeriod) {
      for (const [periodId, itemMap] of periodMap) {
        for (const [itemId, quantity] of itemMap) {
          if (quantity > 0) {
            const key = `${itemId}-${locationId}-${periodId}-Production Order`;
            supplyActualsMap.set(key, {
              itemId,
              locationId,
              periodId: periodId,
              actualQuantity: quantity,
              sourceType: "Production Order",
              companyId,
              createdBy: userId,
              updatedBy: userId,
            });
          }
        }
      }
    }

    // Then add/update current demand for job material lines
    for (const [
      locationId,
      periodMap,
    ] of purchaseOrderSupplyByLocationAndPeriod) {
      for (const [periodId, itemMap] of periodMap) {
        for (const [itemId, quantity] of itemMap) {
          if (quantity > 0) {
            const key = `${itemId}-${locationId}-${periodId}-Purchase Order`;
            supplyActualsMap.set(key, {
              itemId,
              locationId,
              periodId: periodId,
              actualQuantity: quantity,
              sourceType: "Purchase Order",
              companyId,
              createdBy: userId,
              updatedBy: userId,
            });
          }
        }
      }
    }

    demandActualUpserts.push(...demandActualsMap.values());
    supplyActualUpserts.push(...supplyActualsMap.values());

    try {
      await db.transaction().execute(async (trx) => {
        // Delete existing demandForecast for this company
        await trx
          .deleteFrom("demandForecast")
          .where("companyId", "=", companyId)
          .where("forecastMethod", "=", "mrp")
          .execute();

        await trx
          .deleteFrom("supplyForecast")
          .where(
            "locationId",
            "in",
            locations.data.map((l) => l.id)
          )
          .where("companyId", "=", companyId)
          .execute();

        // Insert new demandForecast records
        if (demandForecastUpserts.length > 0) {
          await trx
            .insertInto("demandForecast")
            .values(demandForecastUpserts)
            .onConflict((oc) =>
              oc.columns(["itemId", "locationId", "periodId"]).doUpdateSet({
                forecastQuantity: (eb) => eb.ref("excluded.forecastQuantity"),
                forecastMethod: (eb) => eb.ref("excluded.forecastMethod"),
                updatedAt: new Date().toISOString(),
                updatedBy: userId,
              })
            )
            .execute();
        }

        if (demandActualUpserts.length > 0) {
          await trx
            .insertInto("demandActual")
            .values(demandActualUpserts)
            .onConflict((oc) =>
              oc
                .columns(["itemId", "locationId", "periodId", "sourceType"])
                .doUpdateSet({
                  actualQuantity: (eb) => eb.ref("excluded.actualQuantity"),
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId,
                })
            )
            .execute();
        }

        if (supplyActualUpserts.length > 0) {
          await trx
            .insertInto("supplyActual")
            .values(supplyActualUpserts)
            .onConflict((oc) =>
              oc
                .columns(["itemId", "locationId", "periodId", "sourceType"])
                .doUpdateSet({
                  actualQuantity: (eb) => eb.ref("excluded.actualQuantity"),
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId,
                })
            )
            .execute();
        }
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 201,
      });
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify(err), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

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
          endDate: periodEnd.toString(),
        });
        currentStart = periodEnd.add({ days: 1 });
      }

      return periods;
    }
    case "Month": {
      throw new Error("Not implemented");
    }
    case "Day": {
      throw new Error("Not implemented");
    }
    default: {
      throw new Error("Invalid groupBy");
    }
  }
}

async function getOrCreateDemandPeriods(
  db: Kysely<DB>,
  periods: { startDate: string; endDate: string }[],
  periodType: "Week" | "Day" | "Month"
) {
  // Get all existing periods for these dates
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

  // If we found all periods, return them
  if (existingPeriods.length === periods.length) {
    return existingPeriods.map((p) => {
      return {
        id: p.id,
        // @ts-ignore - we are getting Date objects here
        startDate: parseDate(p.startDate.toISOString().split("T")[0]),
        // @ts-ignore - we are getting Date objects here
        endDate: parseDate(p.endDate.toISOString().split("T")[0]),
        periodType: p.periodType,
        createdAt: p.createdAt,
      };
    });
  }

  // Create map of existing periods by start date
  const existingPeriodMap = new Map(
    // @ts-ignore - we are getting Date objects here
    existingPeriods.map((p) => [p.startDate.toISOString().split("T")[0], p])
  );

  // Find which periods need to be created
  const periodsToCreate = periods.filter(
    (period) => !existingPeriodMap.has(period.startDate)
  );

  // Create missing periods in a transaction
  const created = await db.transaction().execute(async (trx) => {
    return await trx
      .insertInto("period")
      .values(
        periodsToCreate.map((period) => ({
          startDate: period.startDate,
          endDate: period.endDate,
          periodType,
          createdAt: new Date().toISOString(),
        }))
      )
      .returningAll()
      .execute();
  });

  // Return all periods (existing + newly created)
  return [...existingPeriods, ...created].map((p) => ({
    id: p.id,
    // @ts-ignore - we are getting Date objects here
    startDate: parseDate(p.startDate.toISOString().split("T")[0]),
    // @ts-ignore - we are getting Date objects here
    endDate: parseDate(p.endDate.toISOString().split("T")[0]),
    periodType: p.periodType,
    createdAt: p.createdAt,
  }));
}

type BomNode = {
  methodMaterialId: string;
  itemId: string;
  quantity: number;
  parentMaterialId: string | null;
  isRoot: boolean;
  children: BomNode[];
  accumulatedQuantity: number;
  accumulatedLeadTime: number;
};

// Type for item requirements
type ItemRequirement = {
  itemId: string;
  baseQuantity: number; // Quantity required per unit of parent
  leadTimeOffset: number;
  replenishmentSystem: "Buy" | "Make";
  methodType: "Make" | "Pick" | "Buy";
};
