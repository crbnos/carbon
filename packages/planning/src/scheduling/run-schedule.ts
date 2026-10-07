// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import type { BatchPlacement } from "./batch-scheduler.ts";
import { placeReleasedBatches } from "./batch-scheduler.ts";
import { toInstantMs } from "./date-utils.ts";
import { KyselyMasterDataProvider } from "./master-data-provider.ts";
import { persistLocationWrites } from "./persist-location.ts";
import { DEADLINE_PRIORITY } from "./priority-calculator.ts";
import type { JobWrites } from "./run-overlay.ts";
import {
  SCHEDULING_HORIZON_DAYS,
  SchedulingEngine
} from "./scheduling-engine.ts";

/**
 * Whole-location forecast-first finite scheduling, run in-process in Node: the
 * ERP app and `@carbon/jobs` call this directly via `@carbon/planning`.
 *
 * The caller supplies a Kysely `db` and a service-role `client`.
 */

export type NewlyLateJob = {
  jobId: string;
  readableJobId: string | null;
  assignee: string | null;
  projectedCompletionAt: string | null;
};

export type LocationScheduleResult = {
  locationId: string;
  jobsScheduled: number;
  jobsFailed: number;
  conflictsDetected: number;
  newlyLate: NewlyLateJob[];
};

export type ExpediteWhatIfResult = {
  jobId: string;
  projectedCompletionAt: string | null;
  cause: string | null;
} | null;

type BaseParams = {
  db: Kysely<DB>;
  client: SupabaseClient<Database>;
  locationId: string;
  companyId: string;
  userId: string;
};

const log = getLogger("planning", "schedule");

const deadlineRank = (deadlineType: string | null | undefined): number =>
  DEADLINE_PRIORITY[deadlineType ?? "No Deadline"] ?? 3;

const asMs = (value: unknown): number | null =>
  value == null ? null : toInstantMs(value as Date | string);

/**
 * The location's open jobs — widened with members of Active/Completing
 * operation batches — ordered deadline class FIRST (so a no-due-date ASAP
 * order leads the queue instead of trailing on NULLS LAST), then due date ASC
 * NULLS LAST, priority ASC, createdAt ASC. Sorted in TS.
 */
export async function loadOrderedBatch(
  db: Kysely<DB>,
  locationId: string,
  companyId: string
): Promise<string[]> {
  const jobRows = await db
    .selectFrom("job")
    .select(["id", "dueDate", "deadlineType", "priority", "createdAt"])
    .where("locationId", "=", locationId)
    .where("companyId", "=", companyId)
    .where("status", "in", ["Ready", "In Progress", "Paused"])
    .execute();

  // Widen with jobs holding operations in an Active/Completing batch: a batch
  // reservation spans member jobs, so every member must regen in the same
  // wave regardless of its own status. Deduped below and merged BEFORE the
  // sort so widened jobs take their natural place in the deadline order.
  const batchMemberRows = await db
    .selectFrom("job")
    .select(["id", "dueDate", "deadlineType", "priority", "createdAt"])
    .where("locationId", "=", locationId)
    .where("companyId", "=", companyId)
    .where("id", "in", (eb) =>
      eb
        .selectFrom("jobOperation as jo")
        .innerJoin("jobOperationBatch as b", (join) =>
          join
            .onRef("b.id", "=", "jo.jobOperationBatchId")
            .onRef("b.companyId", "=", "jo.companyId")
        )
        .select("jo.jobId")
        .where("jo.companyId", "=", companyId)
        .where("b.status", "in", ["Active", "Completing"])
    )
    .execute();

  const seenJobIds = new Set(jobRows.map((j) => j.id));
  for (const row of batchMemberRows) {
    if (!seenJobIds.has(row.id)) {
      seenJobIds.add(row.id);
      jobRows.push(row);
    }
  }

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

  return jobRows.map((j) => j.id);
}

/**
 * Regenerate every open job in a location sequentially. Each run excludes the
 * jobs NOT YET run (self + later) from the reservation snapshot, so it sees
 * non-batch reservations plus the placements of already-run batch jobs —
 * sequential capacity claiming, no pre-clear step. The jobs are computed in
 * memory (the provider carries each job's result to the next) and the whole
 * location is written in one transaction at the end.
 */
