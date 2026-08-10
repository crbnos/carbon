import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { KyselyMasterDataProvider } from "../lib/scheduling/master-data-provider.ts";
import { SchedulingEngine } from "../lib/scheduling/scheduling-engine.ts";
import type {
  SchedulingDirection,
  SchedulingMode,
} from "../lib/scheduling/types.ts";
import { requirePermissions } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z
  .object({
    jobId: z.string().optional(),
    // Batch mode: schedule several jobs in ONE invocation (in array order) —
    // saves the per-call HTTP overhead when a replan wave rebuilds a company
    jobIds: z.array(z.string()).max(50).optional(),
    companyId: z.string(),
    userId: z.string(),
    mode: z.enum(["initial", "reschedule"]).default("initial"),
    direction: z.enum(["backward", "forward"]).default("backward"),
  })
  .refine((p) => p.jobId || (p.jobIds && p.jobIds.length > 0), {
    message: "jobId or jobIds is required",
  });

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const payload = await req.json();
    const validatedPayload = payloadValidator.parse(payload);
    const { jobId, jobIds, companyId, userId, mode, direction } =
      validatedPayload;

    const batch = jobIds ?? [jobId as string];
    console.info(
      `🔰 Starting ${mode} scheduling for ${batch.length} job(s)`
    );
    console.info(`📋 Direction: ${direction}`);

    const client = await requirePermissions(req, companyId, userId, { update: "production" });

    const provider = new KyselyMasterDataProvider(db, client, companyId, {
      // Batch mode: share the company's static master data (processes, work
      // centers, qualifications, shifts) across all jobs in this invocation
      cacheCompanyData: batch.length > 1,
    });

    // Jobs run sequentially IN ORDER so earlier (higher-priority) jobs claim
    // capacity first; each engine run sees the previous runs' reservations
    let result;
    const batchResults: { jobId: string; conflictsDetected: number }[] = [];
    for (const id of batch) {
      const engine = new SchedulingEngine({
        client,
        db,
        provider,
        jobId: id,
        companyId,
        userId,
        mode: mode as SchedulingMode,
        direction: direction as SchedulingDirection,
      });
      result = await engine.run();
      batchResults.push({
        jobId: id,
        conflictsDetected: result.conflictsDetected,
      });
    }

    console.info(`✅ Scheduling complete:`);
    console.info(`   Jobs scheduled: ${batchResults.length}`);
    console.info(
      `   Conflicts detected: ${batchResults.reduce((s, r) => s + r.conflictsDetected, 0)}`
    );

    return jsonResponse({
      ...result,
      batch: batchResults,
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
