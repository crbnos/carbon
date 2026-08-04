import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { SchedulingEngine } from "../lib/scheduling/scheduling-engine.ts";
import type {
  SchedulingDirection,
  SchedulingMode,
} from "../lib/scheduling/types.ts";
import { requirePermissions } from "../lib/supabase.ts";

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
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const payload = await req.json();
    const validatedPayload = payloadValidator.parse(payload);
    const { jobId, companyId, userId, mode, direction } = validatedPayload;

    console.info(`🔰 Starting ${mode} scheduling for job ${jobId}`);
    console.info(`📋 Direction: ${direction}`);

    const client = await requirePermissions(req, companyId, userId, { update: "production" });

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

    return jsonResponse({
      ...result,
    });
  } catch (error) {
    console.error(
      `❌ Scheduling failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return errorResponse(error, 500);
  }
});
