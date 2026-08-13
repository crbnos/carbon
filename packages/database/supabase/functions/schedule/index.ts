import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { KyselyMasterDataProvider } from "../lib/scheduling/master-data-provider.ts";
import { DEADLINE_PRIORITY } from "../lib/scheduling/priority-calculator.ts";
import { SchedulingEngine } from "../lib/scheduling/scheduling-engine.ts";
import { requirePermissions } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

// Forecast-first finite scheduling regenerates a WHOLE LOCATION in one pass.
const payloadValidator = z.object({
  locationId: z.string(),
  companyId: z.string(),
  userId: z.string(),
  // When set, run ONLY this job first in the queue as a read-only "best case"
  // what-if — return its projection and persist nothing.
  expediteJobId: z.string().optional(),
});

const deadlineRank = (deadlineType: string | null | undefined): number =>
  DEADLINE_PRIORITY[deadlineType ?? "No Deadline"] ?? 3;

const asMs = (value: unknown): number | null =>
  value == null ? null : new Date(value as string).getTime();

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

    // The location's open jobs, ordered deadline class FIRST (so a no-due-date
    // ASAP order leads the queue instead of trailing on NULLS LAST), then due
    // date ASC NULLS LAST, priority ASC, createdAt ASC. Sorted in TS.
    const jobRows = await db
      .selectFrom("job")
      .select(["id", "dueDate", "deadlineType", "priority", "createdAt"])
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .where("status", "in", ["Ready", "In Progress", "Paused"])
      .execute();

    jobRows.sort((a, b) => {
      const dr = deadlineRank(a.deadlineType) - deadlineRank(b.deadlineType);
      if (dr !== 0) return dr;
      const ad = asMs(a.dueDate);
      const bd = asMs(b.dueDate);
      if (ad !== null && bd !== null) {
        if (ad !== bd) return ad - bd;
      } else if (ad !== null) {
        return -1; // a due date sorts before a NULL (NULLS LAST)
      } else if (bd !== null) {
        return 1;
      }
      const ap = a.priority ?? 0;
      const bp = b.priority ?? 0;
      if (ap !== bp) return ap - bp;
      return (asMs(a.createdAt) ?? 0) - (asMs(b.createdAt) ?? 0);
    });

    let batch = jobRows.map((j) => j.id);

    // Expedite: move the target to the head of the queue.
    if (expediteJobId && batch.includes(expediteJobId)) {
      batch = [expediteJobId, ...batch.filter((id) => id !== expediteJobId)];
    }

    // ONE clock for the whole run → determinism across every job in the batch.
    const now = new Date();
    const provider = new KyselyMasterDataProvider(db, client, companyId, {
      // Share the company's STATIC master data (processes, work centers,
      // qualifications, shifts, machine calendars) across all jobs in the batch.
      cacheCompanyData: batch.length > 1,
    });

    // Expedite what-if: run the target first with the WHOLE batch excluded from
    // the reservation snapshot (it claims capacity as if first), simulate-only,
    // and return its projection. Do NOT run the rest, do NOT write anything.
    if (expediteJobId) {
      if (!batch.includes(expediteJobId)) {
        return jsonResponse({ expedite: null });
      }
      const engine = new SchedulingEngine({
        client,
        db,
        provider,
        jobId: expediteJobId,
        companyId,
        userId,
        now,
        persist: false,
        excludeJobIds: batch,
      });
      await engine.run();
      return jsonResponse({
        expedite: {
          jobId: expediteJobId,
          projectedCompletionAt: engine.getProjectedCompletionAt(),
          cause: engine.getCause(),
        },
      });
    }

    // Normal flow: regenerate every job sequentially. Each run excludes the
    // jobs NOT YET run (self + later) from the snapshot, so it sees non-batch
    // reservations plus the just-persisted placements of already-run batch jobs
    // — sequential capacity claiming, no pre-clear step.
    let conflictsDetected = 0;
    const newlyLate: {
      jobId: string;
      readableJobId: string | null;
      assignee: string | null;
      projectedCompletionAt: string | null;
    }[] = [];

    for (let i = 0; i < batch.length; i++) {
      const id = batch[i];
      const engine = new SchedulingEngine({
        client,
        db,
        provider,
        jobId: id,
        companyId,
        userId,
        now,
        persist: true,
        excludeJobIds: batch.slice(i),
      });
      const result = await engine.run();
      conflictsDetected += result.conflictsDetected;
      if (engine.isNewlyLate()) {
        newlyLate.push({
          jobId: id,
          readableJobId: engine.getReadableJobId(),
          assignee: engine.getAssignee(),
          projectedCompletionAt: engine.getProjectedCompletionAt(),
        });
      }
    }

    console.info(
      `✅ Regenerated location ${locationId}: ${batch.length} job(s), ` +
        `${conflictsDetected} conflict(s), ${newlyLate.length} newly late`
    );

    return jsonResponse({
      locationId,
      jobsScheduled: batch.length,
      conflictsDetected,
      newlyLate,
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
