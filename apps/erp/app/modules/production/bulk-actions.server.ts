// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { runLocationSchedule } from "@carbon/planning";
import { chunkArray, getErrorMessage } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type BulkDeleteResult,
  bulkDeleteByStatus
} from "~/utils/bulk-delete.server";
import {
  resolveUserClient,
  splitIdsByStatus,
  type UserClientSource
} from "~/utils/table-jobs";
import {
  isBatchDissolvable,
  isBatchReleasable,
  isJobBulkReleasable,
  JOB_BULK_DELETABLE_STATUSES
} from "./production.models";
import { releaseBatchMemberJobs, releaseJobs } from "./production.server";
import {
  getJobReleaseReadiness,
  notifyScheduleInputsChanged,
  releaseJobOperationBatch,
  updateJobOperationBatch
} from "./production.service";
import {
  bulkReleaseStartingPurchaseOrders,
  jobReleaseProblems
} from "./ui/Jobs/job-release-logic";

/**
 * The bulk actions of the jobs and batches tables. Each one is called by its
 * action route with the selected ids, and by the background bulk-action job
 * (`~/utils/table-jobs.server`) with 100 ids at a time. The per-row checks live
 * here, so both paths apply them: a row the action may not act on is skipped.
 *
 * In their own file, not `production.server.ts`: the jobs release route test
 * replaces `releaseJobs` there, and a module cannot replace its own calls.
 */

const logger = getLogger("erp", "production-bulk-actions");

/** An `.in()` filter rides in the request URL, so ids are read 100 at a time. */
const IN_CHUNK = 100;

type Args = {
  /** The user's client. The background job passes a factory that signs a new
   *  token before the last expires; it is asked again before each row. */
  client: UserClientSource;
  companyId: string;
  userId: string;
};

type Problem = { readableId: string; message: string };

export type BulkReleaseJobsResult =
  | {
      success: true;
      released: number;
      /** Released, with something left to fix on the job (its POs). */
      warnings: Problem[];
      failed: Problem[];
      /** Selected jobs that are not Draft or Planned (a stale selection). */
      skipped: number;
      scheduled: boolean;
      /** The PO each supplier's outside operations went on. The background
       *  release passes it to its next slice of jobs. */
      purchaseOrdersBySupplierId: Record<string, string>;
    }
  | { success: false; message: string };

/**
 * Releases each Draft / Planned job through the job page's release path
 * (`releaseJobs`) on its own: a job that is not ready is reported in `failed`
 * while the rest still release. There is no dialog, so a job with something
 * to fix or a purchase order to choose is skipped and named. A job in any
 * other status is skipped silently. Then each location is scheduled once.
 */
