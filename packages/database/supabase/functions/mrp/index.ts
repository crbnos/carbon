import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  getLocalTimeZone,
  today as getToday,
  parseDate,
  startOfWeek,
  type CalendarDate,
} from "npm:@internationalized/date";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { Kysely } from "https://esm.sh/v135/kysely@0.26.3/dist/cjs/kysely.d.ts";
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

// TODO: we can do a reduced version based on the type of the payload, but for now, we're just running full MRP

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

    // Group sales order lines into demand periods
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
      }
    }

    // Group job material lines into demand periods
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
      }
    }

    // Group job lines into supply periods
    for (const line of productionLines.data) {
      if (!line.itemId || !line.quantityToReceive) continue;

      const dueDate = line.dueDate ? parseDate(line.dueDate) : today;

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

    // Group job lines into supply periods
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

    // Get existing demand actuals
    const [
      { data: existingDemandActuals, error: demandActualsError },
      { data: existingSupplyActuals, error: supplyActualsError },
    ] = await Promise.all([
      client
        .from("demandActual")
        .select("*")

        .in(
          "periodId",
          periods.map((p) => p.id ?? "")
        ),
      client
        .from("supplyActual")
        .select("*")
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

    // Then add/update current supply for job lines

    // Convert Map values to array for upsert
    demandActualUpserts.push(...demandActualsMap.values());
    supplyActualUpserts.push(...supplyActualsMap.values());

    try {
      await db.transaction().execute(async (trx) => {
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
