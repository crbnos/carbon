import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { SchedulingEngine } from "../lib/scheduling/scheduling-engine.ts";
import type {
  SchedulingDirection,
  SchedulingMode,
} from "../lib/scheduling/types.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  jobId: z.string(),
  companyId: z.string(),
  userId: z.string(),
  mode: z.enum(["initial", "reschedule"]).default("initial"),
  direction: z.enum(["backward", "forward"]).default("backward"),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const validatedPayload = payloadValidator.parse(payload);
    const { jobId, companyId, userId, mode, direction } = validatedPayload;

    console.info(`🔰 Starting ${mode} scheduling for job ${jobId}`);
    console.info(`📋 Direction: ${direction}`);

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const engine = new SchedulingEngine({
      client,
      db,
      jobId,
      companyId,
      userId,
      mode: mode as SchedulingMode,
      direction: direction as SchedulingDirection,
    });

    const result = await engine.run();

    console.info(`✅ Scheduling complete:`);
    console.info(`   Operations scheduled: ${result.operationsScheduled}`);
    console.info(`   Conflicts detected: ${result.conflictsDetected}`);
    console.info(
      `   Work centers affected: ${result.workCentersAffected.length}`
    );
    console.info(`   Assembly depth: ${result.assemblyDepth}`);

    return new Response(
      JSON.stringify({
        ...result,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      `❌ Scheduling failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