export async function bulkReleaseJobs({
  client,
  db,
  jobIds,
  companyId,
  userId,
  purchaseOrdersBySupplierId
}: Args & {
  db: Kysely<KyselyDatabase>;
  jobIds: string[];
  /** The map an earlier slice of the same bulk release returned. */
  purchaseOrdersBySupplierId?: Record<string, string>;
}): Promise<BulkReleaseJobsResult> {
  const ids = [...new Set(jobIds.filter(Boolean))];
  const readClient = await resolveUserClient(client);
  const jobs = [];
  for (const batch of chunkArray(ids, IN_CHUNK)) {
    const page = await readClient
      .from("job")
      .select("id, jobId, status, quantity, scrapQuantity, locationId")
      .in("id", batch)
      .eq("companyId", companyId);
    if (page.error) {
      logger.error("Failed to load the selected jobs", {
        companyId,
        error: page.error
      });
      return { success: false, message: "Failed to load the selected jobs" };
    }
    jobs.push(...page.data);
  }

  const releasable = jobs
    .filter((job) => isJobBulkReleasable(job.status))
    .sort((a, b) => a.jobId.localeCompare(b.jobId));
  const skipped = ids.length - releasable.length;
  const readiness = await getJobReleaseReadiness(
    readClient,
    releasable.map((job) => job.id),
    companyId
  );
  if (readiness.error || !readiness.data) {
    logger.error("Failed to validate the selected jobs", {
      companyId,
      error: readiness.error
    });
    return { success: false, message: "Failed to validate the selected jobs" };
  }

  const readinessByJobId = new Map(
    readiness.data.jobs.map((job) => [job.id, job] as const)
  );
  // Every supplier starts on a new PO, or on the one an earlier slice of this
  // release created; a PO a job creates is reused by the jobs after it, so the
  // selection lands on one PO per supplier.
  const starting = bulkReleaseStartingPurchaseOrders(
    readiness.data.suppliers,
    purchaseOrdersBySupplierId
  );
  const suppliersWithDraftPurchaseOrders = starting.suppliersToChoose;
  let purchaseOrders = starting.purchaseOrders;

  let released = 0;
  const failed: Problem[] = [];
  const warnings: Problem[] = [];
  const locationIds = new Set<string>();
  for (const job of releasable) {
    const ready = readinessByJobId.get(job.id);
    const problems = ready
      ? [
          // The job page disables Release for the same job.
          ...(job.quantity === 0 && job.scrapQuantity === 0
            ? ["nothing to make"]
            : []),
          ...jobReleaseProblems(ready),
          ...(ready.supplierIds.some((id) =>
            suppliersWithDraftPurchaseOrders.has(id)
          )
            ? ["choose a purchase order for its outside operations on the job"]
            : [])
        ]
      : ["could not be validated"];
    if (problems.length > 0) {
      failed.push({ readableId: job.jobId, message: problems.join("; ") });
      continue;
    }

    const result = await releaseJobs({
      client: await resolveUserClient(client),
      db,
      jobIds: [job.id],
      companyId,
      userId,
      purchaseOrdersBySupplierId: purchaseOrders
    });
    purchaseOrders = result.purchaseOrdersBySupplierId;
    if (result.error) {
      logger.error("Failed to release job", {
        companyId,
        jobId: job.id,
        error: result.error
      });
    }
    // The job is Ready when its id came back released, error or not; a job
    // that is Ready must be scheduled and counted, whatever failed after.
    if (!result.releasedJobIds.includes(job.id)) {
      failed.push({ readableId: job.jobId, message: result.error ?? "" });
      continue;
    }
    if (result.error) {
      warnings.push({ readableId: job.jobId, message: result.error });
    }

    locationIds.add(job.locationId);
    released += 1;
  }

  // After every status flip is persisted — the scheduler only places jobs that
  // are already released. One run per location, as on the job page.
  let scheduled = true;
  for (const locationId of locationIds) {
    try {
      await runLocationSchedule({
        db,
        client: getCarbonServiceRole(),
        locationId,
        companyId,
        userId
      });
    } catch (error) {
      logger.error("Failed to schedule released jobs", {
        companyId,
        locationId,
        error
      });
      scheduled = false;
    }
  }

  return {
    success: true,
    released,
    warnings,
    failed,
    skipped,
    scheduled,
    purchaseOrdersBySupplierId: {
      ...purchaseOrdersBySupplierId,
      ...purchaseOrders
    }
  };
}

export type BulkDeleteJobsResult = BulkDeleteResult;

/**
 * Deletes the jobs the table's bulk Delete may delete: Draft, Planned, Due
 * Today and Overdue. The status filter is part of the DELETE, so a job that
 * moved on since it was selected stays. The caller checks the
 * `delete: production` permission.
 */
export function bulkDeleteJobs({
  client,
  jobIds,
  companyId
}: {
  client: SupabaseClient<Database>;
  jobIds: string[];
  companyId: string;
}): Promise<BulkDeleteJobsResult> {
  return bulkDeleteByStatus({
    ids: jobIds,
    companyId,
    label: "jobs",
    deleteChunk: (ids) =>
      client
        .from("job")
        .delete()
        .in("id", ids)
        .eq("companyId", companyId)
        .in("status", [...JOB_BULK_DELETABLE_STATUSES])
        .select("id")
  });
}

export type BulkBatchResult =
  | {
      success: true;
      /** Batches released or dissolved. */
      done: number;
      failed: Problem[];
      /** Batches whose status the action does not accept, or not found. */
      skipped: number;
    }
  | { success: false; message: string };

async function readBatches(
  client: SupabaseClient<Database>,
  ids: string[],
  companyId: string
) {
  const rows = [];
  for (const chunk of chunkArray(ids, IN_CHUNK)) {
    const page = await client
      .from("jobOperationBatch")
      .select("id, readableId, status, workCenterId")
      .in("id", chunk)
      .eq("companyId", companyId);
    if (page.error) return { data: null, error: page.error };
    rows.push(...page.data);
  }
  return { data: rows, error: null };
}

