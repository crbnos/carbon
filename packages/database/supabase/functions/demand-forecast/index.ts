import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { Kysely } from "https://esm.sh/kysely@0.26.3";
import {
  getLocalTimeZone,
  today as getToday,
  startOfWeek,
  type CalendarDate,
} from "npm:@internationalized/date";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

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
  const today = getToday(getLocalTimeZone());
  const startDate = startOfWeek(today, "en-US");
  const endDate = startDate.add({ weeks: WEEKS_TO_FORECAST });
  const periods = await getOrCreateDemandPeriods(db, startDate, endDate);

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

const demandPeriodValidator = z.object({
  id: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  periodType: z.enum(["Week", "Day", "Month"]),
  createdAt: z.string(),
});

async function getDemandPeriods(
  db: Kysely<DB>,
  startDate: CalendarDate,
  endDate: CalendarDate
): { startDate: string; endDate: string }[] {}
