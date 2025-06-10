import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  getLocalTimeZone,
  today as getToday,
  startOfWeek,
  type CalendarDate,
} from "npm:@internationalized/date";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { Kysely } from "https://esm.sh/v135/kysely@0.26.3/dist/cjs/kysely.d.ts";
import z from "npm:zod@^3.24.1";
import { corsHeaders } from "../lib/headers.ts";
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
  const today = getToday(getLocalTimeZone()).add({ months: -2 });
  const periods = getStartAndEndDates(today, "Week");
  const demandPeriods = await getOrCreateDemandPeriods(db, periods, "Week");

  console.log({ demandPeriods: demandPeriods.length });

  try {
    switch (type) {
      case "company": {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 201,
        });
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

  console.log({
    existingPeriods: existingPeriods.length,
    periods: periods.length,
  });

  // If we found all periods, return them
  if (existingPeriods.length === periods.length) {
    return existingPeriods;
  }

  // Create map of existing periods by start date
  const existingPeriodMap = new Map(
    // @ts-ignore - we are getting Date objects here
    existingPeriods.map((p) => [p.startDate?.toISOString().split("T")[0], p])
  );

  // Find which periods need to be created
  const periodsToCreate = periods.filter(
    (period) => !existingPeriodMap.has(period.startDate)
  );

  // Create missing periods in a transaction
  const created = await db.transaction().execute(async (trx) => {
    return trx
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
  return [...existingPeriods, ...created];
}