export async function runLocationSchedule(
  params: BaseParams
): Promise<LocationScheduleResult> {
  const { db, client, locationId, companyId, userId } = params;

  const batch = await loadOrderedBatch(db, locationId, companyId);

  // ONE clock for the whole run → determinism across every job in the batch.
  const now = Date.now();
  const provider = new KyselyMasterDataProvider(db, client, companyId, {
    // Share the company's STATIC master data (processes, work centers,
    // qualifications, shifts, machine calendars) across all jobs in the batch.
    cacheCompanyData: batch.length > 1
  });

  // Batch pre-pass: place every RELEASED operation batch as ONE unit (a
  // single coalesced, batch-tagged reservation; members pinned to its window)
  // BEFORE the per-job passes, so member jobs see the batch as fixed
  // capacity. A pre-pass failure degrades to per-member placement (the
  // pre-feature behavior) rather than abandoning the location run.
  let batchPlacements: Map<string, BatchPlacement> | null = null;
  try {
    batchPlacements = await placeReleasedBatches({
      db,
      provider,
      companyId,
      locationId,
      now,
      userId,
      orderedJobIds: batch,
      horizonEnd: now + (SCHEDULING_HORIZON_DAYS + 7) * 24 * 3_600_000,
      persist: true
    });
  } catch (err) {
    log.error("Batch pre-pass failed; members place individually", {
      locationId,
      companyId,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  // After the pre-pass, which writes member operations and batch reservations.
  await provider.preloadJobs(batch);
  await provider.beginRun(batch, now);

  const writes: JobWrites[] = [];
  let conflictsDetected = 0;
  const failedJobIds: string[] = [];
  const newlyLate: NewlyLateJob[] = [];

  for (let i = 0; i < batch.length; i++) {
    const id = batch[i]!;
    const engine = new SchedulingEngine({
      client,
      db,
      provider,
      jobId: id,
      companyId,
      userId,
      now,
      excludeJobIds: batch.slice(i),
      batchPlacements
    });
    // One job's failure must not abandon the rest of the batch — it is left
    // out of the write, so it stays stamped stale for a later wave and the
    // jobs behind it still see its stored reservations.
    try {
      const result = await engine.run();
      const jobWrites = engine.getWrites();
      provider.recordJob(jobWrites);
      writes.push(jobWrites);
      conflictsDetected += result.conflictsDetected;
      if (engine.isNewlyLate()) {
        newlyLate.push({
          jobId: id,
          readableJobId: engine.getReadableJobId(),
          assignee: engine.getAssignee(),
          projectedCompletionAt: engine.getProjectedCompletionAt()
        });
      }
    } catch (err) {
      log.error("Job failed to schedule", {
        jobId: id,
        locationId,
        companyId,
        error: err instanceof Error ? err.message : String(err)
      });
      failedJobIds.push(id);
    }
  }

  await persistLocationWrites(db, writes, { companyId, userId });

  return {
    locationId,
    jobsScheduled: batch.length - failedJobIds.length,
    jobsFailed: failedJobIds.length,
    conflictsDetected,
    newlyLate
  };
}

/**
 * Expedite what-if: run the target job FIRST with the whole batch excluded from
 * the reservation snapshot (it claims capacity as if first), simulate-only, and
 * return its projection. Persists nothing, runs no other job.
 */
export async function runExpediteWhatIf(
  params: BaseParams & { expediteJobId: string }
): Promise<ExpediteWhatIfResult> {
  const { db, client, locationId, companyId, userId, expediteJobId } = params;

  const batch = await loadOrderedBatch(db, locationId, companyId);
  if (!batch.includes(expediteJobId)) return null;

  const now = Date.now();
  const provider = new KyselyMasterDataProvider(db, client, companyId, {
    cacheCompanyData: batch.length > 1
  });

  // Simulate-only: mirror the EXISTING batch reservations (persist: false
  // reads them back instead of recomputing) so the what-if agrees with the
  // rows already in its snapshot.
  let batchPlacements: Map<string, BatchPlacement> | null = null;
  try {
    batchPlacements = await placeReleasedBatches({
      db,
      provider,
      companyId,
      locationId,
      now,
      userId,
      orderedJobIds: batch,
      horizonEnd: now + (SCHEDULING_HORIZON_DAYS + 7) * 24 * 3_600_000,
      persist: false
    });
  } catch {
    // fall through — the sim runs with per-member placement
  }

  const engine = new SchedulingEngine({
    client,
    db,
    provider,
    jobId: expediteJobId,
    companyId,
    userId,
    now,
    excludeJobIds: batch,
    batchPlacements
  });
  await engine.run();

  return {
    jobId: expediteJobId,
    projectedCompletionAt: engine.getProjectedCompletionAt(),
    cause: engine.getCause()
  };
}