/**
 * Releases each Planned batch on its own: a batch the server function refuses
 * (no members, production already recorded) is reported in `failed` while the
 * rest still release. Any other status is skipped, so a stale selection can't
 * flip an Active or Completing batch.
 */
export async function bulkReleaseBatches({
  client,
  db,
  batchIds,
  companyId,
  userId
}: Args & {
  db: Kysely<KyselyDatabase>;
  batchIds: string[];
}): Promise<BulkBatchResult> {
  const ids = [...new Set(batchIds.filter(Boolean))];
  const rows = await readBatches(
    await resolveUserClient(client),
    ids,
    companyId
  );
  if (rows.error || !rows.data) {
    logger.error("Failed to load the batches to release", {
      companyId,
      error: rows.error
    });
    return { success: false, message: "Failed to load the selected batches" };
  }
  const batchById = new Map(rows.data.map((row) => [row.id, row] as const));
  const { allowed, skipped } = splitIdsByStatus(
    ids,
    rows.data,
    isBatchReleasable
  );

  let released = 0;
  const failed: Problem[] = [];
  for (const batchId of allowed) {
    const batch = batchById.get(batchId)!;
    const batchClient = await resolveUserClient(client);
    const members = await batchClient
      .from("jobOperation")
      .select("jobId")
      .eq("jobOperationBatchId", batchId)
      .eq("companyId", companyId);
    if (members.error) {
      failed.push({
        readableId: batch.readableId,
        message: "Failed to load the batch members"
      });
      continue;
    }

    // Member jobs release first, through the job page's release path. With no
    // dialog here, a batch with an invalid job or a PO choice to make is
    // skipped and named — the planner releases it from its drawer.
    const releasedJobs = await releaseBatchMemberJobs({
      client: batchClient,
      db,
      jobIds: (members.data ?? []).map((op) => op.jobId),
      companyId,
      userId
    });
    if (releasedJobs.error) {
      failed.push({
        readableId: batch.readableId,
        message: releasedJobs.error
      });
      continue;
    }

    const result = await releaseJobOperationBatch(batchClient, db, {
      batchId,
      companyId,
      userId
    });
    if (result.error) {
      failed.push({
        readableId: batch.readableId,
        message: getErrorMessage(result.error, "Failed to release")
      });
      continue;
    }

    // After the status flip is persisted — the wave must see the new state.
    await notifyScheduleInputsChanged(
      companyId,
      "work-center",
      "batch released",
      batch.workCenterId ?? undefined
    );
    released += 1;
  }

  return { success: true, done: released, failed, skipped };
}

/**
 * Dissolves each Planned or Active batch on its own: a batch that has recorded
 * production is refused by the server function and reported in `failed`. A
 * Completing or Completed batch is skipped.
 */
export async function bulkDissolveBatches({
  client,
  db,
  batchIds,
  companyId,
  userId
}: Args & {
  db: Kysely<KyselyDatabase>;
  batchIds: string[];
}): Promise<BulkBatchResult> {
  const ids = [...new Set(batchIds.filter(Boolean))];
  const rows = await readBatches(
    await resolveUserClient(client),
    ids,
    companyId
  );
  if (rows.error || !rows.data) {
    logger.error("Failed to load the batches to dissolve", {
      companyId,
      error: rows.error
    });
    return { success: false, message: "Failed to load the selected batches" };
  }
  const readableById = new Map(
    rows.data.map((row) => [row.id, row.readableId] as const)
  );
  const { allowed, skipped } = splitIdsByStatus(
    ids,
    rows.data,
    isBatchDissolvable
  );

  let dissolved = 0;
  const failed: Problem[] = [];
  for (const batchId of allowed) {
    const result = await updateJobOperationBatch(
      await resolveUserClient(client),
      db,
      { type: "dissolve", batchId, companyId, userId }
    );
    if (result.error) {
      failed.push({
        readableId: readableById.get(batchId) ?? batchId,
        message: getErrorMessage(result.error, "Failed to dissolve")
      });
    } else {
      dissolved += 1;
    }
  }

  return { success: true, done: dissolved, failed, skipped };
}
