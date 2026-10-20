// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ServiceContext } from "@carbon/api/service-fn.server";
import { getLogger } from "@carbon/logger";
import { runLocationSchedule } from "@carbon/planning";
import { chunkArray } from "@carbon/utils";
import {
  isBatchDissolvable,
  isJobBulkReleasable
} from "~/modules/production/production.models";
import {
  releaseBatches,
  releaseCheckedJobs,
  updateBatch
} from "~/modules/production/production.server";
import { getJobReleaseReadiness } from "~/modules/production/production.service";
import {
  bulkReleaseStartingPurchaseOrders,
  jobReleaseProblems
} from "~/modules/production/ui/Jobs/job-release-logic";
import { splitIdsByStatus } from "./table-jobs";

/**
 * The background bulk-action job's slices of the jobs and batches tables'
 * Release and Dissolve (`~/utils/table-jobs.server`). Each runs the
 * production service functions the in-request actions run, in the context
 * the job builds; a row the action may not act on is skipped.
 */

const logger = getLogger("erp", "production-bulk-actions");

/** An `.in()` filter rides in the request URL, so ids are read 100 at a time. */
const IN_CHUNK = 100;

type Problem = { readableId: string; message: string };

export type BulkReleaseJobsResult =
  | {
      success: true;
      released: number;
      /** Released, with something left to fix on the job (its POs). */
      warnings: Problem[];
      failed: Problem[];
      /** Jobs that are not Draft or Planned (a stale selection). */
      skipped: number;
      scheduled: boolean;
      /** The PO each supplier's outside operations went on. The next slice
       *  of the same release takes it. */
      purchaseOrdersBySupplierId: Record<string, string>;
    }
  | { success: false; message: string };

/**
 * Releases each Draft / Planned job on its own (`releaseCheckedJobs`): a job
 * that is not ready is reported in `failed` while the rest still release.
 * There is no dialog, so a job with something to fix or a purchase order to
 * choose is skipped and named. Then each location is scheduled once.
 *
 * A background release runs in slices of 25 jobs. `purchaseOrdersBySupplierId`
 * is the map the previous slice returned: a supplier keeps the PO an earlier
 * slice created instead of being asked to choose (`bulkReleaseStartingPurchaseOrders`).
 */
export async function bulkReleaseJobs(
  ctx: ServiceContext,
  {
    jobIds,
    purchaseOrdersBySupplierId
  }: {
    jobIds: string[];
    purchaseOrdersBySupplierId?: Record<string, string>;
  }
): Promise<BulkReleaseJobsResult> {
  const companyId = ctx.company.id;
  const client = ctx.asCaller.supabase;
  const ids = [...new Set(jobIds.filter(Boolean))];
  const jobs = [];
  for (const batch of chunkArray(ids, IN_CHUNK)) {
    const page = await client
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
    client,
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
          ...(ready.supplierIds.some((id) => starting.suppliersToChoose.has(id))
            ? ["choose a purchase order for its outside operations on the job"]
            : [])
        ]
      : ["could not be validated"];
    if (problems.length > 0) {
      failed.push({ readableId: job.jobId, message: problems.join("; ") });
      continue;
    }

    const result = await releaseCheckedJobs(ctx, {
      jobIds: [job.id],
      purchaseOrdersBySupplierId: purchaseOrders
    });
    const failure = result.error ?? result.data.failure;
    if (result.data) purchaseOrders = result.data.purchaseOrdersBySupplierId;
    if (failure) {
      logger.error("Failed to release job", {
        companyId,
        jobId: job.id,
        error: failure
      });
    }
    // The job is Ready when its id came back released, error or not; a job
    // that is Ready must be scheduled and counted, whatever failed after.
    if (!result.data?.releasedJobIds.includes(job.id)) {
      failed.push({ readableId: job.jobId, message: failure?.message ?? "" });
      continue;
    }
    if (failure) {
      warnings.push({ readableId: job.jobId, message: failure.message });
    }

    if (job.locationId) locationIds.add(job.locationId);
    released += 1;
  }

  // After every status flip is persisted: the scheduler only places jobs that
  // are already released. One run per location, as on the job page.
  let scheduled = true;
  for (const locationId of locationIds) {
    try {
      await runLocationSchedule({
        db: ctx.asSystem.pg,
        client: ctx.asSystem.supabase,
        locationId,
        companyId,
        userId: ctx.auditUserId
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

/**
 * Releases the Planned batches (`releaseBatches`): a batch whose member jobs
 * fail their checks, or that has a PO to choose, is reported in `failed`
 * while the rest still release. Any other status is skipped.
 */
export async function bulkReleaseBatches(
  ctx: ServiceContext,
  { batchIds }: { batchIds: string[] }
): Promise<BulkBatchResult> {
  const ids = [...new Set(batchIds.filter(Boolean))];
  if (ids.length === 0) {
    return { success: true, done: 0, failed: [], skipped: 0 };
  }
  const result = await releaseBatches(ctx, { batchIds: ids });
  if (result.error) {
    logger.error("Failed to release batches", {
      companyId: ctx.company.id,
      error: result.error
    });
    return { success: false, message: result.error.message };
  }
  return {
    success: true,
    done: result.data.released.length,
    failed: result.data.failed.map(({ readableId, message }) => ({
      readableId,
      message
    })),
    skipped: result.data.skipped.length
  };
}

/**
 * Dissolves each Planned or Active batch on its own (`updateBatch`): a batch
 * that has recorded production is refused and reported in `failed`. A
 * Completing or Completed batch is skipped.
 */
export async function bulkDissolveBatches(
  ctx: ServiceContext,
  { batchIds }: { batchIds: string[] }
): Promise<BulkBatchResult> {
  const companyId = ctx.company.id;
  const ids = [...new Set(batchIds.filter(Boolean))];
  const rows: { id: string; readableId: string; status: string }[] = [];
  for (const chunk of chunkArray(ids, IN_CHUNK)) {
    const page = await ctx.asCaller.supabase
      .from("jobOperationBatch")
      .select("id, readableId, status")
      .in("id", chunk)
      .eq("companyId", companyId);
    if (page.error) {
      logger.error("Failed to load the batches to dissolve", {
        companyId,
        error: page.error
      });
      return { success: false, message: "Failed to load the selected batches" };
    }
    rows.push(...page.data);
  }
  const readableById = new Map(
    rows.map((row) => [row.id, row.readableId] as const)
  );
  const { allowed, skipped } = splitIdsByStatus(ids, rows, isBatchDissolvable);

  let dissolved = 0;
  const failed: Problem[] = [];
  for (const batchId of allowed) {
    const result = await updateBatch(ctx, { batchId, type: "dissolve" });
    if (result.error) {
      failed.push({
        readableId: readableById.get(batchId) ?? batchId,
        message: result.error.message || "Failed to dissolve"
      });
    } else {
      dissolved += 1;
    }
  }

  return { success: true, done: dissolved, failed, skipped };
}
