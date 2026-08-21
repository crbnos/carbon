import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import {
  runExpediteWhatIf,
  runLocationSchedule,
} from "../lib/scheduling/run-schedule.ts";
import { requirePermissions } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

// Forecast-first finite scheduling regenerates a WHOLE LOCATION in one pass.
// The orchestration lives in ../lib/scheduling/run-schedule.ts so it can run in
// BOTH this edge function AND in-process in Node (the ERP app and @carbon/jobs
// now call runLocationSchedule directly to avoid the edge cold-start + HTTP hop).
// This wrapper stays deployed for compatibility / any external caller.
const payloadValidator = z.object({
  locationId: z.string(),
  companyId: z.string(),
  userId: z.string(),
  // When set, run ONLY this job first in the queue as a read-only "best case"
  // what-if — return its projection and persist nothing.
  expediteJobId: z.string().optional(),
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const payload = await req.json();
    const { locationId, companyId, userId, expediteJobId } =
      payloadValidator.parse(payload);

    const client = await requirePermissions(req, companyId, userId, {
      update: "production",
    });

    if (expediteJobId) {
      const expedite = await runExpediteWhatIf({
        db,
        client,
        locationId,
        companyId,
        userId,
        expediteJobId,
      });
      return jsonResponse({ expedite });
    }

    const result = await runLocationSchedule({
      db,
      client,
      locationId,
      companyId,
      userId,
    });

    console.info(
      `✅ Regenerated location ${locationId}: ${result.jobsScheduled} job(s), ` +
        `${result.conflictsDetected} conflict(s), ${result.newlyLate.length} newly late`
    );

    return jsonResponse(result);
  } catch (error) {
    console.error(
      `❌ Scheduling failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return errorResponse(error, 500);
  }
});
