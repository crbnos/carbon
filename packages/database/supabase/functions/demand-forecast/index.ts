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
  Database["public"]["Tables"]["demandPeriod"]["Row"],
  "createdAt"
>;

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("company"),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("salesOrder"),
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
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  const { type, companyId, userId } = payloadValidator.parse(payload);
  const today = getToday(getLocalTimeZone());
  const periods = getStartAndEndDates(today, "Week");
  const demandPeriods = await getOrCreateDemandPeriods(db, periods, "Week");

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

    // Initialize periods for each location
    const salesLocationPeriods = salesDemandByLocationAndPeriod.get(
      location.id
    );
    if (salesLocationPeriods) {
      for (const period of demandPeriods) {
        salesLocationPeriods.set(period.id ?? "", new Map<string, number>());
      }
    }

    const jobMaterialLocationPeriods = jobMaterialDemandByLocationAndPeriod.get(
      location.id
    );
    if (jobMaterialLocationPeriods) {
      for (const period of demandPeriods) {
        jobMaterialLocationPeriods.set(
          period.id ?? "",
          new Map<string, number>()
        );
      }
    }
  }

  try {
    switch (type) {
      case "company": {
        // Get existing demand actuals
        const { data: existingDemandActuals, error: demandActualsError } =
          await client
            .from("demandActual")
            .select("*")

            .in(
              "demandPeriodId",
              demandPeriods.map((p) => p.id ?? "")
            );

        if (demandActualsError) throw demandActualsError;

        const existingSalesOrderDemandActuals = existingDemandActuals.filter(
          (da) => da.sourceType === "Sales Order"
        );

        const existingJobMaterialDemandActuals = existingDemandActuals.filter(
          (da) => da.sourceType === "Job Material"
        );

        const [salesOrderLines, jobMaterialLines] = await Promise.all([
          client
            .from("openSalesOrderLines")
            .select("*")
            .eq("companyId", companyId),
          client
            .from("openJobMaterialLines")
            .select("*")
            .eq("companyId", companyId),
        ]);

        if (salesOrderLines.error) {
          throw new Error("No sales order lines found");
        }

        if (jobMaterialLines.error) {
          throw new Error("No job material lines found");
        }

        // Group sales order lines into demand periods
        for (const line of salesOrderLines.data) {
          if (!line.itemId || !line.quantityToSend) continue;

          const promiseDate = line.promisedDate
            ? parseDate(line.promisedDate)
            : today;

          // If promised date is before today, use first period
          let period;
          if (promiseDate.compare(today) < 0) {
            period = demandPeriods[0];
          } else {
            // Find matching period for promised date
            period = demandPeriods.find((p) => {
              return (
                p.startDate?.compare(promiseDate) <= 0 &&
                p.endDate?.compare(promiseDate) >= 0
              );
            });
          }

          if (period) {
            const locationDemand = salesDemandByLocationAndPeriod.get(
              line.locationId
            );
            if (locationDemand) {
              const periodDemand = locationDemand.get(period.id ?? "");
              if (periodDemand) {
                const currentDemand = periodDemand.get(line.itemId) ?? 0;
                periodDemand.set(
                  line.itemId,
                  currentDemand + line.quantityToSend
                );
              }
            }
          }
        }

        const salesDemandActualUpserts: Database["public"]["Tables"]["demandActual"]["Insert"][] =
          [];

        // Create a Map to store unique demand actuals by composite key
        const demandActualsMap = new Map<
          string,
          Database["public"]["Tables"]["demandActual"]["Insert"]
        >();

        // First add all existing records with quantity 0
        if (existingSalesOrderDemandActuals) {
          for (const existing of existingSalesOrderDemandActuals) {
            const key = `${existing.itemId}-${existing.locationId}-${existing.demandPeriodId}-${existing.sourceType}`;
            demandActualsMap.set(key, {
              itemId: existing.itemId,
              locationId: existing.locationId,
              demandPeriodId: existing.demandPeriodId,
              actualQuantity: 0,
              sourceType: existing.sourceType,
              createdBy: userId,
              updatedBy: userId,
            });
          }
        }

        // Then add/update current demand
        for (const [locationId, periodMap] of salesDemandByLocationAndPeriod) {
          for (const [periodId, itemMap] of periodMap) {
            for (const [itemId, quantity] of itemMap) {
              if (quantity > 0) {
                const key = `${itemId}-${locationId}-${periodId}-Sales Order`;
                demandActualsMap.set(key, {
                  itemId,
                  locationId,
                  demandPeriodId: periodId,
                  actualQuantity: quantity,
                  sourceType: "Sales Order",
                  createdBy: userId,
                  updatedBy: userId,
                });
              }
            }
          }
        }

        // Convert Map values to array for upsert
        salesDemandActualUpserts.push(...demandActualsMap.values());

        try {
          await db.transaction().execute(async (trx) => {
            if (salesDemandActualUpserts.length > 0) {
              await trx
                .insertInto("demandActual")
                .values(salesDemandActualUpserts)
                .onConflict((oc) =>
                  oc
                    .columns([
                      "itemId",
                      "locationId",
                      "demandPeriodId",
                      "sourceType",
                    ])
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
      }
      case "salesOrder": {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 201,
        });
      }
      case "job": {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 201,
        });
      }
      default: {
        throw new Error("Invalid type");
      }
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
    .selectFrom("demandPeriod")
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
      .insertInto("demandPeriod")
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
