// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonError, defineServiceFn } from "@carbon/api/service-fn.server";
import { paged, payload, run, unwrap } from "@carbon/api/service-tools.server";
import type { Json } from "@carbon/database";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { batchTrigger, trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import { runLocationSchedule } from "@carbon/planning";
import {
  async,
  chunkArray,
  datetime,
  getErrorMessage,
  groupBy,
  scrapAllowance,
  unchecked
} from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import {
  cancelOpenPickingListsForJob,
  issueMaterial,
  mergeTrackedEntities
} from "~/modules/inventory/inventory.service";
import { getDefaultStorageUnitForJob } from "~/modules/inventory/inventory.utils";
import {
  checkRevisionLock,
  getUnreleasedChangeOrderItems,
  jobCreationRefusal,
  methodStepRefusal,
  saveMethodRefusal,
  unreleasedChangeOrderItemsMessage,
  withLockNotice
} from "~/modules/items/items.service";
import { isSalesOrderClosed } from "~/modules/sales/sales.models";
import { resolveJobConfiguration } from "~/modules/sales/sales.utils";
import { methodItemType, methodType } from "~/modules/shared/shared.models";
import {
  getCompanyTimeZone,
  isActiveCompanyEmployee
} from "~/modules/shared/shared.service";
import {
  invokeCreate,
  invokePosting,
  setOperationWorkInstruction
} from "../shared/shared.service";
import { updateSortOrder } from "../shared/sort-order";
import {
  type AssemblyModelState,
  assemblyStepComponentsReassignValidator,
  bulkJobValidator,
  CANCELLABLE_JOB_STATUSES,
  copyPeopleBoardValidator,
  copyPeopleWeekValidator,
  deadlineTypes,
  getAssemblyModelState,
  getDueDateForColumn,
  isAssemblyPlanRunning,
  isJobEditableFromPlanning,
  isJobLocked,
  JOB_LOCKED_MESSAGE,
  JOB_LOCKED_STATUSES,
  jobOperationStatus,
  jobOperationValidator,
  jobStatus,
  jobValidator,
  makeToAssetItemError,
  PLANNING_EDITABLE_JOB_STATUSES,
  peopleAbsenceRangeValidator,
  peopleAbsenceValidator,
  peopleAssignmentValidator,
  peopleDayValidator,
  peopleHoursValidator,
  peopleMoveValidator,
  peopleOvertimeBulkValidator,
  peopleWeekAssignValidator,
  peopleWeekMoveValidator,
  peopleWeekUnassignValidator,
  procedureStatus,
  productionEventValidator,
  productionOrderValidator,
  productionQuantityValidator,
  salesOrderToJobValidator,
  scheduleJobUpdateValidator,
  scheduleOperationReorderValidator
} from "./production.models";
import type { JobStatus } from "./production.service";
import * as service from "./production.service";
import * as utils from "./production.utils";
import { jobReleaseProblems } from "./ui/Jobs/job-release-logic";

const logger = getLogger("erp", "production");

/**
 * Re-plan after an item's planning inputs change.
 *
 * @remarks
 * Its reordering policy, order multiple, minimum / maximum order quantity,
 * batch size, lead time. The planning pages list MRP's stored suggestions, so
 * without a run they kept the old sizing until the next scheduled one (every 3
 * hours) — an order multiple saved now read as ignored. A failed run never
 * fails the save.
 */
export const replanAfterItemChange = defineServiceFn({
  input: z.object({ itemId: z.string() }),
  // Whoever may save the item's planning may have it re-planned.
  permission: { update: "parts" },

  async run(ctx, { itemId }) {
    const mrp = await service.runMRP(ctx.asSystem.supabase, ctx.asSystem.pg, {
      type: "item",
      id: itemId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    });
    if (mrp.error) {
      logger.error("MRP failed after an item's planning settings changed", {
        companyId: ctx.company.id,
        itemId,
        error: mrp.error
      });
    }
  }
});

/**
 * Promote a Draft job to Planned.
 *
 * @remarks
 * The job page's Planned and the planning drawer's Plan. MRP does not count a
 * Draft job as supply, so a Draft job and a Make suggestion for the same need
 * sat side by side and could both be built. In order, as `releaseJobs` does:
 * the requirements recalculation (a failure stops here, with the job still
 * Draft, so MRP never counts a job whose requirements are stale), the guarded
 * status flip (only from Draft), then MRP — which now counts the job, so the
 * Make suggestion shrinks by it. No scheduler notice: the scheduler places
 * only released jobs (`activeJobStatuses`), and a Planned job's dates and
 * priority are unchanged. The planning drawer checks the job's location and
 * that no sales order owns it before it calls this.
 *
 * Returns `conflict` when the job is no longer Draft. `warning` is set when
 * the job is Planned but MRP did not run.
 */
export const planDraftJob = defineServiceFn({
  input: z.object({ jobId: z.string() }),
  permission: { update: "production" },

  async run(ctx, { jobId }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // Before the recalculation, which runs with the service role.
    const job = await ctx.asCaller.supabase
      .from("job")
      .select("status")
      .eq("id", jobId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (job.error) {
      return ctx.error("internal", "Failed to read the job", job.error);
    }
    if (!job.data) return ctx.error("notFound", "Job not found");
    if (job.data.status !== "Draft") {
      return ctx.error("conflict", "Only a Draft job can be planned.");
    }

    const recalc = await service.recalculateJobRequirements(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      { id: jobId, companyId, userId }
    );
    if (recalc.error) {
      return ctx.error(
        "internal",
        "The job's materials and operations could not be recalculated, so it was not planned. Recalculate the job and try again.",
        recalc.error
      );
    }

    const flipped = await service.updateJobStatus(ctx.asCaller.supabase, {
      id: jobId,
      companyId,
      status: "Planned",
      updatedBy: userId,
      fromStatuses: ["Draft"]
    });
    if (flipped.error) {
      return ctx.error("internal", "Failed to plan the job", flipped.error);
    }
    if (!flipped.updated) {
      return ctx.error("conflict", "Only a Draft job can be planned.");
    }

    const mrp = await service.runMRP(ctx.asSystem.supabase, ctx.asSystem.pg, {
      type: "job",
      id: jobId,
      companyId,
      userId
    });
    if (mrp.error) {
      logger.error("MRP failed after planning a Draft job", {
        companyId,
        jobId,
        error: mrp.error
      });
      return {
        warning:
          "The job is Planned, but the suggestions were not refreshed. Press Recalculate."
      };
    }
    return { warning: null };
  }
});

/**
 * Release jobs that have been checked.
 *
 * @remarks
 * The step every release path shares (`releaseJobs`, `releaseBatchMemberJobs`).
 * Per job, in order: refresh requirements, run MRP, flip to Ready, put outside
 * operations on purchase orders, stamp releasedDate. Scheduling is the
 * caller's (one location run, or a notify, after all jobs are released).
 * Validation (`getJobReleaseReadiness`) is the caller's, BEFORE this runs.
 *
 * `purchaseOrdersBySupplierId` maps a supplier to "new" or a Draft PO id; a
 * supplier's first "new" PO is reused for the jobs after it, so a batch puts
 * each supplier's outside operations from every member job on one PO. The map
 * is returned with those POs filled in, for a caller releasing job by job.
 *
 * It stops at the first job that fails, and that is `failure`, not an error:
 * `releasedJobIds` are the jobs that ARE Ready when this returns. After a
 * failure past the status flip (purchase orders, release date) the job is
 * released, and the caller must still schedule it and say so.
 */
export const releaseCheckedJobs = defineServiceFn({
  input: z.object({
    jobIds: z.array(z.string()),
    purchaseOrdersBySupplierId: z.record(z.string(), z.string())
  }),
  permission: { update: "production" },

  async run(ctx, { jobIds, purchaseOrdersBySupplierId }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const purchaseOrders = { ...purchaseOrdersBySupplierId };
    const releasedJobIds: string[] = [];
    const report = (failure: CarbonError<"internal" | "conflict"> | null) => ({
      purchaseOrdersBySupplierId: purchaseOrders,
      releasedJobIds,
      failure
    });

    for (const id of jobIds) {
      const recalc = await service.recalculateJobRequirements(
        ctx.asSystem.supabase,
        ctx.asSystem.pg,
        { id, companyId, userId }
      );
      if (recalc.error) {
        return report(
          ctx.error(
            "internal",
            "The job could not be recalculated",
            recalc.error
          )
        );
      }

      // A failed plan never blocks a release: the scheduled MRP run (every 3
      // hours) and Material Planning's Recalculate both repair it.
      const mrp = await service.runMRP(ctx.asSystem.supabase, ctx.asSystem.pg, {
        type: "job",
        id,
        companyId,
        userId
      });
      if (mrp.error) {
        logger.error("MRP failed during job release", {
          companyId,
          jobId: id,
          error: mrp.error
        });
      }

      // Only a job still waiting for release flips: the caller checked the
      // status before the recalculation and MRP above, and someone may have
      // cancelled or released it since.
      const update = await service.updateJobStatus(ctx.asCaller.supabase, {
        id,
        companyId,
        status: "Ready",
        updatedBy: userId,
        fromStatuses: ["Draft", "Planned"]
      });
      if (update.error) {
        return report(
          ctx.error("internal", "The job could not be released", update.error)
        );
      }
      if (!update.updated) {
        return report(
          ctx.error("conflict", "The job is no longer Draft or Planned")
        );
      }
      releasedJobIds.push(id);

      const purchaseOrder = await invokeCreate(
        { db: ctx.asSystem.pg, companyId, userId },
        {
          type: "purchaseOrderFromJob",
          jobId: id,
          purchaseOrdersBySupplierId: purchaseOrders
        }
      );
      if (purchaseOrder.error) {
        return report(
          ctx.error(
            "internal",
            `The job is released, but its purchase orders could not be created: ${getErrorMessage(
              purchaseOrder.error,
              "unknown error"
            )}`,
            purchaseOrder.error
          )
        );
      }
      Object.assign(
        purchaseOrders,
        purchaseOrder.data?.purchaseOrderIdsBySupplierId ?? {}
      );

      // The date feeds the completion-time KPI and nothing else writes it, so a
      // silent failure would be permanent.
      const stamped = await ctx.asCaller.supabase
        .from("job")
        .update({ releasedDate: datetime.timestamp() })
        .eq("id", id)
        .eq("companyId", companyId);
      if (stamped.error) {
        logger.error("Failed to stamp the release date", {
          companyId,
          jobId: id,
          error: stamped.error
        });
        return report(
          ctx.error(
            "internal",
            "The job is released, but its release date could not be saved",
            stamped.error
          )
        );
      }
    }
    return report(null);
  }
});

type JobRef = { jobId: string; readableId: string };

/**
 * Release jobs to the shop floor.
 *
 * @remarks
 * Checks each Draft or Planned job and releases the ones that pass, then
 * schedules their locations. A job that fails a check stays as it is.
 *
 * A job is not released when:
 * - it has nothing to make
 * - manufacturing is blocked for its item
 * - an assembly has no operations
 * - an outside operation has no supplier, or several and none chosen
 * - it is Make to Asset and cannot complete to its asset
 * - a supplier has Draft purchase orders and no choice was sent
 *
 * @param jobIds - The jobs to release.
 * @param supplierProcessByOperationId - The supplier process to use for each outside operation, by operation id.
 * @param purchaseOrdersBySupplierId - For each supplier, `new` or the id of one of its Draft purchase orders to add to.
 *
 * @returns `released`, `failed` (each with its reason), `skipped` (not Draft or Planned), `warnings` (released, but a purchase order failed) and the `scheduled` locations.
 *
 * @mcp
 */
export const releaseJobs = defineServiceFn({
  input: z.object({
    jobIds: z.array(z.string()).min(1),
    purchaseOrdersBySupplierId: z.record(z.string(), z.string()).optional(),
    supplierProcessByOperationId: z.record(z.string(), z.string()).default({})
  }),
  permission: { update: "production" },

  async run(
    ctx,
    { jobIds, purchaseOrdersBySupplierId, supplierProcessByOperationId }
  ) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const jobs: {
      id: string;
      jobId: string;
      status: (typeof jobStatus)[number] | null;
      locationId: string | null;
    }[] = [];
    // An `in` filter rides in the request URL, so ids are read in groups.
    for (const batch of chunkArray([...new Set(jobIds)], 100)) {
      const page = await client
        .from("job")
        .select("id, jobId, status, locationId")
        .in("id", batch)
        .eq("companyId", companyId);
      if (page.error) {
        return ctx.error("internal", "Failed to load the jobs", page.error);
      }
      jobs.push(...page.data);
    }

    const found = new Set(jobs.map((job) => job.id));
    const failed: (JobRef & { message: string })[] = jobIds
      .filter((id) => !found.has(id))
      .map((id) => ({ jobId: id, readableId: id, message: "not found" }));
    const skipped: (JobRef & { status: string | null })[] = [];
    const releasable = jobs
      .filter((job) => {
        if (job.status === "Draft" || job.status === "Planned") return true;
        skipped.push({
          jobId: job.id,
          readableId: job.jobId,
          status: job.status
        });
        return false;
      })
      .sort((a, b) => a.jobId.localeCompare(b.jobId));

    const stamped = await service.stampSupplierChoices(ctx, {
      jobIds: releasable.map((job) => job.id),
      choices: supplierProcessByOperationId
    });
    if (stamped) return stamped;

    const readiness = await service.getJobReleaseReadiness(
      client,
      releasable.map((job) => job.id),
      companyId
    );
    if (readiness.error || !readiness.data) {
      return ctx.error(
        "internal",
        "Failed to validate the jobs",
        readiness.error
      );
    }
    const readinessByJobId = new Map(
      readiness.data.jobs.map((job) => [job.id, job] as const)
    );
    const draftPurchaseOrdersBySupplier = new Map(
      readiness.data.suppliers.map(
        (supplier) =>
          [
            supplier.supplierId,
            new Set(supplier.draftPurchaseOrders.map((po) => po.id))
          ] as const
      )
    );
    // Only a Draft PO of that supplier is a valid target; anything else is
    // "new". A supplier's first new PO is reused by the jobs after it.
    let purchaseOrders: Record<string, string> = Object.fromEntries(
      readiness.data.suppliers.map((supplier) => {
        const picked = purchaseOrdersBySupplierId?.[supplier.supplierId];
        return [
          supplier.supplierId,
          picked &&
          draftPurchaseOrdersBySupplier.get(supplier.supplierId)?.has(picked)
            ? picked
            : "new"
        ];
      })
    );

    const released: JobRef[] = [];
    const warnings: (JobRef & { message: string })[] = [];
    const locationIds = new Set<string>();
    for (const job of releasable) {
      const ref = { jobId: job.id, readableId: job.jobId };
      const ready = readinessByJobId.get(job.id);
      const problems = ready
        ? [
            ...jobReleaseProblems(ready),
            // With no choice sent there is no dialog to make one in.
            ...(!purchaseOrdersBySupplierId &&
            ready.supplierIds.some(
              (id) => (draftPurchaseOrdersBySupplier.get(id)?.size ?? 0) > 0
            )
              ? [
                  "choose a purchase order for its outside operations on the job"
                ]
              : [])
          ]
        : ["could not be validated"];
      if (problems.length > 0) {
        failed.push({ ...ref, message: problems.join("; ") });
        continue;
      }

      const result = await releaseCheckedJobs(ctx, {
        jobIds: [job.id],
        purchaseOrdersBySupplierId: purchaseOrders
      });
      const failure = result.error ?? result.data.failure;
      if (result.data) purchaseOrders = result.data.purchaseOrdersBySupplierId;
      // A job whose id came back released IS Ready, error or not: it must be
      // scheduled and counted, whatever failed after.
      if (!result.data?.releasedJobIds.includes(job.id)) {
        failed.push({ ...ref, message: failure?.message ?? "" });
        continue;
      }
      if (failure) warnings.push({ ...ref, message: failure.message });
      if (job.locationId) locationIds.add(job.locationId);
      released.push(ref);
    }

    // After every status flip is persisted: the scheduler only places jobs
    // that are already released. One run per location.
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

    return { released, warnings, failed, skipped, scheduled };
  }
});
/**
 * Cancel a job.
 *
 * @remarks
 * The one cancel path: the job status route and the planning Cancel action
 * both call it, so neither can skip a step. In order:
 *   1. set the job Cancelled and clear its assignee, only while it is in
 *      `fromStatuses` (by default any status a job can be cancelled from),
 *   2. return the picked material the job did not consume,
 *   3. cancel its lines on every open picking list.
 * A refused cancel changes nothing. The job stays Cancelled when step 2 or 3
 * fails; that failure is returned as `warning`.
 *
 * Returns `notFound` for a job that is not this company's, and `conflict`
 * when the job is not in `fromStatuses`.
 *
 * @mcp
 */
export const cancelJob = defineServiceFn({
  input: z.object({
    jobId: z.string(),
    /**
     * Cancel only while the job is still in one of these statuses, checked
     * in the status UPDATE. Planning's Cancel sends Draft / Planned: it read
     * the status earlier, and a job released since must not lose its picks.
     */
    fromStatuses: z.array(z.enum(jobStatus)).optional()
  }),
  permission: { update: "production" },

  async run(ctx, { jobId, fromStatuses = [...CANCELLABLE_JOB_STATUSES] }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // The steps below write past RLS: the job must be this company's first.
    const job = await ctx.asSystem.pg
      .selectFrom("job")
      .select("status")
      .where("id", "=", jobId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!job) return ctx.error("notFound", "Job not found");

    const update = await service.updateJobStatus(ctx.asCaller.supabase, {
      id: jobId,
      companyId,
      status: "Cancelled",
      assignee: null,
      updatedBy: userId,
      fromStatuses
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update job status", update.error);
    }
    if (!update.updated) {
      return ctx.error(
        "conflict",
        "The job's status changed; cancel it on the job"
      );
    }

    const sweep = await service.returnPickedRemaindersForJob(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      { jobId, userId, companyId }
    );
    if (sweep.error) {
      logger.error("Returning picked material failed after a cancel", {
        companyId,
        jobId,
        error: sweep.error
      });
      return {
        jobId,
        warning:
          "The job is cancelled, but its picked material was not returned to stock."
      };
    }

    const picks = await cancelOpenPickingListsForJob(ctx.asSystem.pg, {
      jobId,
      companyId,
      userId
    });
    if (picks.error) {
      logger.error("Closing picking lists failed after a cancel", {
        companyId,
        jobId,
        error: picks.error
      });
      return {
        jobId,
        warning:
          "The job is cancelled, but its open picking lists were not cancelled."
      };
    }

    return { jobId, warning: null };
  }
});
/**
 * Pause a job on the floor.
 *
 * @remarks
 * Only a Ready or In Progress job can be paused. The status is the only
 * change: its operations, picks and schedule stay as they are.
 *
 * @mcp
 */
export const pauseJob = defineServiceFn({
  input: z.object({ jobId: z.string() }),
  permission: { update: "production" },

  async run(ctx, { jobId }) {
    return service.moveJobStatus(ctx, jobId, {
      from: ["Ready", "In Progress"],
      to: "Paused",
      refusal: "Only a Ready or In Progress job can be paused"
    });
  }
});

/**
 * Resume a paused job.
 *
 * @remarks
 * Only a Paused job can be resumed, and it goes back to Ready. It is refused
 * when its item's manufacturing is blocked, and for a Make to Asset job when
 * the item cannot complete to the asset (`makeToAssetItemError`) or the job is
 * on a sales order line. Then, in order: the requirements are recalculated and
 * MRP runs (a failure of either is logged and does not stop the resume), and
 * the status flips.
 *
 * @mcp
 */
export const resumeJob = defineServiceFn({
  input: z.object({ jobId: z.string() }),
  permission: { update: "production" },

  async run(ctx, { jobId }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const job = await service.getJobToResume(
      ctx.asCaller.supabase,
      jobId,
      companyId
    );
    if (job.error) {
      return ctx.error("internal", "Failed to read the job", job.error);
    }
    if (!job.data) return ctx.error("notFound", "Job not found");
    if (job.data.status !== "Paused") {
      return ctx.error("rule", "Only a Paused job can be resumed");
    }
    if (job.data.item?.itemReplenishment?.manufacturingBlocked) {
      return ctx.error("rule", "Manufacturing is blocked");
    }
    if (job.data.fixedAssetClassId || job.data.fixedAssetId) {
      const itemError = makeToAssetItemError({
        fixedAssetClassId: job.data.fixedAssetClassId,
        fixedAssetId: job.data.fixedAssetId,
        itemTrackingType: job.data.item?.itemTrackingType,
        quantity: job.data.quantity
      });
      if (itemError) return ctx.error("rule", itemError);
      if (job.data.salesOrderLineId) {
        return ctx.error(
          "rule",
          "A job linked to a sales order line cannot complete to a fixed asset"
        );
      }
    }

    const recalc = await service.recalculateJobRequirements(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      { id: jobId, companyId, userId }
    );
    if (recalc.error) {
      logger.error("Recalculation failed while resuming a job", {
        companyId,
        jobId,
        error: recalc.error
      });
    }
    const mrp = await service.runMRP(ctx.asSystem.supabase, ctx.asSystem.pg, {
      type: "job",
      id: jobId,
      companyId,
      userId
    });
    if (mrp.error) {
      logger.error("MRP failed while resuming a job", {
        companyId,
        jobId,
        error: mrp.error
      });
    }

    return service.moveJobStatus(ctx, jobId, {
      from: ["Paused"],
      to: "Ready",
      refusal: "Only a Paused job can be resumed"
    });
  }
});

/** Where a reopened job goes back to, by the status it leaves. */
const REOPENED_STATUS = {
  Cancelled: "Draft",
  Completed: "In Progress"
} as const satisfies Partial<Record<JobStatus, JobStatus>>;

/**
 * Reopen a cancelled or completed job.
 *
 * @remarks
 * A Cancelled job goes back to Draft, a Completed one to In Progress; any
 * other status is refused. Leaving a completed state clears the completed
 * date. Nothing that the completion received or consumed is reversed.
 *
 * @mcp
 */
export const reopenJob = defineServiceFn({
  input: z.object({ jobId: z.string() }),
  permission: { update: "production" },

  async run(ctx, { jobId }) {
    const job = await ctx.asCaller.supabase
      .from("job")
      .select("status")
      .eq("id", jobId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (job.error) {
      return ctx.error("internal", "Failed to read the job", job.error);
    }
    if (!job.data) return ctx.error("notFound", "Job not found");
    const status = job.data.status;
    if (status !== "Cancelled" && status !== "Completed") {
      return ctx.error(
        "rule",
        "Only a Cancelled or Completed job can be reopened"
      );
    }
    return service.moveJobStatus(ctx, jobId, {
      from: [status],
      to: REOPENED_STATUS[status],
      refusal: "Only a Cancelled or Completed job can be reopened"
    });
  }
});

/**
 * Close a completed job.
 *
 * @remarks
 * Only a Completed job can be closed. The status flips to Closed, then
 * whatever is left in WIP for the job is written off as production variance
 * (`close-job`; Provisional before the accounting cutover, Posted after). A
 * failed write-off leaves the job Closed and is returned as `warning`.
 *
 * @mcp
 */
export const closeJob = defineServiceFn({
  input: z.object({ jobId: z.string() }),
  permission: { update: "production" },

  async run(ctx, { jobId }) {
    const closed = await service.moveJobStatus(ctx, jobId, {
      from: ["Completed"],
      to: "Closed",
      refusal: "Only a Completed job can be closed"
    });
    if (closed instanceof CarbonError) return closed;

    const writeOff = await run(ctx, "close-job", () =>
      service.closeJob(ctx, { jobId })
    );
    if (writeOff instanceof CarbonError) {
      logger.error("Failed to write off WIP for closed job", {
        jobId,
        companyId: ctx.company.id,
        error: writeOff
      });
      return {
        ...closed,
        warning: "The job is Closed, but its remaining WIP was not written off"
      };
    }
    return { ...closed, warning: null };
  }
});

/**
 * Complete a job to inventory.
 *
 * @remarks
 * `quantityComplete` is CUMULATIVE: the job's total good quantity so far, not
 * this completion's. `complete_job_to_inventory` receives the difference from
 * what was already received (into `storageUnitId` at `locationId`, else the
 * job's own), backflushes materials, rolls up cost and, for a Make to Asset
 * job, creates the fixed assets. It refuses a quantity of zero or below what
 * was received, a fractional quantity on a serial job, and the Make to Asset
 * rules; its message says what to fix (a `rule` error). Then the picked
 * material the job did not consume is returned to the warehouse; a failure
 * there leaves the job completed and is returned as `warning`.
 *
 * @mcp
 */
export const completeJob = defineServiceFn({
  input: z.object({
    jobId: z.string(),
    quantityComplete: z.number().min(0),
    locationId: z.string().optional(),
    storageUnitId: z.string().optional()
  }),
  permission: { update: "production" },

  async run(ctx, { jobId, quantityComplete, locationId, storageUnitId }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // It must NOT write job.quantityShipped: that column is advanced only by
    // post-shipment, and the shipment builder ships quantityComplete less it.
    const rpc = await ctx.asCaller.supabase.rpc("complete_job_to_inventory", {
      p_job_id: jobId,
      p_quantity_complete: quantityComplete,
      p_storage_unit_id: storageUnitId,
      p_location_id: locationId,
      p_company_id: companyId,
      p_user_id: userId
    });
    if (rpc.error) {
      return ctx.error(
        "rule",
        rpc.error.message || "Failed to complete job",
        rpc.error
      );
    }

    // A re-completion is supported; the job id is the idempotency key, so a
    // repeat collapses rather than counting a second completion.
    trackWorkEvent("job_completed", {
      companyId,
      userId,
      jobId,
      path: "manual"
    });

    // After the RPC: its backflush must consume first. The sweep is
    // idempotent, so a failure is reported and can be re-run.
    const sweep = await service.returnPickedRemaindersForJob(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      { jobId, userId, companyId }
    );
    if (sweep.error) {
      logger.error("Returning picked material failed after completion", {
        companyId,
        jobId,
        error: sweep.error
      });
      return {
        jobId,
        warning: "Job completed, but returning picked material failed"
      };
    }
    return { jobId, warning: null };
  }
});

/**
 * Release a batch's Draft / Planned member jobs.
 *
 * @remarks
 * Through the same path as the job page: every one is validated first and ANY
 * problem refuses the whole batch before anything changes.
 * `purchaseOrdersBySupplierId` is the planner's PO choice from the Release
 * dialog; unattended callers (bulk release) send none, and a batch that needs
 * a choice — a supplier with Draft POs to pick from — is refused so the
 * planner can release it from its dialog.
 */
export const releaseBatchMemberJobs = defineServiceFn({
  input: z.object({
    jobIds: z.array(z.string()),
    purchaseOrdersBySupplierId: z.record(z.string(), z.string()).optional()
  }),
  permission: { update: "production" },

  async run(ctx, { jobIds, purchaseOrdersBySupplierId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    const jobs = await client
      .from("job")
      .select("id, status")
      .in("id", [...new Set(jobIds)])
      .eq("companyId", companyId);
    if (jobs.error) {
      return ctx.error(
        "internal",
        "Failed to load the batch's jobs",
        jobs.error
      );
    }

    const toRelease = (jobs.data ?? [])
      .filter((job) => job.status === "Draft" || job.status === "Planned")
      .map((job) => job.id);
    if (toRelease.length === 0) return { releasedJobIds: [] as string[] };

    const readiness = await service.getJobReleaseReadiness(
      client,
      toRelease,
      companyId
    );
    if (readiness.error || !readiness.data) {
      return ctx.error(
        "internal",
        "Failed to validate the batch's jobs",
        readiness.error
      );
    }

    const problems = readiness.data.jobs.flatMap((job) =>
      jobReleaseProblems(job).map((problem) => `${job.jobId}: ${problem}`)
    );
    if (problems.length > 0) {
      return ctx.error(
        "rule",
        `Fix these jobs before releasing: ${problems.join("; ")}`
      );
    }

    if (
      !purchaseOrdersBySupplierId &&
      readiness.data.suppliers.some((s) => s.draftPurchaseOrders.length > 0)
    ) {
      return ctx.error(
        "rule",
        "Outside operations need a purchase order choice — open the batch to release it"
      );
    }

    // Only a Draft PO of that supplier is a valid target; anything else is "new".
    const purchaseOrders = Object.fromEntries(
      readiness.data.suppliers.map((supplier) => {
        const picked = purchaseOrdersBySupplierId?.[supplier.supplierId];
        return [
          supplier.supplierId,
          picked && supplier.draftPurchaseOrders.some((po) => po.id === picked)
            ? picked
            : "new"
        ];
      })
    );

    const released = await releaseCheckedJobs(ctx, {
      jobIds: toRelease,
      purchaseOrdersBySupplierId: purchaseOrders
    });
    if (released.error) return released.error;
    if (released.data.failure) return released.data.failure;
    return { releasedJobIds: released.data.releasedJobIds };
  }
});

/**
 * Release operation batches.
 *
 * @remarks
 * What the batch drawer's Release and the batches table's Release run. Per
 * Planned batch, in order: release its Draft / Planned member jobs through
 * the job page's checks (any problem refuses the batch untouched), put the
 * batch on the floor, then tell the scheduler. A batch that is not Planned is
 * listed in `skipped`. `purchaseOrdersBySupplierId` is the release dialog's
 * choice; without one, a batch whose suppliers have Draft purchase orders is
 * refused.
 *
 * @mcp
 */
export const releaseBatches = defineServiceFn({
  input: z.object({
    batchIds: z.array(z.string()).min(1),
    purchaseOrdersBySupplierId: z.record(z.string(), z.string()).optional()
  }),
  permission: { update: "production" },

  async run(ctx, { batchIds, purchaseOrdersBySupplierId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const ids = [...new Set(batchIds)];

    const batches = await client
      .from("jobOperationBatch")
      .select("id, readableId, status, workCenterId")
      .in("id", ids)
      .eq("companyId", companyId);
    if (batches.error) {
      return ctx.error("internal", "Failed to load the batches", batches.error);
    }

    type BatchRef = { batchId: string; readableId: string };
    const found = new Set(batches.data.map((batch) => batch.id));
    const failed: (BatchRef & { message: string })[] = ids
      .filter((id) => !found.has(id))
      .map((id) => ({ batchId: id, readableId: id, message: "not found" }));
    const skipped: (BatchRef & { status: string })[] = [];
    const planned = batches.data.filter((batch) => {
      if (batch.status === "Planned") return true;
      skipped.push({
        batchId: batch.id,
        readableId: batch.readableId,
        status: batch.status
      });
      return false;
    });
    if (planned.length === 0) return { released: [], failed, skipped };

    const members = await client
      .from("jobOperation")
      .select("jobId, jobOperationBatchId")
      .in(
        "jobOperationBatchId",
        planned.map((batch) => batch.id)
      )
      .eq("companyId", companyId);
    if (members.error) {
      return ctx.error(
        "internal",
        "Failed to load the batch members",
        members.error
      );
    }
    const jobIdsByBatch = groupBy(
      members.data,
      (op) => op.jobOperationBatchId ?? ""
    );

    const released: BatchRef[] = [];
    for (const batch of planned) {
      const ref = { batchId: batch.id, readableId: batch.readableId };
      const jobs = await releaseBatchMemberJobs(ctx, {
        jobIds: (jobIdsByBatch[batch.id] ?? []).map((op) => op.jobId),
        purchaseOrdersBySupplierId
      });
      if (jobs.error) {
        failed.push({ ...ref, message: jobs.error.message });
        continue;
      }

      const result = await service.releaseJobOperationBatch(
        client,
        ctx.asSystem.pg,
        {
          batchId: batch.id,
          companyId,
          userId: ctx.auditUserId
        }
      );
      if (result.error) {
        failed.push({
          ...ref,
          message: getErrorMessage(result.error, "Failed to release")
        });
        continue;
      }

      // After the status flip is persisted: the wave must see the new state.
      await service.notifyScheduleInputsChanged(
        companyId,
        "work-center",
        "batch released",
        batch.workCenterId ?? undefined
      );
      released.push(ref);
    }

    return { released, failed, skipped };
  }
});

/**
 * Move operations on the schedule board: into a work center's column, in a
 * dispatch order.
 *
 * @remarks
 * Writes the priorities (and work center) a drop on the operations board gives
 * one card or several, as one all-or-nothing statement. Every operation must
 * exist and be open, its job unlocked and at the work center's location, and
 * the work center active and running its process; anything else is "Invalid
 * scheduling request". A job or operation that changed between the checks and
 * the write is a `conflict`. When any operation changed work center, the
 * scheduler is told, so the forecast follows; a reorder within one work center
 * only re-sequences the dispatch order.
 *
 * @mcp
 */
export const reorderScheduleOperations = defineServiceFn({
  input: scheduleOperationReorderValidator,
  permission: { update: "production" },

  async run(ctx, { columnId, updates }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const invalid = () => ctx.error("rule", "Invalid scheduling request");
    const ids = updates.map((u) => u.id);

    const [operations, workCenter] = await Promise.all([
      client
        .from("jobOperation")
        .select("id, jobId, processId, status, workCenterId")
        .eq("companyId", companyId)
        .in("id", ids),
      client
        .from("workCenter")
        .select("id, active, locationId")
        .eq("id", columnId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (
      operations.error ||
      workCenter.error ||
      !workCenter.data?.active ||
      operations.data.length !== ids.length ||
      operations.data.some(
        (o) => o.status === "Done" || o.status === "Canceled"
      )
    ) {
      return invalid();
    }

    const destination = workCenter.data;
    const jobIds = [...new Set(operations.data.map((o) => o.jobId))];
    const processIds = [...new Set(operations.data.map((o) => o.processId))];
    const [jobs, processes] = await Promise.all([
      client
        .from("job")
        .select("id, locationId, status")
        .eq("companyId", companyId)
        .in("id", jobIds),
      client
        .from("workCenterProcess")
        .select("processId")
        .eq("workCenterId", destination.id)
        .eq("companyId", companyId)
        .in("processId", processIds)
    ]);
    if (
      jobs.error ||
      processes.error ||
      jobs.data.length !== jobIds.length ||
      jobs.data.some(
        (j) => isJobLocked(j.status) || j.locationId !== destination.locationId
      ) ||
      new Set(processes.data.map((p) => p.processId)).size !== processIds.length
    ) {
      return invalid();
    }

    const processByOperation = new Map(
      operations.data.map((o) => [o.id, o.processId])
    );

    const written = await ctx.transaction(async (tx) => {
      // Read again under a lock: a job completed or moved since the first read
      // must not have its operations rescheduled.
      const current = await tx.asSystem.pg
        .selectFrom("job")
        .select(["status", "locationId"])
        .where("companyId", "=", companyId)
        .where("id", "in", jobIds)
        .forShare()
        .execute();
      if (
        current.length !== jobIds.length ||
        current.some(
          (j) =>
            isJobLocked(j.status) || j.locationId !== destination.locationId
        )
      ) {
        return ctx.error("conflict", "Job unavailable");
      }

      const rows = await sql<{ id: string }>`
        UPDATE "jobOperation" AS o
        SET "workCenterId" = ${destination.id},
          "priority" = v."priority"::float8,
          "updatedBy" = ${userId},
          "updatedAt" = ${datetime.timestamp()}
        FROM (VALUES ${sql.join(
          updates.map(
            (u) =>
              sql`(${u.id}, ${u.priority}, ${processByOperation.get(u.id) ?? null})`
          )
        )}) AS v("id", "priority", "processId")
        WHERE o."id" = v."id"
          AND o."processId" IS NOT DISTINCT FROM v."processId"
          AND o."companyId" = ${companyId}
          AND o."status" NOT IN ('Done', 'Canceled')
        RETURNING o."id"
      `.execute(tx.asSystem.pg);
      // An operation that finished, left or changed process since the read:
      // none are written.
      if (rows.rows.length !== ids.length) {
        return ctx.error("conflict", "Operation unavailable");
      }
    });
    if (written.error) return written.error;

    const workCenterChanged = operations.data.some(
      (o) => o.workCenterId !== destination.id
    );
    if (workCenterChanged) {
      await service.notifyScheduleInputsChanged(
        companyId,
        "work-center",
        "Operation reassigned to a different work center",
        destination.id
      );
    }
    return { workCenterChanged };
  }
});

/**
 * Move a job on the dates board: to a due date column, in a dispatch order.
 *
 * @remarks
 * `columnId` is a date (`YYYY-MM-DD`) or one of the board's undated columns,
 * which clears the due date. Writes the due date and priority of a job at
 * `locationId` that is not locked; a job elsewhere or locked is a `conflict`.
 * Then the scheduler is told; the debounced wave regenerates the location in
 * due date, then priority, order. A failed notice is logged and not returned.
 *
 * @mcp
 */
export const moveScheduleJob = defineServiceFn({
  input: scheduleJobUpdateValidator,
  permission: { update: "production" },

  async run(ctx, { id, locationId, columnId, priority }) {
    const companyId = ctx.company.id;
    const dueDate = getDueDateForColumn(columnId);
    if (dueDate === undefined) {
      return ctx.error("validation", "Invalid form data");
    }

    const { data, error } = await ctx.asCaller.supabase
      .from("job")
      .update({
        dueDate,
        priority,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .eq("locationId", locationId)
      .not("status", "in", `(${JOB_LOCKED_STATUSES.join(",")})`)
      .select("id")
      .maybeSingle();
    if (error) return ctx.error("internal", error.message, error);
    if (data === null) {
      return ctx.error("conflict", "Job unavailable or locked");
    }

    await service.notifyScheduleInputsChanged(
      companyId,
      "reorder",
      "Schedule reordered"
    );
    return { id };
  }
});
/**
 * Record a production event (labor, machine or setup time) on a job operation.
 *
 * @remarks
 * Refused when the operation's job is locked (Completed, Closed or
 * Cancelled). An event sent with an `endTime` is posted to the GL right away
 * (`post-production-event`); when that is skipped or fails the event is still
 * saved and the reason is returned as `postingError`.
 *
 * @mcp
 */
export const createProductionEvent = defineServiceFn({
  input: productionEventValidator,
  permission: { create: "production" },

  async run(ctx, { id: _id, ...event }) {
    const operation = await ctx.asCaller.supabase
      .from("jobOperation")
      .select("job(status)")
      .eq("id", event.jobOperationId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (operation.error) {
      return ctx.error(
        "internal",
        "Failed to read the operation",
        operation.error
      );
    }
    if (!operation.data) return ctx.error("notFound", "Operation not found");
    if (isJobLocked(operation.data.job?.status)) {
      return ctx.error("rule", JOB_LOCKED_MESSAGE);
    }

    const insert = await service.upsertProductionEvent(ctx.asCaller.supabase, {
      ...event,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (insert.error) {
      return ctx.error(
        "internal",
        "Failed to insert production event",
        insert.error
      );
    }

    const postingError = event.endTime
      ? await service.postEndedEvent(ctx, insert.data.id)
      : null;
    return { id: insert.data.id, postingError };
  }
});

/**
 * Update a production event.
 *
 * @remarks
 * Writes the event's operation, type, employee, work center, times and notes.
 * An event that now has an `endTime` is posted to the GL again
 * (`post-production-event` posts the difference from what it posted before);
 * when that is skipped or fails the update still stands and the reason is
 * returned as `postingError`.
 *
 * @mcp
 */
export const updateProductionEvent = defineServiceFn({
  input: productionEventValidator.safeExtend({ id: z.string() }),
  permission: { update: "production" },

  async run(ctx, { id, ...event }) {
    const update = await service.upsertProductionEvent(ctx.asCaller.supabase, {
      id,
      ...event,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update production event",
        update.error
      );
    }

    const postingError = event.endTime
      ? await service.postEndedEvent(ctx, id)
      : null;
    return { id, postingError };
  }
});
const jobIdsInput = z.array(z.string()).min(1);

/**
 * Delete jobs.
 *
 * @remarks
 * Refused, with nothing deleted, when any of the jobs is locked (Completed,
 * Closed or Cancelled). The jobs' methods, materials and operations go with
 * them.
 *
 * @mcp destructive
 */
export const deleteJobs = defineServiceFn({
  input: z.object({ ids: jobIdsInput }),
  permission: { delete: "production" },

  async run(ctx, { ids }) {
    const jobs = await service.readUnlockedJobs(ctx, ids);
    if (jobs instanceof CarbonError) return jobs;
    const deleted = await ctx.asCaller.supabase
      .from("job")
      .delete()
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (deleted.error) {
      return ctx.error("internal", deleted.error.message, deleted.error);
    }
    return { ids };
  }
});

/**
 * Change the item jobs make.
 *
 * @remarks
 * Refused when any job is locked, and for a Make to Asset job when the new
 * item cannot complete to the asset (`makeToAssetItemError`, judged at the
 * item's lot size when it has one). Then each job takes the item's unit of
 * measure and model, its lot size as the quantity (when it has one) and the
 * scrap that lot size allows; its root method is re-pulled from the item
 * (`itemToJob`) and its requirements are recalculated in the background.
 *
 * @mcp
 */
export const setJobItem = defineServiceFn({
  input: z.object({ ids: jobIdsInput, itemId: z.string() }),
  permission: { update: "production" },

  async run(ctx, { ids, itemId }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const client = ctx.asCaller.supabase;
    const jobs = await service.readUnlockedJobs(ctx, ids);
    if (jobs instanceof CarbonError) return jobs;

    const [item, manufacturing] = await Promise.all([
      client
        .from("item")
        .select("unitOfMeasureCode, modelUploadId, itemTrackingType")
        .eq("id", itemId)
        .eq("companyId", companyId)
        .maybeSingle(),
      client
        .from("itemReplenishment")
        .select("lotSize, scrapPercentage")
        .eq("itemId", itemId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (item.error) {
      return ctx.error("internal", "Failed to read the item", item.error);
    }
    if (!item.data) return ctx.error("notFound", "Item not found");

    const lotSize = manufacturing.data?.lotSize ?? 0;
    for (const job of jobs) {
      const itemError = makeToAssetItemError({
        ...job,
        itemTrackingType: item.data.itemTrackingType,
        quantity: lotSize === 0 ? job.quantity : lotSize
      });
      if (itemError) return ctx.error("rule", itemError);
    }

    const updatedAt = datetime.timestamp();
    const [itemUpdate, makeMethodUpdate] = await Promise.all([
      client
        .from("job")
        .update({
          itemId,
          unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
          quantity: lotSize === 0 ? undefined : lotSize,
          modelUploadId: item.data.modelUploadId ?? null,
          scrapQuantity: scrapAllowance(
            lotSize,
            manufacturing.data?.scrapPercentage ?? 0
          ),
          updatedBy: userId,
          updatedAt
        })
        .in("id", ids)
        .eq("companyId", companyId),
      client
        .from("jobMakeMethod")
        .update({ itemId, updatedBy: userId, updatedAt })
        .in("jobId", ids)
        .is("parentMaterialId", null)
        .eq("companyId", companyId)
    ]);
    const failed = itemUpdate.error ?? makeMethodUpdate.error;
    if (failed) return ctx.error("internal", failed.message, failed);

    for (const id of ids) {
      const method = await service.upsertJobMethod(
        ctx.asSystem.supabase,
        ctx.asSystem.pg,
        "itemToJob",
        { sourceId: itemId, targetId: id, companyId, userId }
      );
      if (method.error) {
        logger.error("Failed to pull the new item's method onto a job", {
          companyId,
          jobId: id,
          error: method.error
        });
      }
      await trigger("recalculate", {
        type: "jobRequirements",
        id,
        companyId,
        userId
      });
    }
    return { ids };
  }
});

/**
 * Change jobs' due date or deadline type.
 *
 * @remarks
 * Refused when any job is locked. Each job's priority is recalculated among
 * the jobs at its location on the new date (`nextJobPriority`), in one read
 * and one write for every job. A field left out keeps the job's current
 * value; a `dueDate` of null clears it.
 *
 * @mcp
 */
export const setJobDeadline = defineServiceFn({
  input: z.object({
    ids: jobIdsInput,
    dueDate: z.string().nullable().optional(),
    deadlineType: z.enum(deadlineTypes).optional()
  }),
  permission: { update: "production" },

  async run(ctx, { ids, dueDate, deadlineType }) {
    const companyId = ctx.company.id;
    const jobs = await service.readUnlockedJobs(ctx, ids);
    if (jobs instanceof CarbonError) return jobs;
    if (jobs.length === 0) return { ids };

    const moves = jobs.map((job) => ({
      id: job.id,
      locationId: job.locationId,
      dueDate: dueDate !== undefined ? dueDate || null : job.dueDate,
      deadlineType: deadlineType ?? job.deadlineType
    }));

    // The jobs already on each new date at each location, in one read: a
    // moved job is ranked among them, then joins them for the next.
    const siblings = await ctx.asSystem.pg
      .selectFrom("job")
      .select(["locationId", "dueDate", "priority", "deadlineType"])
      .where("companyId", "=", companyId)
      .where(
        "locationId",
        "in",
        moves.map((move) => move.locationId)
      )
      .where((eb) => {
        const dates = moves.flatMap((move) =>
          move.dueDate ? [move.dueDate] : []
        );
        return eb.or([
          ...(dates.length > 0 ? [eb("dueDate", "in", dates)] : []),
          ...(moves.some((move) => !move.dueDate)
            ? [eb("dueDate", "is", null)]
            : [])
        ]);
      })
      .where(
        "id",
        "not in",
        moves.map((move) => move.id)
      )
      .orderBy("priority", "asc")
      .execute();
    const key = (locationId: string, date: string | null) =>
      `${locationId}\u001f${date ?? ""}`;
    const ranked = groupBy(siblings, (row) => key(row.locationId, row.dueDate));

    const values = moves.map((move) => {
      const onDate = (ranked[key(move.locationId, move.dueDate)] ??= []);
      const priority = service.nextJobPriority(onDate, move.deadlineType);
      onDate.push({ ...move, priority });
      onDate.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      return sql`(${move.id}, ${move.dueDate}, ${move.deadlineType}, ${priority})`;
    });

    await sql`
      UPDATE "job" AS j
      SET "dueDate" = v."dueDate"::date,
          "deadlineType" = v."deadlineType"::"deadlineType",
          "priority" = v."priority"::numeric,
          "updatedBy" = ${ctx.auditUserId},
          "updatedAt" = ${datetime.timestamp()}
      FROM (VALUES ${sql.join(values)}) AS v("id", "dueDate", "deadlineType", "priority")
      WHERE j."id" = v."id"
        AND j."companyId" = ${companyId}
        AND j."status" NOT IN (${sql.join(JOB_LOCKED_STATUSES.map((status) => sql`${status}`))})
    `.execute(ctx.asSystem.pg);
    return { ids };
  }
});

/**
 * Change jobs' quantity or scrap quantity.
 *
 * @remarks
 * Refused when any job is locked. After the write, each job's requirements
 * are recalculated; the first failure stops there and is returned.
 *
 * @mcp
 */
export const setJobQuantity = defineServiceFn({
  input: z.object({
    ids: jobIdsInput,
    quantity: z.number().min(0).optional(),
    scrapQuantity: z.number().min(0).optional()
  }),
  permission: { update: "production" },

  async run(ctx, { ids, quantity, scrapQuantity }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const jobs = await service.readUnlockedJobs(ctx, ids);
    if (jobs instanceof CarbonError) return jobs;

    const update = await ctx.asCaller.supabase
      .from("job")
      .update({
        ...(quantity !== undefined && { quantity }),
        ...(scrapQuantity !== undefined && { scrapQuantity }),
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", update.error.message, update.error);
    }

    for (const id of ids) {
      const recalc = await service.recalculateJobRequirements(
        ctx.asSystem.supabase,
        ctx.asSystem.pg,
        { id, companyId, userId }
      );
      if (recalc.error) {
        return ctx.error(
          "internal",
          "Failed to recalculate job requirements",
          recalc.error
        );
      }
    }
    return { ids };
  }
});

/**
 * Link jobs to a sales order line, or unlink them.
 *
 * @remarks
 * Refused when any job is locked. A line links the jobs to its order and its
 * order's customer; a line of a completed or cancelled order is refused.
 * `null` clears the order and line and leaves the customer.
 *
 * @mcp
 */
export const setJobSalesOrderLine = defineServiceFn({
  input: z.object({
    ids: jobIdsInput,
    salesOrderLineId: z.string().nullable()
  }),
  permission: { update: "production" },

  async run(ctx, { ids, salesOrderLineId }) {
    const companyId = ctx.company.id;
    const client = ctx.asCaller.supabase;
    const jobs = await service.readUnlockedJobs(ctx, ids);
    if (jobs instanceof CarbonError) return jobs;

    let link = { salesOrderId: null, salesOrderLineId: null } as {
      salesOrderId: string | null;
      salesOrderLineId: string | null;
      customerId?: string | null;
    };
    if (salesOrderLineId) {
      const line = await client
        .from("salesOrderLine")
        .select("id, salesOrderId, salesOrder(customerId, status)")
        .eq("id", salesOrderLineId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (line.error || !line.data) {
        return ctx.error("notFound", "Sales order line not found", line.error);
      }
      if (isSalesOrderClosed(line.data.salesOrder?.status)) {
        return ctx.error(
          "rule",
          "Cannot link a job to a completed or cancelled sales order"
        );
      }
      link = {
        salesOrderId: line.data.salesOrderId,
        salesOrderLineId: line.data.id,
        customerId: line.data.salesOrder?.customerId ?? null
      };
    }

    const update = await client
      .from("job")
      .update({
        ...link,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", companyId);
    if (update.error) {
      return ctx.error("internal", update.error.message, update.error);
    }
    return { ids };
  }
});

/**
 * Change jobs' plain fields: customer, job number, location, storage unit,
 * start date or unit of measure.
 *
 * @remarks
 * Refused when any job is locked. A field left out is unchanged; null clears
 * it. Nothing is recalculated or rescheduled.
 *
 * @mcp
 */
export const setJobFields = defineServiceFn({
  input: z.object({
    ids: jobIdsInput,
    customerId: z.string().nullable().optional(),
    jobId: z.string().nullable().optional(),
    locationId: z.string().nullable().optional(),
    storageUnitId: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    unitOfMeasureCode: z.string().nullable().optional()
  }),
  permission: { update: "production" },

  async run(ctx, { ids, ...fields }) {
    const jobs = await service.readUnlockedJobs(ctx, ids);
    if (jobs instanceof CarbonError) return jobs;

    const update = await ctx.asCaller.supabase
      .from("job")
      .update(
        unchecked({
          ...Object.fromEntries(
            Object.entries(fields)
              .filter(([, value]) => value !== undefined)
              .map(([field, value]) => [field, value || null])
          ),
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error("internal", update.error.message, update.error);
    }
    return { ids };
  }
});

/** The `custom-*` fields of a form, by field id (`setCustomFields`). */
const customFieldsInput = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional();

/**
 * Save a job's details: item, quantities, dates, deadline, location, unit of
 * measure, customer, model and Make to Asset target.
 *
 * @remarks
 * Refused when the job is locked. The asset class or asset must be this
 * company's, and the item must be able to complete to it
 * (`makeToAssetItemError`). A changed date or deadline type re-ranks the job's
 * priority. Then the job's requirements are recalculated; a failure there is
 * returned after the details are saved.
 *
 * @mcp
 */
export const updateJobDetails = defineServiceFn({
  input: jobValidator.safeExtend({
    id: z.string(),
    customFields: customFieldsInput
  }),
  permission: { update: "production" },

  async run(ctx, { id, customFields, ...job }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const jobs = await service.readUnlockedJobs(ctx, [id]);
    if (jobs instanceof CarbonError) return jobs;
    if (jobs.length === 0) return ctx.error("notFound", "Job not found");

    const owned = await service.requireOwnRecords(ctx, [
      ["fixedAssetClass", job.fixedAssetClassId, "fixed asset class"],
      ["fixedAsset", job.fixedAssetId, "fixed asset"]
    ]);
    if (owned) return owned;

    if (job.fixedAssetClassId || job.fixedAssetId) {
      const item = await ctx.asCaller.supabase
        .from("item")
        .select("itemTrackingType")
        .eq("id", job.itemId)
        .eq("companyId", companyId)
        .maybeSingle();
      const itemError = makeToAssetItemError({
        ...job,
        itemTrackingType: item.data?.itemTrackingType
      });
      if (itemError) return ctx.error("rule", itemError);
    }

    const result = await service.updateJob(ctx.asCaller.supabase, {
      id,
      companyId,
      quantity: job.quantity,
      scrapQuantity: job.scrapQuantity,
      itemId: job.itemId,
      dueDate: job.dueDate || null,
      startDate: job.startDate || null,
      deadlineType: job.deadlineType,
      locationId: job.locationId,
      unitOfMeasureCode: job.unitOfMeasureCode,
      customerId: job.customerId || null,
      modelUploadId: job.modelUploadId || null,
      fixedAssetClassId: job.fixedAssetClassId || null,
      fixedAssetId: job.fixedAssetId || null,
      ...(customFields && { customFields }),
      updatedBy: userId
    });
    if (result.error) {
      return ctx.error("internal", "Failed to update job", result.error);
    }

    const recalculate = await service.recalculateJobRequirements(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      { id, companyId, userId }
    );
    if (recalculate.error) {
      return ctx.error(
        "internal",
        "Failed to recalculate job requirements",
        recalculate.error
      );
    }
    return { id };
  }
});

/**
 * Configure a job: save its configuration and rebuild its method from it.
 *
 * @remarks
 * Saves `configuration` on the job, re-pulls the root method from the job's
 * item with that configuration (`itemToJob`), and recalculates the job's
 * requirements in the background.
 *
 * @mcp
 */
export const configureJob = defineServiceFn({
  input: z.object({
    jobId: z.string(),
    configuration: z.record(z.string(), z.unknown())
  }),
  permission: { update: "production" },

  async run(ctx, { jobId, configuration }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const client = ctx.asCaller.supabase;
    const unlocked = await service.requireJob(ctx, jobId);
    if (unlocked instanceof CarbonError) return unlocked;
    const [result, job] = await Promise.all([
      client
        .from("job")
        .update({
          configuration: configuration as Json,
          updatedAt: datetime.timestamp(),
          updatedBy: userId
        })
        .eq("id", jobId)
        .eq("companyId", companyId),
      client
        .from("job")
        .select("itemId")
        .eq("id", jobId)
        .eq("companyId", companyId)
        .maybeSingle()
    ]);
    if (result.error) {
      return ctx.error("internal", "Failed to update job", result.error);
    }
    if (job.error) return ctx.error("internal", "Failed to get job", job.error);
    if (!job.data) return ctx.error("notFound", "Job not found");

    const method = await service.upsertJobMethod(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      "itemToJob",
      {
        sourceId: job.data.itemId,
        targetId: jobId,
        companyId,
        userId,
        configuration
      }
    );
    if (method.error) {
      return ctx.error("internal", "Failed to update job method", method.error);
    }

    await trigger("recalculate", {
      type: "jobRequirements",
      id: jobId,
      companyId,
      userId
    });
    return { jobId };
  }
});
/**
 * Create several jobs for one item, splitting a total quantity.
 *
 * @remarks
 * `totalQuantity` is split into jobs of `quantityPerJob`, the last taking the
 * remainder. With both due dates, the jobs' due dates are spread between them
 * (`spreadDueDates`); with only the first, every job is due then. The item,
 * location, customer and model must be this company's. Every job takes the
 * item's default storage unit at the location and its method; their
 * requirements are recalculated in the background. It stops at the first job
 * that cannot be created; the jobs before it stay.
 *
 * @mcp
 */
export const createJobs = defineServiceFn({
  input: bulkJobValidator.extend({ customFields: customFieldsInput }),
  permission: { create: "production" },

  async run(ctx, input) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const {
      dueDateOfFirstJob,
      dueDateOfLastJob,
      totalQuantity,
      quantityPerJob,
      configuration: configStr,
      ...job
    } = input;

    const configuration = service.parseConfiguration(configStr);

    const refusal = await jobCreationRefusal(ctx, job);
    if (refusal) return refusal;

    const jobs = Math.ceil(totalQuantity / quantityPerJob);
    const quantityOfLastJob = totalQuantity - (jobs - 1) * quantityPerJob;
    const dueDates = service.spreadDueDates(
      jobs,
      dueDateOfFirstJob,
      dueDateOfLastJob
    );
    const storageUnitId = await getDefaultStorageUnitForJob(
      ctx.asSystem.supabase,
      job.itemId,
      job.locationId,
      companyId
    );

    const jobIds: string[] = [];
    let failed: unknown = null;
    for (let i = 0; i < jobs; i++) {
      const created = await service.insertJob(
        ctx.asSystem.supabase,
        ctx.asSystem.pg,
        {
          ...job,
          quantity: i === jobs - 1 ? quantityOfLastJob : quantityPerJob,
          dueDate: dueDates[i]?.split("T")[0],
          storageUnitId: storageUnitId ?? undefined,
          configuration,
          companyId,
          createdBy: userId
        },
        { skipRecalculate: true, source: "bulk" }
      );
      if (created.error || !created.data) {
        failed = created.error ?? new Error("No job was returned");
        break;
      }
      jobIds.push(created.data.id);
    }

    // The jobs created before a failure stay, so they are recalculated too.
    if (jobIds.length > 0) {
      await batchTrigger(
        "recalculate",
        jobIds.map((id) => ({
          payload: { type: "jobRequirements", id, companyId, userId }
        }))
      );
    }
    if (failed) return ctx.error("internal", "Failed to insert job", failed);
    return { jobIds };
  }
});

/**
 * Create a job.
 *
 * @remarks
 * The item, location, customer, model, and fixed-asset class or asset must be
 * this company's. Refused for an item an unreleased change notice holds (the
 * job would take its draft method) and for a Make to Asset job whose item
 * cannot complete to an asset. The job takes the item's method and its
 * requirements are calculated.
 *
 * @mcp
 */
export const createJob = defineServiceFn({
  input: jobValidator.safeExtend({ customFields: customFieldsInput }),
  permission: { create: "production" },

  async run(ctx, { id: _id, configuration: configStr, ...job }) {
    const companyId = ctx.company.id;

    const configuration = service.parseConfiguration(configStr);

    const refusal = await jobCreationRefusal(ctx, job);
    if (refusal) return refusal;

    const created = await service.insertJob(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        ...job,
        jobId: job.jobId || undefined,
        fixedAssetClassId: job.fixedAssetClassId || null,
        fixedAssetId: job.fixedAssetId || null,
        configuration,
        companyId,
        createdBy: ctx.auditUserId
      },
      { source: "erp" }
    );
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to insert job", created.error);
    }
    return { jobId: created.data.id };
  }
});

/** Which parts of a method a Get Method copies. */
const methodPartsInput = z.object({
  billOfMaterial: z.boolean(),
  billOfProcess: z.boolean(),
  parameters: z.boolean(),
  tools: z.boolean(),
  steps: z.boolean(),
  workInstructions: z.boolean()
});
/**
 * Overwrite a job's method with another: an item's make method, a quote
 * line's method, or another job's.
 *
 * @remarks
 * Copies the chosen parts (bill of material, bill of process and, with it,
 * parameters, tools, steps and work instructions) of `sourceId` onto job
 * `targetId`, using the item's make method version `versionId` when given and
 * `configuration` for a configurable item. Then the job's requirements and
 * operation dependencies are recalculated.
 *
 * @mcp
 */
export const copyMethodToJob = defineServiceFn({
  input: z.object({
    type: z.enum(["item", "quoteLine", "job"]),
    sourceId: z.string(),
    targetId: z.string(),
    versionId: z.string().optional(),
    parts: methodPartsInput,
    configuration: z.record(z.string(), z.unknown()).optional()
  }),
  permission: { update: "production" },

  async run(ctx, { type, configuration, ...method }) {
    const job = await service.requireJob(ctx, method.targetId);
    if (job instanceof CarbonError) return job;

    const copied = await service.upsertJobMethod(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      type === "item"
        ? "itemToJob"
        : type === "job"
          ? "jobToJob"
          : "quoteLineToJob",
      {
        ...method,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        ...(type === "item" && configuration && { configuration })
      }
    );
    if (copied.error) {
      return ctx.error(
        "internal",
        copied.error.message ?? "Failed to get job method",
        copied.error
      );
    }

    const recalculated = await service.recalculateJob(ctx, method.targetId);
    if (recalculated) return recalculated;
    return { jobId: method.targetId };
  }
});

/**
 * Overwrite a made sub-assembly's method on a job with an item's make method.
 *
 * @remarks
 * `targetId` is the job material's make method. Copies the chosen parts of
 * item `sourceId`'s make method (version `versionId` when given, with
 * `configuration` for a configurable item) into it.
 *
 * @mcp
 */
export const copyMethodToMaterial = defineServiceFn({
  input: z.object({
    sourceId: z.string(),
    targetId: z.string(),
    versionId: z.string().optional(),
    parts: methodPartsInput,
    configuration: z.record(z.string(), z.unknown()).optional()
  }),
  permission: { update: "production" },

  async run(ctx, method) {
    const target = await ctx.asCaller.supabase
      .from("jobMakeMethod")
      .select("jobId")
      .eq("id", method.targetId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (target.error) {
      return ctx.error("internal", "Failed to read the method", target.error);
    }
    if (!target.data) return ctx.error("notFound", "Make method not found");
    const job = await service.requireJob(ctx, target.data.jobId);
    if (job instanceof CarbonError) return job;

    const copied = await service.upsertJobMaterialMakeMethod(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      { ...method, companyId: ctx.company.id, userId: ctx.auditUserId }
    );
    if (copied.error) {
      return ctx.error(
        "internal",
        copied.error.message ?? "Failed to update method from job method",
        copied.error
      );
    }
    return { jobMakeMethodId: method.targetId };
  }
});

/** A job material as JSON: `jobMaterialValidator`'s parsed shape. */
const jobMaterialInput = z.object({
  jobId: z.string(),
  jobMakeMethodId: z.string(),
  jobOperationId: z.string().optional(),
  itemId: z.string(),
  itemType: z.enum(methodItemType),
  methodType: z.enum(methodType),
  description: z.string(),
  kit: z.boolean(),
  order: z.number().min(0),
  quantity: z.number().min(0),
  requiresBatchTracking: z.boolean(),
  requiresSerialTracking: z.boolean(),
  unitCost: z.number().min(0),
  unitOfMeasureCode: z.string(),
  storageUnitId: z.string().optional(),
  customFields: customFieldsInput
});

/**
 * Add a material to a job's method.
 *
 * @remarks
 * The make method, and the operation when one is given, must be this job's.
 * A Make to Order material pulls its item's method into its own make method.
 * When the job is already released (not Draft or Planned), the method's
 * requirements and the job's operation dependencies are recalculated; a
 * Draft or Planned job's estimates fill in at release.
 *
 * @mcp
 */
export const createJobMaterial = defineServiceFn({
  // The caller chooses the row's id (the bill of material's new row keeps it).
  input: jobMaterialInput.extend({ id: z.string() }),
  permission: { create: "production" },

  async run(ctx, material) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const system = ctx.asSystem.supabase;
    const [job, parents] = await Promise.all([
      service.requireJob(ctx, material.jobId),
      service.requireJobChildren(ctx, material.jobId, {
        jobMakeMethodId: material.jobMakeMethodId,
        jobOperationId: material.jobOperationId
      })
    ]);
    if (job instanceof CarbonError) return job;
    if (parents) return parents;

    const insert = await service.upsertJobMaterial(system, {
      ...material,
      companyId,
      createdBy: userId
    });
    if (insert.error || !insert.data?.id) {
      return ctx.error(
        "internal",
        "Failed to insert job material",
        insert.error
      );
    }
    const id = insert.data.id;

    if (material.methodType === "Make to Order") {
      const pulled = await service.pullJobMaterialMakeMethod(
        system,
        ctx.asSystem.pg,
        {
          jobMaterialId: id,
          itemId: material.itemId,
          companyId,
          userId
        }
      );
      if (pulled.error) {
        return ctx.error(
          "internal",
          "Failed to insert job material make method",
          pulled.error
        );
      }
    }

    if (!["Draft", "Planned"].includes(job.status ?? "")) {
      const recalculated = await service.recalculateMaterialMethod(ctx, {
        jobId: material.jobId,
        jobMakeMethodId: material.jobMakeMethodId,
        dependencies: true
      });
      if (recalculated) return recalculated;
    }
    return { id };
  }
});

/**
 * Update a material of a job's method.
 *
 * @remarks
 * The material must be on this job and make method, and the operation, when
 * given, on this job; the material never moves to another job or method.
 * Changing it INTO Make to Order pulls its item's method (a material that was
 * already Make to Order keeps its edited method). Then the method's
 * requirements are recalculated, and for a Make to Order material on an
 * operation the job's operation dependencies too.
 *
 * @mcp
 */
export const updateJobMaterial = defineServiceFn({
  input: jobMaterialInput.extend({ id: z.string() }),
  permission: { create: "production" },

  async run(ctx, { id, ...material }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const system = ctx.asSystem.supabase;
    const job = await service.requireJob(ctx, material.jobId);
    if (job instanceof CarbonError) return job;
    const [existing, parents] = await Promise.all([
      system
        .from("jobMaterial")
        .select("methodType")
        .eq("id", id)
        .eq("jobId", material.jobId)
        .eq("jobMakeMethodId", material.jobMakeMethodId)
        .eq("companyId", companyId)
        .maybeSingle(),
      service.requireJobChildren(ctx, material.jobId, {
        jobOperationId: material.jobOperationId
      })
    ]);
    if (existing.error) {
      return ctx.error(
        "internal",
        "Failed to load job material",
        existing.error
      );
    }
    if (!existing.data) return ctx.error("notFound", "Job material not found");
    if (parents) return parents;
    const wasMakeToOrder = existing.data.methodType === "Make to Order";

    const update = await service.upsertJobMaterial(system, {
      ...material,
      id,
      companyId,
      updatedBy: userId
    });
    if (update.error || !update.data?.id) {
      return ctx.error(
        "internal",
        "Failed to update job material",
        update.error
      );
    }

    const makeToOrder = material.methodType === "Make to Order";
    if (makeToOrder && !wasMakeToOrder) {
      const pulled = await service.pullJobMaterialMakeMethod(
        system,
        ctx.asSystem.pg,
        {
          jobMaterialId: id,
          itemId: material.itemId,
          companyId,
          userId
        }
      );
      if (pulled.error) {
        return ctx.error(
          "internal",
          "Failed to insert job material make method",
          pulled.error
        );
      }
    }

    const recalculated = await service.recalculateMaterialMethod(ctx, {
      jobId: material.jobId,
      jobMakeMethodId: material.jobMakeMethodId,
      dependencies: makeToOrder && !!material.jobOperationId
    });
    if (recalculated) return recalculated;
    return { id, methodType: update.data.methodType };
  }
});
/**
 * Remove a material from a job's method.
 *
 * @remarks
 * Deletes the material (a Make to Order material's make method goes with
 * it), then recalculates the job's operation dependencies.
 *
 * @mcp destructive
 */
export const deleteJobMaterial = defineServiceFn({
  input: z.object({ jobId: z.string(), id: z.string() }),
  permission: { delete: "production" },

  async run(ctx, { jobId, id }) {
    const job = await service.requireJob(ctx, jobId);
    if (job instanceof CarbonError) return job;
    const deleted = await ctx.asCaller.supabase
      .from("jobMaterial")
      .delete()
      .eq("id", id)
      .eq("jobId", jobId)
      .eq("companyId", ctx.company.id);
    if (deleted.error) {
      return ctx.error(
        "internal",
        "Failed to delete job material",
        deleted.error
      );
    }
    const recalculated = await service.recalculateJob(ctx, jobId, {
      requirements: false
    });
    if (recalculated) return recalculated;
    return { id };
  }
});

/**
 * Remove several materials from a job's methods.
 *
 * @remarks
 * The bill of material's Delete Selected: `deleteJobMaterial` for many rows,
 * with the job's operation dependencies recalculated once.
 */
export const deleteJobMaterials = defineServiceFn({
  input: z.object({ jobId: z.string(), ids: z.array(z.string()).min(1) }),
  permission: { delete: "production" },

  async run(ctx, { jobId, ids }) {
    const job = await service.requireJob(ctx, jobId);
    if (job instanceof CarbonError) return job;
    const deleted = await ctx.asCaller.supabase
      .from("jobMaterial")
      .delete()
      .in("id", ids)
      .eq("jobId", jobId)
      .eq("companyId", ctx.company.id);
    if (deleted.error) {
      return ctx.error(
        "internal",
        "Failed to delete job materials",
        deleted.error
      );
    }
    const recalculated = await service.recalculateJob(ctx, jobId, {
      requirements: false
    });
    if (recalculated) return recalculated;
    return { ids };
  }
});

/**
 * Add an operation to a job's method.
 *
 * @remarks
 * The make method must be this job's. Then the method's requirements and the
 * job's operation dependencies are recalculated.
 *
 * @mcp
 */
export const createJobOperation = defineServiceFn({
  input: jobOperationValidator.extend({
    jobId: z.string(),
    customFields: customFieldsInput
  }),
  permission: { create: "production" },

  async run(ctx, operation) {
    const job = await service.requireJob(ctx, operation.jobId);
    if (job instanceof CarbonError) return job;
    const parents = await service.requireJobChildren(ctx, operation.jobId, {
      jobMakeMethodId: operation.jobMakeMethodId
    });
    if (parents) return parents;

    const insert = await service.upsertJobOperation(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      { ...operation, companyId: ctx.company.id, createdBy: ctx.auditUserId }
    );
    if (insert.error || !insert.data?.id) {
      return ctx.error(
        "internal",
        "Failed to insert job operation",
        insert.error
      );
    }

    const recalculated = await service.recalculateMaterialMethod(ctx, {
      jobId: operation.jobId,
      jobMakeMethodId: operation.jobMakeMethodId,
      dependencies: true
    });
    if (recalculated) return recalculated;
    return { id: insert.data.id };
  }
});

/**
 * Update an operation of a job's method.
 *
 * @remarks
 * Writes the operation's process, type, times, rates, work center, outside
 * processing costs and links; it never moves to another job or method.
 * Nothing is recalculated.
 *
 * @mcp
 */
export const updateJobOperation = defineServiceFn({
  input: jobOperationValidator.extend({
    jobId: z.string(),
    customFields: customFieldsInput
  }),
  permission: { create: "production" },

  async run(ctx, operation) {
    const job = await service.requireJob(ctx, operation.jobId);
    if (job instanceof CarbonError) return job;
    const update = await service.upsertJobOperation(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      { ...operation, companyId: ctx.company.id, updatedBy: ctx.auditUserId }
    );
    if (update.error || !update.data?.id) {
      return ctx.error(
        "internal",
        "Failed to update job operation",
        update.error
      );
    }
    return { id: update.data.id };
  }
});

/**
 * Set the work instruction of a job operation.
 *
 * @remarks
 * Replaces the operation's work instruction; the rest of the operation is
 * unchanged. Refused while the job is locked (completed or cancelled), as
 * the job's editor is.
 *
 * @param id - The job operation's id.
 * @param text - The work instruction as plain text: each line is a paragraph,
 *   `**text**` is bold. Empty text clears it.
 *
 * @mcp
 */
export const setJobOperationWorkInstruction = defineServiceFn({
  input: z.object({ id: z.string().min(1), text: z.string() }),
  permission: { update: "production" },

  async run(ctx, { id, text }) {
    const operation = await ctx.asCaller.supabase
      .from("jobOperation")
      .select("jobId")
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (operation.error) {
      return ctx.error(
        "internal",
        "Failed to read the job operation",
        operation.error
      );
    }
    if (!operation.data) return ctx.error("notFound", "Operation not found");
    const job = await service.requireJob(ctx, operation.data.jobId);
    if (job instanceof CarbonError) return job;
    return setOperationWorkInstruction(ctx, "jobOperation", id, text);
  }
});

/**
 * Remove an operation from a job's method.
 *
 * @remarks
 * Refused when production events are recorded against the operation. Then
 * the job's operation dependencies are recalculated.
 *
 * @mcp destructive
 */
export const deleteJobOperation = defineServiceFn({
  input: z.object({ jobId: z.string(), id: z.string() }),
  permission: { delete: "production" },

  async run(ctx, { jobId, id }) {
    const job = await service.requireJob(ctx, jobId);
    if (job instanceof CarbonError) return job;
    const client = ctx.asCaller.supabase;
    const events = await client
      .from("productionEvent")
      .select("id", { count: "exact", head: true })
      .eq("jobOperationId", id)
      .eq("companyId", ctx.company.id);
    if (events.error) {
      return ctx.error(
        "internal",
        "Failed to check for recorded production events",
        events.error
      );
    }
    if ((events.count ?? 0) > 0) {
      return ctx.error(
        "rule",
        "Cannot delete an operation that has recorded production events"
      );
    }

    const deleted = await client
      .from("jobOperation")
      .delete()
      .eq("id", id)
      .eq("jobId", jobId)
      .eq("companyId", ctx.company.id);
    if (deleted.error) {
      return ctx.error("internal", deleted.error.message, deleted.error);
    }
    const recalculated = await service.recalculateJob(ctx, jobId, {
      requirements: false
    });
    if (recalculated) return recalculated;
    return { id };
  }
});

/**
 * Remove several operations from a job's methods.
 *
 * @remarks
 * The bill of process's Delete Selected: `deleteJobOperation` for many rows.
 * Refused when any of them has recorded production events; the job's
 * operation dependencies are recalculated once.
 */
export const deleteJobOperations = defineServiceFn({
  input: z.object({ jobId: z.string(), ids: z.array(z.string()).min(1) }),
  permission: { delete: "production" },

  async run(ctx, { jobId, ids }) {
    const job = await service.requireJob(ctx, jobId);
    if (job instanceof CarbonError) return job;
    const client = ctx.asCaller.supabase;
    const events = await client
      .from("productionEvent")
      .select("id", { count: "exact", head: true })
      .in("jobOperationId", ids)
      .eq("companyId", ctx.company.id);
    if (events.error) {
      return ctx.error(
        "internal",
        "Failed to check for recorded production events",
        events.error
      );
    }
    if ((events.count ?? 0) > 0) {
      return ctx.error(
        "rule",
        "Cannot delete an operation that has recorded production events"
      );
    }

    const deleted = await client
      .from("jobOperation")
      .delete()
      .in("id", ids)
      .eq("jobId", jobId)
      .eq("companyId", ctx.company.id);
    if (deleted.error) {
      return ctx.error("internal", deleted.error.message, deleted.error);
    }
    const recalculated = await service.recalculateJob(ctx, jobId, {
      requirements: false
    });
    if (recalculated) return recalculated;
    return { ids };
  }
});

/**
 * Reorder a job's operations.
 *
 * @remarks
 * `orders` maps an operation id to its new order. All or nothing: an id that
 * is not one of the job's operations refuses the whole reorder. Then the
 * job's operation dependencies are recalculated.
 *
 * @mcp
 */
export const reorderJobOperations = defineServiceFn({
  input: z.object({
    jobId: z.string(),
    orders: z.record(z.string(), z.number())
  }),
  permission: { update: "production" },

  async run(ctx, { jobId, orders }) {
    const job = await service.requireJob(ctx, jobId);
    if (job instanceof CarbonError) return job;
    try {
      await service.updateJobOperationOrder(
        ctx.asSystem.pg,
        ctx.company.id,
        ctx.auditUserId,
        jobId,
        Object.entries(orders).map(([id, sortOrder]) => ({ id, sortOrder }))
      );
    } catch (err) {
      return ctx.error("internal", "Failed to update sort order", err);
    }
    const recalculated = await service.recalculateJob(ctx, jobId, {
      requirements: false
    });
    if (recalculated) {
      return ctx.error(
        "internal",
        "Failed to recalculate dependencies",
        recalculated.cause
      );
    }
    return { jobId };
  }
});

/**
 * Set a job operation's status.
 *
 * @remarks
 * Marking it Done may complete the job (a database trigger), so the picked
 * material the operation (or the job) did not consume is then returned to the
 * warehouse; a failure there leaves the status changed and is returned as
 * `warning`.
 *
 * @mcp
 */
export const setJobOperationStatus = defineServiceFn({
  input: z.object({ id: z.string(), status: z.enum(jobOperationStatus) }),
  permission: { update: "production" },

  async run(ctx, { id, status }) {
    const update = await ctx.asCaller.supabase
      .from("jobOperation")
      .update({
        status,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .select("id")
      .maybeSingle();
    if (update.error) {
      return ctx.error("internal", "Failed to update status", update.error);
    }
    if (!update.data) return ctx.error("notFound", "Operation not found");

    if (status === "Done") {
      const sweep = await service.returnPickedRemaindersForOperation(
        ctx.asSystem.supabase,
        ctx.asSystem.pg,
        {
          jobOperationId: id,
          userId: ctx.auditUserId,
          companyId: ctx.company.id
        }
      );
      if (sweep.error) {
        logger.error("Returning picked material failed after an operation", {
          companyId: ctx.company.id,
          jobOperationId: id,
          error: sweep.error
        });
        return {
          id,
          warning: "Operation updated, but returning picked material failed"
        };
      }
    }
    return { id, warning: null };
  }
});

/**
 * Report a produced quantity on a job operation, and finish the operation
 * when it reaches its target.
 *
 * @remarks
 * For an operation whose item is not serial or batch tracked; a tracked one is
 * completed per tracked entity at the MES station. In order: the good
 * quantity is recorded (refused on a locked job), the operation's materials
 * are backflushed (`issue`), and when good plus reworked quantity reaches the
 * operation's target it is set Done, which completes the job when it was the
 * last operation. Then its ended production events are posted to the GL and
 * the picked material it did not consume is returned; a failure there is
 * returned as `warning`. A failed backflush leaves the quantity recorded.
 *
 * @mcp
 */
export const completeOperation = defineServiceFn({
  input: z.object({
    operationId: z.string(),
    quantity: z.number().positive()
  }),
  permission: { create: "production", update: "production" },

  async run(ctx, { operationId, quantity }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const operation = await ctx.asCaller.supabase
      .from("jobOperation")
      .select(
        "jobId, quantityComplete, quantityReworked, targetQuantity, operationQuantity, jobMakeMethod(requiresSerialTracking, requiresBatchTracking)"
      )
      .eq("id", operationId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (operation.error) {
      return ctx.error(
        "internal",
        "Failed to read the operation",
        operation.error
      );
    }
    if (!operation.data) return ctx.error("notFound", "Operation not found");
    const method = operation.data.jobMakeMethod;
    if (method?.requiresSerialTracking || method?.requiresBatchTracking) {
      return ctx.error(
        "rule",
        "This operation's item is serial or batch tracked: complete it per tracked entity at the MES station"
      );
    }

    const recorded = await createProductionQuantity(ctx, {
      jobOperationId: operationId,
      type: "Production",
      quantity
    });
    if (recorded.error) return recorded.error;

    const issued = await invokePosting(
      ctx,
      "issue",
      { type: "jobOperation", id: operationId, quantity },
      issueMaterial
    );
    if (issued.error) {
      return ctx.error(
        "internal",
        "The quantity is recorded, but its materials were not issued",
        issued.error
      );
    }

    // Scrap is left out, as the database's own completion check leaves it.
    const accounted =
      Number(operation.data.quantityComplete ?? 0) +
      Number(operation.data.quantityReworked ?? 0) +
      quantity;
    const target = Number(
      operation.data.targetQuantity ?? operation.data.operationQuantity ?? 0
    );
    if (accounted < target) return { operationId, done: false, warning: null };

    const finished = await ctx.asCaller.supabase
      .from("jobOperation")
      .update({
        status: "Done",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", operationId)
      .eq("companyId", companyId);
    if (finished.error) {
      return ctx.error(
        "internal",
        "The quantity is recorded, but the operation could not be finished",
        finished.error
      );
    }

    const warnings: string[] = [];
    const unposted = await ctx.asSystem.supabase
      .from("productionEvent")
      .select("id")
      .eq("jobOperationId", operationId)
      .eq("companyId", companyId)
      .not("endTime", "is", null)
      .eq("postedToGL", false);
    const postingFailures = unposted.error
      ? [unposted.error.message]
      : (
          await async.map(unposted.data, (event) =>
            service.postEndedEvent(ctx, event.id)
          )
        ).filter((reason) => reason !== null);
    if (postingFailures.length > 0) {
      logger.error("Posting an operation's production events failed", {
        companyId,
        operationId,
        failures: postingFailures
      });
      warnings.push("its time was not posted to the GL");
    }

    const sweep = await service.returnPickedRemaindersForOperation(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      { jobOperationId: operationId, userId, companyId }
    );
    if (sweep.error) {
      logger.error("Returning picked material failed after an operation", {
        companyId,
        operationId,
        error: sweep.error
      });
      warnings.push("its picked material was not returned");
    }

    await raiseMoment("production.jobOperationCompleted", {
      outputs: {
        job: { id: operation.data.jobId },
        jobOperation: { id: operationId },
        completedBy: { id: userId }
      },
      companyId,
      actorId: userId
    });
    trackWorkEvent("job_operation_finished", {
      companyId,
      userId,
      jobOperationId: operationId,
      jobId: operation.data.jobId
    });

    return {
      operationId,
      done: true,
      warning:
        warnings.length > 0
          ? `The operation is done, but ${warnings.join(" and ")}.`
          : null
    };
  }
});

/**
 * Pin a job operation's need-by date, or clear the pin.
 *
 * @remarks
 * A date marks the operation manually scheduled: the scheduler takes it as
 * the operation's need-by and never overwrites it; null hands it back to the
 * scheduler. Then the schedule is regenerated, so the pin propagates to the
 * operations upstream.
 *
 * @mcp
 */
export const setJobOperationDueDate = defineServiceFn({
  input: z.object({ id: z.string(), dueDate: z.string().nullable() }),
  permission: { update: "production" },

  async run(ctx, { id, dueDate }) {
    const update = await ctx.asCaller.supabase
      .from("jobOperation")
      .update({
        dueDate,
        manuallyScheduled: dueDate !== null,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", ctx.company.id)
      .select("id")
      .maybeSingle();
    if (update.error) {
      return ctx.error("internal", "Failed to update due date", update.error);
    }
    if (!update.data) return ctx.error("notFound", "Operation not found");
    await service.notifyScheduleInputsChanged(
      ctx.company.id,
      "reorder",
      "Operation due date pinned"
    );
    return { id };
  }
});

/**
 * Copy a procedure's steps and parameters onto a job operation.
 *
 * @remarks
 * Syncs procedure `procedureId` into operation `operationId`
 * (`get-method` `procedureToOperation`).
 *
 * @mcp
 */
export const syncJobOperationProcedure = defineServiceFn({
  input: z.object({ operationId: z.string(), procedureId: z.string() }),
  permission: { update: "production" },

  async run(ctx, { operationId, procedureId }) {
    const operation = await ctx.asCaller.supabase
      .from("jobOperation")
      .select("jobId")
      .eq("id", operationId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (operation.error) {
      return ctx.error(
        "internal",
        "Failed to read the operation",
        operation.error
      );
    }
    if (!operation.data) return ctx.error("notFound", "Operation not found");
    const job = await service.requireJob(ctx, operation.data.jobId);
    if (job instanceof CarbonError) return job;

    const sync = await invokePosting(
      {
        db: ctx.asSystem.pg,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      },
      "get-method",
      {
        type: "procedureToOperation",
        sourceId: procedureId,
        targetId: operationId
      },
      service.getMethod
    );
    if (sync.error) {
      return ctx.error("internal", "Failed to sync procedure", sync.error);
    }
    return { operationId };
  }
});

/**
 * Move a batch card on the operations board: its place in the dispatch order.
 *
 * @remarks
 * A batch card sits at its earliest member's priority, so every open member
 * takes `priority`. Only the dispatch order changes; nothing is rescheduled.
 * A Completing or Completed batch is read-only ("Batch unavailable").
 *
 * @mcp
 */
export const reprioritizeBatch = defineServiceFn({
  input: z.object({
    batchId: z.string().min(1),
    priority: z.number().refine(Number.isFinite, "Priority must be finite")
  }),
  permission: { update: "production" },

  async run(ctx, { batchId, priority }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const batch = await client
      .from("jobOperationBatch")
      .select("status")
      .eq("id", batchId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (
      batch.error ||
      batch.data === null ||
      batch.data.status === "Completing" ||
      batch.data.status === "Completed"
    ) {
      return ctx.error("rule", "Batch unavailable", batch.error);
    }

    const { error } = await client
      .from("jobOperation")
      .update({
        priority,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .eq("jobOperationBatchId", batchId)
      .eq("companyId", companyId)
      .not("status", "in", "(Done,Canceled)");
    if (error) return ctx.error("internal", error.message, error);
    return { batchId };
  }
});

/**
 * Merge a completed batch's output lots of one item into one lot.
 *
 * @remarks
 * The ERP catch-up for a batch whose completion prompt was skipped. Only a
 * Completed batch qualifies. Its members' Available output lots of `itemId`
 * are read here, never taken from the caller; fewer than two is refused. The
 * merged lot's genealogy keeps every source job (`issue`
 * `mergeTrackedEntities`).
 *
 * @mcp
 */
export const mergeBatchOutputs = defineServiceFn({
  input: z.object({ batchId: z.string().min(1), itemId: z.string() }),
  permission: { update: "production" },

  async run(ctx, { batchId, itemId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const batch = await client
      .from("jobOperationBatch")
      .select("status")
      .eq("id", batchId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (batch.error || batch.data?.status !== "Completed") {
      return ctx.error(
        "rule",
        "Only a completed batch's output lots can be merged",
        batch.error
      );
    }

    const outputs = await service.getBatchOutputLots(
      client,
      batchId,
      companyId
    );
    if (outputs.error) {
      return ctx.error(
        "internal",
        "Failed to load the output lots",
        outputs.error
      );
    }
    const lots = (outputs.data ?? []).filter((lot) => lot.itemId === itemId);
    if (lots.length < 2) return ctx.error("rule", "No mergeable output lots");

    const merge = await mergeTrackedEntities(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        trackedEntityIds: lots.map((lot) => lot.id),
        companyId,
        userId: ctx.auditUserId
      }
    );
    if (merge.error) {
      return ctx.error(
        "internal",
        getErrorMessage(merge.error, "Failed to merge lots"),
        merge.error
      );
    }
    return { readableId: merge.data?.readableId ?? null };
  }
});

/**
 * Create an operation batch, optionally released at once.
 *
 * @remarks
 * Groups open operations of one batchable process at `locationId` into a
 * Planned batch (`batch-operations` `create`: eligibility, the process's
 * material rules and the planned output lots are checked there). With
 * `release`, the operations' Draft / Planned jobs are then released through
 * the job page's checks (`purchaseOrdersBySupplierId` is the release dialog's
 * choice), the batch is put on the floor and the scheduler is told. When the
 * jobs' checks refuse, nothing is released and the batch is taken apart
 * again; any other failure leaves it Planned, to release or dissolve.
 *
 * @mcp
 */
export const createBatch = defineServiceFn({
  input: z.object({
    locationId: z.string().min(1),
    workCenterId: z.string().optional(),
    notes: z.string().optional(),
    release: z.boolean().default(false),
    jobOperationIds: z.array(z.string().min(1)).min(1),
    mergeOutput: z.boolean().default(false),
    outputLotNumber: z.string().optional(),
    lotNumbers: z
      .array(
        z.object({
          jobOperationId: z.string().min(1),
          lotNumber: z.string().trim().min(1)
        })
      )
      .optional(),
    purchaseOrdersBySupplierId: z.record(z.string(), z.string()).optional()
  }),
  permission: { update: "production" },

  async run(ctx, { purchaseOrdersBySupplierId, release, ...batch }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    const result = await service.createJobOperationBatch(
      client,
      ctx.asSystem.pg,
      { ...batch, companyId, userId }
    );
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to create batch"),
        result.error
      );
    }
    const created = result.data as { id?: string; readableId?: string } | null;
    const batchId = created?.id ?? null;

    if (release && batchId) {
      const ops = await client
        .from("jobOperation")
        .select("jobId")
        .in("id", batch.jobOperationIds)
        .eq("companyId", companyId);
      if (ops.error) {
        return ctx.error(
          "internal",
          "Failed to load the operations",
          ops.error
        );
      }
      const jobs = await releaseBatchMemberJobs(ctx, {
        jobIds: ops.data.map((op) => op.jobId),
        purchaseOrdersBySupplierId
      });
      if (jobs.error) {
        // The checks refuse before any job is released.
        if (jobs.error.category === "rule") {
          const dissolved = await service.updateJobOperationBatch(
            client,
            ctx.asSystem.pg,
            { type: "dissolve", batchId, companyId, userId }
          );
          if (dissolved.error) {
            logger.error("Failed to dissolve a batch whose release failed", {
              companyId,
              batchId,
              error: dissolved.error
            });
          }
        }
        return jobs.error;
      }

      const flipped = await service.releaseJobOperationBatch(
        client,
        ctx.asSystem.pg,
        { batchId, companyId, userId }
      );
      if (flipped.error) {
        return ctx.error(
          "rule",
          getErrorMessage(flipped.error, "Failed to release the batch"),
          flipped.error
        );
      }
      await service.notifyScheduleInputsChanged(
        companyId,
        "work-center",
        "batch released at creation",
        batch.workCenterId
      );
    }
    return { batchId, readableId: created?.readableId ?? null };
  }
});

/**
 * Take a released batch back off the floor.
 *
 * @remarks
 * Allowed only before its first production event (`batch-operations`
 * `unrelease`); the batch goes back to Planned. Then the scheduler is told.
 *
 * @mcp
 */
export const unreleaseBatch = defineServiceFn({
  input: z.object({ batchId: z.string().min(1) }),
  permission: { update: "production" },

  async run(ctx, { batchId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const batch = await client
      .from("jobOperationBatch")
      .select("workCenterId")
      .eq("id", batchId)
      .eq("companyId", companyId)
      .maybeSingle();
    const unreleased = await service.unreleaseJobOperationBatch(
      client,
      ctx.asSystem.pg,
      { batchId, companyId, userId: ctx.auditUserId }
    );
    if (unreleased.error) {
      return ctx.error(
        "rule",
        getErrorMessage(unreleased.error, "Failed to unrelease batch"),
        unreleased.error
      );
    }

    // After the status flip is persisted: the wave must see the new state.
    await service.notifyScheduleInputsChanged(
      companyId,
      "work-center",
      "batch unreleased",
      batch.data?.workCenterId ?? undefined
    );
    return { batchId };
  }
});

/**
 * Change a batch's members or work center, or dissolve it.
 *
 * @remarks
 * `add` and `remove` take `jobOperationIds`; `update` sets the work center
 * (none clears it); `dissolve` deletes a batch that has not started. The
 * `batch-operations` server function checks each (eligibility, the material
 * rules, the batch's status) and its refusal is returned as a `rule` error.
 * Release and unrelease are their own operations.
 *
 * @mcp
 */
export const updateBatch = defineServiceFn({
  input: z.object({
    batchId: z.string().min(1),
    type: z.enum(["add", "remove", "update", "dissolve"]),
    jobOperationIds: z.array(z.string().min(1)).optional(),
    workCenterId: z.string().optional()
  }),
  permission: { update: "production" },

  async run(ctx, { type, workCenterId, ...batch }) {
    const result = await service.updateJobOperationBatch(
      ctx.asCaller.supabase,
      ctx.asSystem.pg,
      {
        ...batch,
        type,
        // "update" clears the work center when none is sent.
        workCenterId: type === "update" ? (workCenterId ?? null) : workCenterId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      }
    );
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, `Failed to ${type} batch`),
        result.error
      );
    }
    return { batchId: batch.batchId };
  }
});

// --- People board ---------------------------------------------------------
/**
 * Put a person at a work center for a date.
 *
 * @remarks
 * Without `hours` the person works the whole shift there and their other
 * stations that day are replaced; with `hours` this station gets that part of
 * the day. The employee, location, work center and shift must be this
 * company's. Then the work center is rescheduled.
 *
 * @mcp
 */
export const assignPerson = defineServiceFn({
  input: peopleAssignmentValidator.omit({ id: true }),
  permission: { update: "production" },

  async run(ctx, assignment) {
    const refused = await service.requireBoardReferences(ctx, {
      employee: [assignment.employeeId],
      location: [assignment.locationId],
      shift: [assignment.shiftId],
      workCenter: [assignment.workCenterId]
    });
    if (refused) return refused;

    const written = await service.catchInternal(
      ctx,
      "Failed to assign people member",
      () =>
        service.upsertPeopleAssignment(ctx.asSystem.pg, {
          ...assignment,
          companyId: ctx.company.id,
          shiftId: assignment.shiftId || null,
          createdBy: ctx.auditUserId
        })
    );
    if (written instanceof CarbonError) return written;
    await service.notifyPeopleChange(ctx, "People assignment changed", [
      assignment.workCenterId
    ]);
    return { employeeId: assignment.employeeId };
  }
});

/**
 * Remove a person's assignment.
 *
 * @remarks
 * Then the work center it was at is rescheduled.
 *
 * @mcp destructive
 */
export const unassignPerson = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { update: "production" },

  async run(ctx, { id }) {
    const removed = await service.deletePeopleAssignment(
      ctx.asCaller.supabase,
      id,
      ctx.company.id
    );
    if (removed.error) {
      return ctx.error(
        "internal",
        "Failed to remove people member",
        removed.error
      );
    }
    await service.notifyPeopleChange(ctx, "People assignment removed", [
      removed.data.workCenterId
    ]);
    return { id };
  }
});

/**
 * Mark a person absent on a date.
 *
 * @remarks
 * The scheduler stops counting them that day; every work center they are
 * assigned at is rescheduled.
 *
 * @mcp
 */
export const markPersonAbsent = defineServiceFn({
  input: peopleAbsenceValidator.omit({ id: true }),
  permission: { update: "production" },

  async run(ctx, absence) {
    const refused = await service.requireBoardReferences(ctx, {
      employee: [absence.employeeId],
      shift: [absence.shiftId]
    });
    if (refused) return refused;

    const written = await service.setPeopleAbsence(ctx.asCaller.supabase, {
      ...absence,
      companyId: ctx.company.id,
      shiftId: absence.shiftId || null,
      createdBy: ctx.auditUserId
    });
    if (written.error) {
      return ctx.error("internal", "Failed to mark absent", written.error);
    }
    await service.notifyForEmployeeDate(
      ctx,
      absence.employeeId,
      absence.date,
      "People member marked absent"
    );
    return { id: written.data.id };
  }
});

/**
 * Clear a person's absence.
 *
 * @remarks
 * Every work center they are assigned at on `date` (the company's today when
 * not given) is rescheduled.
 *
 * @mcp destructive
 */
export const clearPersonAbsence = defineServiceFn({
  input: z.object({ id: z.string().min(1), date: z.string().optional() }),
  permission: { update: "production" },

  async run(ctx, { id, date }) {
    const cleared = await service.clearPeopleAbsence(
      ctx.asCaller.supabase,
      id,
      ctx.company.id
    );
    if (cleared.error) {
      return ctx.error("internal", "Failed to clear absence", cleared.error);
    }
    const day =
      date ||
      datetime
        .today(await getCompanyTimeZone(ctx.asCaller.supabase, ctx.company.id))
        .toString();
    await service.notifyForEmployeeDate(
      ctx,
      cleared.data.employeeId,
      day,
      "People absence cleared"
    );
    return { id };
  }
});

/**
 * Move a person's assignment to another work center.
 *
 * @remarks
 * A move onto a station the person already works that day merges the two.
 * Both the station they left and the one they joined are rescheduled.
 *
 * @mcp
 */
export const movePerson = defineServiceFn({
  input: peopleMoveValidator,
  permission: { update: "production" },

  async run(ctx, { id, workCenterId }) {
    const refused = await service.requireBoardReferences(ctx, {
      workCenter: [workCenterId]
    });
    if (refused) return refused;

    const moved = await service.catchInternal(
      ctx,
      "Failed to move assignment",
      () =>
        service.movePeopleAssignment(ctx.asSystem.pg, {
          id,
          companyId: ctx.company.id,
          workCenterId
        })
    );
    if (moved instanceof CarbonError) return moved;
    await service.notifyPeopleChange(ctx, "People assignment moved", [
      moved.workCenterId,
      moved.previousWorkCenterId
    ]);
    return { id };
  }
});

/**
 * Set a person's whole day: the stations they work, their hours at each, the
 * day's note and overtime.
 *
 * @remarks
 * The given rows become the day's assignments in one transaction (updated,
 * inserted or deleted to match). Every station they are at afterwards is
 * rescheduled.
 *
 * @mcp
 */
export const setPersonDay = defineServiceFn({
  input: peopleDayValidator,
  permission: { update: "production" },

  async run(ctx, day) {
    const refused = await service.requireBoardReferences(ctx, {
      employee: [day.employeeId],
      location: [day.locationId],
      shift: [day.shiftId],
      workCenter: day.rows.map((row) => row.workCenterId)
    });
    if (refused) return refused;

    const written = await service.catchInternal(
      ctx,
      "Failed to save working hours",
      () =>
        service.setPeopleDay(ctx.asSystem.pg, ctx.auditUserId, {
          ...day,
          companyId: ctx.company.id,
          shiftId: day.shiftId || null,
          note: day.note || null
        })
    );
    if (written instanceof CarbonError) return written;
    await service.notifyForEmployeeDate(
      ctx,
      day.employeeId,
      day.date,
      "People day hours changed"
    );
    return { employeeId: day.employeeId };
  }
});

/**
 * Set the hours of one assignment; none means the whole shift.
 *
 * @remarks
 * Lowering them frees the rest of the day for another station. Then the work
 * center is rescheduled.
 *
 * @mcp
 */
export const setPersonHours = defineServiceFn({
  input: peopleHoursValidator,
  permission: { update: "production" },

  async run(ctx, { id, hours }) {
    const result = await service.setPeopleAssignmentHours(
      ctx.asCaller.supabase,
      ctx.company.id,
      { id, hours: hours ?? null, updatedBy: ctx.auditUserId }
    );
    if (result.error) {
      return ctx.error("internal", "Failed to set hours", result.error);
    }
    await service.notifyPeopleChange(ctx, "People assignment hours changed", [
      result.data.workCenterId
    ]);
    return { id };
  }
});

/**
 * Authorize overtime for every assignment at a location on a date, or a range
 * of dates.
 *
 * @remarks
 * Optionally only a department's work centers or one shift. One UPDATE, so it
 * applies to all or none. Every work center touched is rescheduled. Returns
 * how many assignments were updated.
 *
 * @mcp
 */
export const setPeopleOvertime = defineServiceFn({
  input: peopleOvertimeBulkValidator,
  permission: { update: "production" },

  async run(ctx, overtime) {
    const refused = await service.requireBoardReferences(ctx, {
      department: [overtime.departmentId],
      location: [overtime.locationId],
      shift: [overtime.shiftId]
    });
    if (refused) return refused;

    const rows = await service.catchInternal(
      ctx,
      "Failed to set overtime",
      () =>
        service.setPeopleOvertimeBulk(ctx.asSystem.pg, {
          ...overtime,
          companyId: ctx.company.id,
          toDate: overtime.toDate || null,
          shiftId: overtime.shiftId || null,
          departmentId: overtime.departmentId || null,
          updatedBy: ctx.auditUserId
        })
    );
    if (rows instanceof CarbonError) return rows;
    await service.notifyPeopleChange(
      ctx,
      "People overtime changed",
      rows.map((row) => row.workCenterId)
    );
    return { updated: rows.length };
  }
});

/**
 * Copy one day's people board at a location to another date.
 *
 * @remarks
 * People already assigned on the target date, or absent there, are skipped;
 * overtime is not copied. Then the location is rescheduled.
 *
 * @mcp
 */
export const copyPeopleDay = defineServiceFn({
  input: copyPeopleBoardValidator,
  permission: { update: "production" },

  async run(ctx, copy) {
    const refused = await service.requireBoardReferences(ctx, {
      location: [copy.locationId],
      shift: [copy.shiftId]
    });
    if (refused) return refused;

    const result = await service.catchInternal(
      ctx,
      "Failed to copy people board",
      () =>
        service.copyPeopleBoard(ctx.asSystem.pg, {
          ...copy,
          companyId: ctx.company.id,
          shiftId: copy.shiftId || null,
          createdBy: ctx.auditUserId
        })
    );
    if (result instanceof CarbonError) return result;
    await service.notifyPeopleChange(
      ctx,
      "People board copied from previous day"
    );
    return result;
  }
});

/**
 * Put a person at a work center for a whole week.
 *
 * @remarks
 * One assignment per working day of their shift (Monday to Friday when it has
 * none) from `weekStart`. Then the work center is rescheduled.
 *
 * @mcp
 */
export const assignPersonWeek = defineServiceFn({
  input: peopleWeekAssignValidator,
  permission: { update: "production" },

  async run(ctx, week) {
    const refused = await service.requireBoardReferences(ctx, {
      employee: [week.employeeId],
      location: [week.locationId],
      shift: [week.shiftId],
      workCenter: [week.workCenterId]
    });
    if (refused) return refused;

    const written = await service.catchInternal(
      ctx,
      "Failed to assign week",
      () =>
        service.assignPeopleWeek(ctx.asSystem.pg, ctx.auditUserId, {
          ...week,
          companyId: ctx.company.id,
          shiftId: week.shiftId || null
        })
    );
    if (written instanceof CarbonError) return written;
    await service.notifyPeopleChange(ctx, "People week assignment", [
      week.workCenterId
    ]);
    return { employeeId: week.employeeId };
  }
});

/**
 * Remove a person from a work center for the week from `weekStart`.
 *
 * @remarks
 * Then the work center is rescheduled.
 *
 * @mcp destructive
 */
export const unassignPersonWeek = defineServiceFn({
  input: peopleWeekUnassignValidator,
  permission: { update: "production" },

  async run(ctx, week) {
    const refused = await service.requireBoardReferences(ctx, {
      employee: [week.employeeId],
      shift: [week.shiftId],
      workCenter: [week.workCenterId]
    });
    if (refused) return refused;

    const written = await service.catchInternal(
      ctx,
      "Failed to unassign week",
      () =>
        service.unassignPeopleWeek(ctx.asSystem.pg, {
          ...week,
          companyId: ctx.company.id,
          shiftId: week.shiftId || null
        })
    );
    if (written instanceof CarbonError) return written;
    await service.notifyPeopleChange(ctx, "People week unassignment", [
      week.workCenterId
    ]);
    return { employeeId: week.employeeId };
  }
});

/**
 * Move a person's week from one work center to another.
 *
 * @remarks
 * Then the work center they joined is rescheduled.
 *
 * @mcp
 */
export const movePersonWeek = defineServiceFn({
  input: peopleWeekMoveValidator,
  permission: { update: "production" },

  async run(ctx, week) {
    const refused = await service.requireBoardReferences(ctx, {
      employee: [week.employeeId],
      shift: [week.shiftId],
      workCenter: [week.workCenterId, week.fromWorkCenterId]
    });
    if (refused) return refused;

    const written = await service.catchInternal(
      ctx,
      "Failed to move week",
      () =>
        service.movePeopleWeek(ctx.asSystem.pg, {
          ...week,
          companyId: ctx.company.id,
          shiftId: week.shiftId || null
        })
    );
    if (written instanceof CarbonError) return written;
    await service.notifyPeopleChange(ctx, "People week move", [
      week.workCenterId
    ]);
    return { employeeId: week.employeeId };
  }
});

/**
 * Copy a whole week's people board at a location to another week.
 *
 * @remarks
 * The same skip rules as a day copy, day by day. Then the location is
 * rescheduled.
 *
 * @mcp
 */
export const copyPeopleWeekBoard = defineServiceFn({
  input: copyPeopleWeekValidator,
  permission: { update: "production" },

  async run(ctx, copy) {
    const refused = await service.requireBoardReferences(ctx, {
      location: [copy.locationId],
      shift: [copy.shiftId]
    });
    if (refused) return refused;

    const result = await service.catchInternal(
      ctx,
      "Failed to copy people week",
      () =>
        service.copyPeopleWeek(ctx.asSystem.pg, {
          ...copy,
          companyId: ctx.company.id,
          shiftId: copy.shiftId || null,
          createdBy: ctx.auditUserId
        })
    );
    if (result instanceof CarbonError) return result;
    await service.notifyPeopleChange(
      ctx,
      "People week copied from previous week"
    );
    return result;
  }
});

/**
 * Mark a person absent for a range of dates (at most 62 days).
 *
 * @remarks
 * One absence per date; a date already marked is skipped. Then the scheduler
 * is told. Returns how many days were marked.
 *
 * @mcp
 */
export const markPersonAbsentRange = defineServiceFn({
  input: peopleAbsenceRangeValidator,
  permission: { update: "production" },

  async run(ctx, range) {
    const refused = await service.requireBoardReferences(ctx, {
      employee: [range.employeeId],
      shift: [range.shiftId]
    });
    if (refused) return refused;

    const result = await service.catchInternal(
      ctx,
      "Failed to set absence range",
      () =>
        service.setPeopleAbsenceRange(ctx.asSystem.pg, ctx.auditUserId, {
          ...range,
          companyId: ctx.company.id,
          shiftId: range.shiftId || null
        })
    );
    if (result instanceof CarbonError) return result;
    await service.notifyPeopleChange(ctx, "People absence range set");
    return result;
  }
});

// --- Production planning --------------------------------------------------

/**
 * Create planned jobs for planning's suggested Make orders.
 *
 * @remarks
 * `items` are the parts being ordered, each with its orders (quantity, start
 * and due date, the planning week). Only new jobs: an order naming an
 * existing job is refused, since an existing job is changed through
 * `updatePlannedJob` or Apply. The location and every item must
 * be this company's. Per item: one whose manufacturing is blocked, needs
 * configuration or is held by an unreleased change notice is skipped and
 * named in `errors`; each order becomes a
 * Planned job (ASAP or Soft Deadline) at the location with the item's method.
 * Then the Make suggestions those orders answer are settled, the jobs' supply
 * is recorded per week (`supplyForecast`) and their requirements are
 * recalculated. An item with no orders is counted as already planned (it has
 * an open job) or as needing nothing. When not one item could be ordered the
 * call fails with the first errors.
 *
 * @mcp
 */
export const orderPlannedJobs = defineServiceFn({
  input: z.object({
    locationId: z.string(),
    items: z
      .array(
        z.object({ id: z.string(), orders: z.array(productionOrderValidator) })
      )
      .min(1, "No items were provided to create production orders")
  }),
  permission: { create: "production" },

  async run(ctx, { locationId, items }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const client = ctx.asSystem.supabase;
    const db = ctx.asSystem.pg;

    if (items.some((item) => item.orders.some((o) => o.existingId))) {
      return ctx.error(
        "validation",
        "Existing jobs are changed from the Open Jobs list"
      );
    }

    // Every id comes from the caller and the writes use the service role.
    const itemIds = [...new Set(items.map((item) => item.id))];
    const [ownedLocation, ownedItems] = await Promise.all([
      client
        .from("location")
        .select("id")
        .eq("id", locationId)
        .eq("companyId", companyId)
        .maybeSingle(),
      client
        .from("item")
        .select("id")
        .in("id", itemIds)
        .eq("companyId", companyId)
    ]);
    if (
      ownedLocation.error ||
      !ownedLocation.data ||
      ownedItems.error ||
      ownedItems.data.length !== itemIds.length
    ) {
      logger.error("Planning order references records outside the company", {
        companyId,
        locationId,
        itemIds,
        error: ownedLocation.error ?? ownedItems.error
      });
      return ctx.error("notFound", "Not found");
    }

    const createdJobs: { id: string; readableId: string }[] = [];
    const itemsWithoutOrders: string[] = [];
    const supplyByKey = new Map<
      string,
      {
        itemId: string;
        locationId: string;
        sourceType: "Production Order";
        forecastQuantity: number;
        periodId: string;
        companyId: string;
        createdBy: string;
        updatedBy: string;
      }
    >();
    // The (item, week) of every order that became a job, so the Make
    // suggestions it answers leave the worklist now, not at the next run.
    const ordered: { itemId: string; periodId: string }[] = [];
    const errors: string[] = [];
    let processedItems = 0;

    const manufacturingRows = await client
      .from("itemReplenishment")
      .select("itemId, manufacturingBlocked, requiresConfiguration")
      .in(
        "itemId",
        items.flatMap((item) => (item.orders.length > 0 ? [item.id] : []))
      )
      .eq("companyId", companyId);
    const manufacturingByItem = new Map(
      (manufacturingRows.data ?? []).map((row) => [row.itemId, row])
    );

    const unreleased = await getUnreleasedChangeOrderItems(client, {
      itemIds: items.flatMap((item) =>
        item.orders.length > 0 ? [item.id] : []
      ),
      companyId
    });
    if (unreleased.error) return ctx.error("internal", unreleased.error);
    const heldByChangeNotice = new Map(
      unreleased.data.map((held) => [held.itemId, held])
    );

    for (const item of items) {
      if (item.orders.length === 0) {
        // Nothing to make: existing supply already covers demand.
        itemsWithoutOrders.push(item.id);
        continue;
      }

      const held = heldByChangeNotice.get(item.id);
      if (held) {
        errors.push(
          `${unreleasedChangeOrderItemsMessage([held])} A job cannot be made for it.`
        );
        continue;
      }

      const manufacturing = manufacturingByItem.get(item.id);
      if (manufacturingRows.error || !manufacturing) {
        errors.push(
          `Failed to retrieve manufacturing data for item ${item.id}: ${
            manufacturingRows.error?.message ?? "No replenishment record"
          }`
        );
        continue;
      }
      if (manufacturing.manufacturingBlocked) {
        errors.push(`Manufacturing is blocked for item ${item.id}`);
        continue;
      }
      if (manufacturing.requiresConfiguration) {
        errors.push(`Manufacturing requires configuration for item ${item.id}`);
        continue;
      }

      let itemProcessed = false;
      for (const order of item.orders) {
        const created = await service.insertJob(
          client,
          db,
          {
            itemId: item.id,
            quantity: order.quantity,
            startDate: order.startDate ?? undefined,
            dueDate: order.dueDate ?? undefined,
            deadlineType: order.isASAP ? "ASAP" : "Soft Deadline",
            status: "Planned",
            locationId,
            companyId,
            createdBy: userId,
            unitOfMeasureCode: "EA"
          },
          { skipMethod: true, skipRecalculate: true, source: "mrp" }
        );
        if (created.error || !created.data?.id) {
          errors.push(
            created.error
              ? `Failed to create job for item ${item.id}: ${created.error.message}`
              : `Job was not returned after creation for item ${item.id}`
          );
          continue;
        }
        const id = created.data.id;

        const method = await service.upsertJobMethod(client, db, "itemToJob", {
          sourceId: item.id,
          targetId: id,
          companyId,
          userId
        });
        if (method.error) {
          errors.push(
            `Failed to create job method for item ${item.id}: ${method.error.message}`
          );
          continue;
        }

        createdJobs.push({ id, readableId: created.data.jobId ?? "" });
        itemProcessed = true;
        ordered.push({ itemId: item.id, periodId: order.periodId });
        const key = `${item.id}\u001f${order.periodId}`;
        const supply = supplyByKey.get(key);
        if (supply) supply.forecastQuantity += order.quantity;
        else {
          supplyByKey.set(key, {
            itemId: item.id,
            locationId,
            sourceType: "Production Order",
            forecastQuantity: order.quantity,
            periodId: order.periodId,
            companyId,
            createdBy: userId,
            updatedBy: userId
          });
        }
      }
      if (itemProcessed) processedItems++;
    }
    for (const error of errors) logger.error(error, { companyId, locationId });

    const settled = await service.settleNewSupplyPlanningActions(db, {
      companyId,
      locationId,
      userId,
      type: "Make",
      ordered
    });
    if (settled.error) {
      // The jobs stand; the suggestions clear on the next MRP run.
      logger.error("Failed to settle ordered planning actions", {
        companyId,
        locationId,
        error: settled.error
      });
    }

    if (supplyByKey.size > 0) {
      const forecasts = await client
        .from("supplyForecast")
        .upsert([...supplyByKey.values()], {
          onConflict: "itemId,locationId,periodId",
          ignoreDuplicates: false
        });
      if (forecasts.error) {
        errors.push(
          `Failed to insert supply forecasts: ${forecasts.error.message}`
        );
      }
    }

    for (const job of createdJobs) {
      const recalc = await service.recalculateJobRequirements(client, db, {
        id: job.id,
        companyId,
        userId
      });
      if (recalc.error) {
        logger.error("Failed to recalculate a planned job", {
          companyId,
          jobId: job.id,
          error: recalc.error
        });
        errors.push(
          `Created job ${job.id}, but its requirements could not be recalculated`
        );
      }
    }

    // A skipped item: a job already covers it, or there is nothing to make.
    const alreadyPlannedItemIds = new Set<string>();
    if (itemsWithoutOrders.length > 0) {
      const openJobs = await client
        .from("job")
        .select("itemId")
        .eq("companyId", companyId)
        .eq("locationId", locationId)
        .in("itemId", itemsWithoutOrders)
        .in("status", ["Draft", "Planned", "Ready", "In Progress", "Paused"]);
      for (const job of openJobs.data ?? []) {
        if (job.itemId) alreadyPlannedItemIds.add(job.itemId);
      }
    }

    if (errors.length > 0 && processedItems === 0) {
      return ctx.error(
        "rule",
        `Failed to process any items. Errors: ${errors.slice(0, 3).join("; ")}${
          errors.length > 3 ? ` and ${errors.length - 3} more...` : ""
        }`
      );
    }

    return {
      jobs: createdJobs,
      alreadyPlannedItemCount: alreadyPlannedItemIds.size,
      noDemandItemCount: itemsWithoutOrders.length - alreadyPlannedItemIds.size,
      processedItems,
      totalItems: items.length,
      errors
    };
  }
});
const notEditableFromPlanning =
  "This job is no longer Draft or Planned. Change it on the job.";

/**
 * Change a planned job's quantity or due date from the planning drawer.
 *
 * @remarks
 * Only a Draft or Planned job at `locationId` (`isJobEditableFromPlanning`,
 * checked again in the UPDATE itself), so a job released to the floor is
 * never edited from planning; a quantity change restates the scrap. Then a
 * new quantity recalculates the job's requirements, a new date tells the
 * scheduler. A failure there leaves the edit saved and is returned as
 * `warning`.
 *
 * @mcp
 */
export const updatePlannedJob = defineServiceFn({
  input: z.object({
    locationId: z.string(),
    job: z.discriminatedUnion("field", [
      z.object({
        id: z.string().min(1),
        field: z.literal("quantity"),
        value: z.number().positive()
      }),
      z.object({
        id: z.string().min(1),
        field: z.literal("dueDate"),
        value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      })
    ])
  }),
  permission: { update: "production" },

  async run(ctx, { locationId, job }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const target = await service.readPlanningJob(ctx, job.id, locationId);
    if (target instanceof CarbonError) return target;
    if (!isJobEditableFromPlanning(target.status)) {
      return ctx.error("conflict", notEditableFromPlanning);
    }

    const saved = await service.updatePlanningJob(ctx.asSystem.supabase, {
      id: target.id,
      companyId,
      updatedBy: userId,
      ...(job.field === "quantity"
        ? { quantity: job.value }
        : { dueDate: job.value })
    });
    if (saved.error) {
      return ctx.error("internal", "Failed to update job", saved.error);
    }
    // Released (or finished) after the status check above.
    if (!saved.updated) return ctx.error("conflict", notEditableFromPlanning);

    // Saved from here on: a failure below is a warning on a saved edit.
    if (job.field === "quantity") {
      const recalc = await service.recalculateJobRequirements(
        ctx.asSystem.supabase,
        ctx.asSystem.pg,
        { id: target.id, companyId, userId }
      );
      if (recalc.error) {
        logger.error("Failed to recalculate job requirements from planning", {
          companyId,
          jobId: target.id,
          error: recalc.error
        });
        return {
          id: target.id,
          warning:
            "The quantity is saved, but the job's materials and operations were not recalculated. Recalculate the job."
        };
      }
      return { id: target.id, warning: null };
    }

    const notified = await service.notifyScheduleInputsChanged(
      ctx.company.id,
      "reorder",
      "Planning changed a job's due date",
      target.id
    );
    return {
      id: target.id,
      warning: notified
        ? null
        : "The due date is saved, but the schedule was not refreshed. Reschedule the location."
    };
  }
});
/**
 * Plan a Draft job from the planning drawer.
 *
 * @remarks
 * Only this location's make-to-stock Draft jobs: a job a sales order owns is
 * that order's, not planning's. Then `planDraftJob`: the requirements
 * recalculation, Draft → Planned, and MRP, so the job counts as supply and
 * the Make suggestion shrinks by it. `warning` is set when MRP did not run.
 *
 * @mcp
 */
export const planJobFromPlanning = defineServiceFn({
  input: z.object({ locationId: z.string(), jobId: z.string().min(1) }),
  permission: { update: "production" },

  async run(ctx, { locationId, jobId }) {
    const target = await service.readPlanningJob(ctx, jobId, locationId);
    if (target instanceof CarbonError) return target;
    if (target.salesOrderId || target.salesOrderLineId) {
      return ctx.error(
        "conflict",
        "This job is for a sales order. Plan it on the job."
      );
    }
    if (target.status !== "Draft") {
      return ctx.error("conflict", "Only a Draft job can be planned.");
    }
    const planned = await planDraftJob(ctx, { jobId: target.id });
    if (planned.error) return planned.error;
    return { id: target.id, warning: planned.data.warning };
  }
});

const planningActionIdsInput = z
  .array(z.string().min(1))
  .min(1)
  .transform((ids) => [...new Set(ids)]);

type PlanningActionRow = NonNullable<
  Awaited<ReturnType<typeof service.getPlanningActionsByIds>>["data"]
>[number];

const CHANGE_ACTION_TYPES = [
  "Expedite",
  "Defer",
  "Increase",
  "Decrease",
  "Cancel"
] as const;

/**
 * Apply MRP's change suggestions to their jobs.
 *
 * @remarks
 * Every id is read from the persisted worklist (only an Open change action on
 * a job; the type, job and suggested value come from the row, never the
 * caller); `type` keeps only actions of that type. A job that is not Draft or
 * Planned is never edited from planning: its action is listed in
 * `requiresManualAction`. Expedite / Defer move the jobs' due dates in one
 * transaction, then the scheduler is told once. Increase / Decrease set the
 * job's quantity (guarded on Draft / Planned in the UPDATE) and recalculate
 * it; Cancel runs `cancelJob` from Draft / Planned. Each of those
 * is claimed right before its change, three jobs at a time, and a failed one
 * gives its claim back. Returns what was `applied`, what needs review,
 * `warnings` (applied, with a follow-up step that failed) and `errors`.
 *
 * @mcp
 */
export const applyPlanningActions = defineServiceFn({
  input: z.object({
    planningActionIds: planningActionIdsInput,
    type: z.enum(CHANGE_ACTION_TYPES).optional()
  }),
  permission: { update: "production" },

  async run(ctx, { planningActionIds, type }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const client = ctx.asSystem.supabase;
    const db = ctx.asSystem.pg;
    const applied: string[] = [];
    const requiresManualAction: { id: string; jobId: string | null }[] = [];
    const errors: string[] = [];
    // Applied, but a follow-up step failed: reported, never rolled back.
    const warnings: string[] = [];

    // A claim that is not given back leaves the action Actioned with nothing
    // applied, so a failed release is reported, never swallowed.
    const releaseClaim = async (planningActionId: string) => {
      const released = await service.releasePlanningActionClaim(client, {
        id: planningActionId,
        companyId,
        userId
      });
      if (released.error) {
        logger.error("Failed to release a planning action claim", {
          companyId,
          planningActionId,
          error: released.error
        });
        errors.push(
          `Planning action ${planningActionId} could not be reopened: ${released.error}`
        );
      }
    };

    const actionRows = await service.getPlanningActionsByIds(db, {
      ids: planningActionIds,
      companyId
    });
    if (actionRows.error) {
      return ctx.error(
        "internal",
        "Failed to read planning actions",
        actionRows.error
      );
    }
    const rowById = new Map(actionRows.data.map((row) => [row.id, row]));

    const eligible: { planningActionId: string; row: PlanningActionRow }[] = [];
    for (const planningActionId of planningActionIds) {
      const row = rowById.get(planningActionId);
      if (!row) {
        errors.push(`Planning action ${planningActionId} not found`);
        continue;
      }
      if (row.status !== "Open") {
        errors.push(`Planning action ${planningActionId} is not open`);
        continue;
      }
      if (
        type
          ? row.type !== type
          : !(CHANGE_ACTION_TYPES as readonly string[]).includes(row.type)
      ) {
        errors.push(
          type
            ? `Planning action ${planningActionId} is a ${row.type}, not ${type}`
            : `Planning action ${planningActionId} is a ${row.type}, which Apply cannot batch`
        );
        continue;
      }
      if (!row.jobId) {
        errors.push(
          `Planning action ${planningActionId} does not target a job`
        );
        continue;
      }
      eligible.push({ planningActionId, row });
    }

    // One statement: the id list is a parameter, never a PostgREST URL.
    const jobIds = [...new Set(eligible.map(({ row }) => row.jobId!))];
    const jobs = await service.catchInternal(
      ctx,
      "Failed to read the planning actions' jobs",
      async () =>
        jobIds.length > 0
          ? db
              .selectFrom("job")
              .select(["id", "status"])
              .where("id", "in", jobIds)
              .where("companyId", "=", companyId)
              .execute()
          : []
    );
    if (jobs instanceof CarbonError) return jobs;
    const jobStatusById = new Map(jobs.map((job) => [job.id, job.status]));

    const toClaim: typeof eligible = [];
    for (const target of eligible) {
      const jobId = target.row.jobId!;
      const status = jobStatusById.get(jobId);
      if (status === undefined) {
        errors.push(
          `Job for planning action ${target.planningActionId} not found`
        );
        continue;
      }
      if (!isJobEditableFromPlanning(status)) {
        // On the floor, finished, closed or cancelled since MRP ran.
        requiresManualAction.push({ id: target.planningActionId, jobId });
        continue;
      }
      toClaim.push(target);
    }

    // Dates: ONE transaction for every Expedite / Defer, then ONE scheduler
    // event (a "reorder" event re-stamps the whole company whatever its job).
    const dateActions = toClaim.filter(
      ({ row }) =>
        (row.type === "Expedite" || row.type === "Defer") && row.suggestedDate
    );
    if (dateActions.length > 0) {
      let outcome: Awaited<
        ReturnType<typeof service.applyProductionPlanningDateActions>
      >;
      try {
        outcome = await service.applyProductionPlanningDateActions(db, {
          companyId,
          userId,
          actions: dateActions.map(({ planningActionId, row }) => ({
            planningActionId,
            jobId: row.jobId!,
            suggestedDate: row.suggestedDate
          }))
        });
      } catch (err) {
        return ctx.error(
          "internal",
          `Failed to reschedule jobs: ${getErrorMessage(err, "unknown error")}`,
          err
        );
      }
      applied.push(...outcome.applied);
      requiresManualAction.push(...outcome.refused);
      for (const id of outcome.alreadyApplied) {
        errors.push(`Planning action ${id} was already applied`);
      }
      if (outcome.applied.length > 0) {
        const notified = await service.notifyScheduleInputsChanged(
          ctx.company.id,
          "reorder",
          `Planning rescheduled ${outcome.applied.length} job(s)`
        );
        if (!notified) {
          warnings.push(
            `${outcome.applied.length} due date(s) are saved, but the schedule was not refreshed`
          );
        }
      }
    }

    // Each action is claimed right before its own change: a request that dies
    // here strands at most the actions in flight, which the next MRP run
    // re-emits as fresh Open actions. Resolves to the claimed suggestion.
    const claim = async (planningActionId: string) => {
      const claimed = await service.markPlanningActionsActioned(db, {
        ids: [planningActionId],
        companyId,
        userId
      });
      if (claimed.error) {
        logger.error("Failed to claim a planning action", {
          companyId,
          planningActionId,
          error: claimed.error
        });
        errors.push(
          `Planning action ${planningActionId} could not be claimed: ${claimed.error.message}`
        );
        return null;
      }
      const [row] = claimed.data;
      if (!row) {
        errors.push(`Planning action ${planningActionId} was already applied`);
        return null;
      }
      return {
        suggestedQuantity:
          row.suggestedQuantity === null || row.suggestedQuantity === undefined
            ? null
            : Number(row.suggestedQuantity)
      };
    };

    // Two actions on one job (an Increase and a Cancel) must not run at once:
    // group by job, run the groups three at a time, each group in order.
    const byJob = groupBy(
      toClaim.filter(
        ({ row }) =>
          row.type === "Cancel" ||
          row.type === "Increase" ||
          row.type === "Decrease"
      ),
      ({ row }) => row.jobId!
    );
    await async.map(
      Object.values(byJob),
      async (group) => {
        for (const { planningActionId, row } of group) {
          const claimedRow = await claim(planningActionId);
          if (!claimedRow) continue;
          const jobId = row.jobId!;

          if (row.type === "Cancel") {
            const cancelled = await cancelJob(ctx, {
              jobId,
              // Read Draft / Planned above; released since, it goes to
              // review instead of losing its picks.
              fromStatuses: [...PLANNING_EDITABLE_JOB_STATUSES]
            });
            if (cancelled.error) {
              await releaseClaim(planningActionId);
              if (cancelled.error.category === "conflict") {
                requiresManualAction.push({ id: planningActionId, jobId });
              } else {
                errors.push(
                  `Failed to cancel job for planning action ${planningActionId}: ${cancelled.error.message}`
                );
              }
              continue;
            }
            if (cancelled.data.warning) warnings.push(cancelled.data.warning);
          } else {
            const update = await service.updatePlanningJob(client, {
              id: jobId,
              companyId,
              updatedBy: userId,
              quantity: Number(
                claimedRow.suggestedQuantity ?? row.suggestedQuantity
              )
            });
            if (update.error) {
              await releaseClaim(planningActionId);
              errors.push(
                `Failed to update job quantity for planning action ${planningActionId}: ${update.error.message}`
              );
              continue;
            }
            if (!update.updated) {
              // Released (or finished) since it was read.
              await releaseClaim(planningActionId);
              requiresManualAction.push({ id: planningActionId, jobId });
              continue;
            }
            const recalc = await service.recalculateJobRequirements(
              client,
              db,
              {
                id: jobId,
                companyId,
                userId
              }
            );
            if (recalc.error) {
              // The quantity change stands, and the action stays Actioned.
              logger.error(
                "Failed to recalculate job requirements after a planning action",
                { companyId, jobId, planningActionId, error: recalc.error }
              );
              warnings.push(
                `Planning action ${planningActionId}: the quantity is saved, but the job's materials and operations were not recalculated`
              );
            }
          }
          applied.push(planningActionId);
        }
      },
      { concurrency: 3 }
    );

    return { applied, requiresManualAction, warnings, errors };
  }
});
/**
 * Dismiss production planning suggestions.
 *
 * @remarks
 * Only Open Make-side actions change; a dismissed one stays dismissed until
 * its need changes materially. Returns how many changed.
 *
 * @mcp
 */
export const dismissProductionPlanningActions = defineServiceFn({
  input: z.object({ planningActionIds: planningActionIdsInput }),
  permission: { update: "production" },

  async run(ctx, { planningActionIds }) {
    const result = await service.dismissPlanningActions(ctx.asSystem.pg, {
      ids: planningActionIds,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      kind: "Make"
    });
    return service.changedPlanningActions(
      ctx,
      result,
      planningActionIds.length,
      "dismiss"
    );
  }
});

/**
 * Reopen dismissed production planning suggestions.
 *
 * @remarks
 * Only Dismissed Make-side actions change. Returns how many changed.
 *
 * @mcp
 */
export const reopenProductionPlanningActions = defineServiceFn({
  input: z.object({ planningActionIds: planningActionIdsInput }),
  permission: { update: "production" },

  async run(ctx, { planningActionIds }) {
    const result = await service.reopenDismissedPlanningActions(
      ctx.asSystem.pg,
      {
        ids: planningActionIds,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        kind: "Make"
      }
    );
    return service.changedPlanningActions(
      ctx,
      result,
      planningActionIds.length,
      "reopen"
    );
  }
});

/**
 * Assign production planning suggestions to an employee, or unassign them.
 *
 * @remarks
 * The assignee must be an active employee of this company; none unassigns.
 * The assignment overrides the owner MRP would resolve on its next run. Only
 * Open and Dismissed Make-side actions change. Returns how many changed.
 *
 * @mcp
 */
export const assignProductionPlanningActions = defineServiceFn({
  input: z.object({
    planningActionIds: planningActionIdsInput,
    assignee: z.string().optional()
  }),
  permission: { update: "production" },

  async run(ctx, { planningActionIds, assignee }) {
    if (
      assignee &&
      !(await isActiveCompanyEmployee(
        ctx.asSystem.supabase,
        ctx.company.id,
        assignee
      ))
    ) {
      return ctx.error("validation", "Choose an employee of this company");
    }
    const result = await service.assignPlanningActions(ctx.asSystem.pg, {
      ids: planningActionIds,
      companyId: ctx.company.id,
      assignee: assignee || null,
      userId: ctx.auditUserId,
      kind: "Make"
    });
    return service.changedPlanningActions(
      ctx,
      result,
      planningActionIds.length,
      "assign"
    );
  }
});

// --- Production quantities and procedures ---------------------------------

/**
 * Record a production quantity (good, scrap or rework) on a job operation.
 *
 * @remarks
 * Refused when the operation's job is locked (Completed, Closed or
 * Cancelled). A scrap reason is kept only on Scrap. A back-office entry: the
 * work event says it came from the ERP, not the shop floor.
 *
 * @mcp
 */
export const createProductionQuantity = defineServiceFn({
  input: productionQuantityValidator,
  permission: { create: "production" },

  async run(ctx, { id: _id, ...quantity }) {
    const companyId = ctx.company.id;
    const operation = await ctx.asCaller.supabase
      .from("jobOperation")
      .select("job(status)")
      .eq("id", quantity.jobOperationId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (operation.error) {
      return ctx.error(
        "internal",
        "Failed to read the operation",
        operation.error
      );
    }
    if (!operation.data) return ctx.error("notFound", "Operation not found");
    if (isJobLocked(operation.data.job?.status)) {
      return ctx.error("rule", JOB_LOCKED_MESSAGE);
    }

    const scrapReasonId =
      quantity.type === "Scrap" ? quantity.scrapReasonId : undefined;
    const insert = await service.upsertProductionQuantity(
      ctx.asCaller.supabase,
      {
        ...quantity,
        // The form names the employee who produced it; else the caller.
        createdBy: quantity.createdBy || ctx.auditUserId,
        scrapReasonId,
        companyId
      }
    );
    if (insert.error || !insert.data?.id) {
      return ctx.error(
        "internal",
        "Failed to insert production quantity",
        insert.error
      );
    }

    // The source is what makes the MES-vs-ERP ratio readable: a clerk typing
    // yesterday's paper traveller in is a different fact from an operator.
    const common = {
      companyId,
      userId: ctx.auditUserId,
      productionQuantityId: insert.data.id,
      jobOperationId: quantity.jobOperationId,
      quantity: quantity.quantity,
      source: "erp" as const
    };
    if (quantity.type === "Scrap") {
      trackWorkEvent("scrap_reported", {
        ...common,
        scrapReasonId: scrapReasonId ?? null
      });
    } else if (quantity.type === "Production") {
      trackWorkEvent("production_quantity_reported", common);
    }
    return { id: insert.data.id };
  }
});

/**
 * Correct a recorded production quantity.
 *
 * @remarks
 * Needs accounting update, since the quantity feeds the job's costing. A
 * scrap reason is kept only on Scrap. Not published: a published operation
 * gates on its own module's permission.
 */
export const updateProductionQuantity = defineServiceFn({
  input: productionQuantityValidator.safeExtend({ id: z.string() }),
  permission: { update: "accounting" },

  async run(ctx, { id, ...quantity }) {
    const update = await service.upsertProductionQuantity(
      ctx.asCaller.supabase,
      {
        ...quantity,
        id,
        scrapReasonId:
          quantity.type === "Scrap" ? quantity.scrapReasonId : undefined,
        companyId: ctx.company.id,
        updatedBy: ctx.auditUserId
      }
    );
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update production quantity",
        update.error
      );
    }
    return { id };
  }
});

/**
 * Change procedures' name, content, status, process or tags.
 *
 * @remarks
 * A field left out is unchanged. One UPDATE for every procedure given.
 *
 * @mcp
 */
export const setProcedureFields = defineServiceFn({
  input: z.object({
    ids: z.array(z.string()).min(1),
    name: z.string().optional(),
    content: z.string().optional(),
    status: z.enum(procedureStatus).optional(),
    processId: z.string().optional(),
    tags: z.array(z.string()).optional()
  }),
  permission: { update: "production" },

  async run(ctx, { ids, content, ...fields }) {
    let parsedContent: Json | undefined;
    if (content !== undefined) {
      try {
        parsedContent = JSON.parse(content);
      } catch {
        return ctx.error("validation", "Invalid procedure content");
      }
    }
    let update = ctx.asCaller.supabase
      .from("procedure")
      .update({
        ...fields,
        ...(parsedContent !== undefined ? { content: parsedContent } : {}),
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    // Only a Draft procedure's content is editable, as in the editor.
    if (parsedContent !== undefined) update = update.eq("status", "Draft");
    const updated = await update.select("id");
    if (updated.error) {
      return ctx.error("internal", "Failed to update procedure", updated.error);
    }
    if (parsedContent !== undefined && updated.data.length !== ids.length) {
      return ctx.error("rule", "Only a Draft procedure's content can change");
    }
    return { ids };
  }
});

// --- Assembly instructions -------------------------------------------------
/**
 * Create an assembly instruction for an item from its 3D model.
 *
 * @remarks
 * The model is `modelUploadId` when it is this company's and usable, else
 * the item's own. Refused when there is no usable model, and when the model
 * still needs converting while the geometry service is down. Then the
 * instruction is created, and the model converted when it is not yet, or
 * motion planning started when it is converted and has no plan. `autogen`
 * says the page should generate the steps once the plan is ready.
 *
 * @mcp
 */
export const createAssemblyInstruction = defineServiceFn({
  input: z.object({
    itemId: z.string().min(1),
    modelUploadId: z.string().optional()
  }),
  permission: { create: "production" },

  async run(ctx, { itemId, modelUploadId }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;

    // An explicit model (e.g. from the part details page) wins when usable.
    let model: { id: string } | null = null;
    let modelState: AssemblyModelState = "none";
    if (modelUploadId) {
      const explicit = await client
        .from("modelUpload")
        .select("id, processingStatus, glbPath, graphPath, modelPath")
        .eq("id", modelUploadId)
        .eq("companyId", companyId)
        .maybeSingle();
      const explicitState = getAssemblyModelState(explicit.data ?? null);
      if (explicit.data && explicitState !== "none") {
        model = explicit.data;
        modelState = explicitState;
      }
    }

    const derived = await service.getModelForItem(client, itemId, companyId);
    if (!derived.item) {
      return ctx.error("notFound", "Failed to load the selected item");
    }
    if (!model && derived.model && derived.modelState !== "none") {
      model = derived.model;
      modelState = derived.modelState;
    }
    if (!model) {
      return ctx.error(
        "rule",
        "The selected item has no 3D model. Upload a STEP file on the item's Model tab first."
      );
    }

    // A model that still needs converting can't become a usable instruction
    // while the geometry service is down: refuse rather than strand a record.
    const needsConversion =
      modelState === "convertible" || modelState === "failed";
    const assemblerHealthy = await service.isAssemblerServiceHealthy();
    if (needsConversion && !assemblerHealthy) {
      return service.geometryServiceDown(ctx, "model conversion");
    }

    const create = await service.upsertAssemblyInstruction(client, {
      name: derived.item.name || "Assembly",
      modelUploadId: model.id,
      itemId,
      companyId,
      createdBy: userId
    });
    if (create.error || !create.data?.id) {
      return ctx.error(
        "internal",
        "Failed to create assembly instruction",
        create.error
      );
    }

    // Lazy conversion: only a model used in an assembly is converted.
    if (needsConversion) {
      await trigger("assembly-convert", {
        companyId,
        modelUploadId: model.id,
        userId
      });
    } else if (modelState === "converted" && assemblerHealthy) {
      // A model converted before this instruction existed may have no plan
      // yet: start it, so it is ready by the time the steps are generated.
      const planJob = await service.getLatestAssemblyPlanJob(client, model.id);
      const planStatus = planJob.data?.status;
      if (
        planStatus !== "Success" &&
        planStatus !== "Processing" &&
        planStatus !== "Queued"
      ) {
        await service.startAssemblyPlan(ctx, model.id);
      }
    }

    return { id: create.data.id, autogen: modelState !== "none" };
  }
});

/**
 * Re-run motion planning for an instruction's model.
 *
 * @remarks
 * The model must be converted, the geometry service up and no plan running.
 * A stale Queued or Processing plan row (its event lost, or its worker gone)
 * is failed first so it can't shadow the new run. With steps, the plan keeps
 * their order and re-plans the motions; `fresh` (Regenerate Steps) plans from
 * scratch, re-detecting grouping, and is refused while a step is manually
 * authored or Done. `mode` says which run started.
 *
 * @mcp
 */
export const replanAssembly = defineServiceFn({
  input: z.object({ id: z.string(), fresh: z.boolean().default(false) }),
  permission: { update: "production" },

  async run(ctx, { id, fresh }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const instruction = await service.readInstructionModel(ctx, id);
    if (instruction instanceof CarbonError) return instruction;
    const { modelUploadId } = instruction;

    if (instruction.modelUpload?.processingStatus !== "Success") {
      return ctx.error(
        "rule",
        "The model must finish converting before planning"
      );
    }
    if (!(await service.isAssemblerServiceHealthy())) {
      return service.geometryServiceDown(ctx, "motion planning");
    }

    const planJob = await service.getLatestAssemblyPlanJob(
      client,
      modelUploadId
    );
    if (isAssemblyPlanRunning(planJob.data)) {
      return ctx.error("conflict", "Motion planning is already running");
    }
    if (
      planJob.data?.status === "Queued" ||
      planJob.data?.status === "Processing"
    ) {
      // Ruled non-live above: a Queued event never picked up, or a Processing
      // run whose worker is gone.
      await client
        .from("assemblyPlanJob")
        .update({
          status: "Failed",
          error:
            planJob.data.status === "Queued"
              ? "Planning never started — the job event was lost"
              : "Planning run was lost (worker restarted mid-run)",
          updatedAt: datetime.timestamp()
        })
        .eq("id", planJob.data.id)
        .eq("companyId", companyId);
    }

    const stepCount = await client
      .from("assemblyInstructionStep")
      .select("id", { count: "exact", head: true })
      .eq("assemblyInstructionId", id)
      .eq("companyId", companyId);
    const steps = stepCount.count ?? 0;

    // A regenerate replaces every step once the plan lands: refuse now,
    // rather than run the planner and only then fail.
    if (fresh && steps > 0) {
      const locked = await client
        .from("assemblyInstructionStep")
        .select("id", { count: "exact", head: true })
        .eq("assemblyInstructionId", id)
        .eq("companyId", companyId)
        .or("planConfidence.eq.manual,status.eq.Done");
      if ((locked.count ?? 0) > 0) {
        return ctx.error(
          "rule",
          "Some steps are manually authored or Done — reset or delete them before regenerating"
        );
      }
    }

    // `fresh` re-derives the auto-detected units too (the worker omits them
    // for this run); step generation swaps their rows once the plan lands.
    const keepsOrder = !fresh && steps > 0;
    await service.startAssemblyPlan(ctx, modelUploadId, {
      ...(keepsOrder ? { reMotionFor: id } : {}),
      ...(fresh ? { reDetectUnits: true } : {})
    });
    return {
      mode: keepsOrder ? "remotion" : fresh ? "fresh" : "plan"
    } as const;
  }
});

/**
 * Generate an instruction's steps from its model's motion plan.
 *
 * @remarks
 * `generate` needs an instruction with no steps; `regenerate` replaces them
 * and is refused while a step is manually authored or Done. With no plan yet
 * this starts one (planning is lazy) unless the model is still converting or a
 * plan is already running, and answers `planning: true`: the page polls and
 * submits again when the plan lands. Steps are seeded with the BOM items the
 * components map to; `unmappedComponentCount` is the components with none.
 *
 * @mcp destructive
 */
export const generateAssemblySteps = defineServiceFn({
  input: z.object({
    id: z.string(),
    mode: z.enum(["generate", "regenerate"]).default("generate")
  }),
  permission: { update: "production" },

  async run(ctx, { id, mode }) {
    // The service role: the auto-detected units it materializes need create
    // and delete under RLS, which an update-authorized caller may lack. Every
    // read and write is scoped to the company.
    const result = await service.generateAssemblyStepsFromPlan(
      ctx.asSystem.supabase,
      {
        assemblyInstructionId: id,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        mode
      }
    );
    if (result.ok) {
      return {
        planning: false,
        created: result.created,
        unmappedComponentCount: result.unmappedComponentCount ?? 0
      };
    }

    if (result.reason === "no-plan" && result.modelUploadId) {
      if (!(await service.isAssemblerServiceHealthy())) {
        return service.geometryServiceDown(ctx, "motion planning");
      }
      const [model, planJob] = await Promise.all([
        ctx.asSystem.supabase
          .from("modelUpload")
          .select("processingStatus")
          .eq("id", result.modelUploadId)
          .eq("companyId", ctx.company.id)
          .maybeSingle(),
        service.getLatestAssemblyPlanJob(
          ctx.asSystem.supabase,
          result.modelUploadId
        )
      ]);
      const isConverting =
        model.data?.processingStatus === "Queued" ||
        model.data?.processingStatus === "Processing";
      if (!isConverting && !isAssemblyPlanRunning(planJob.data)) {
        await service.startAssemblyPlan(ctx, result.modelUploadId);
      }
      return { planning: true, created: 0, unmappedComponentCount: 0 };
    }

    return ctx.error(
      "rule",
      result.reason === "steps-exist"
        ? "Steps already exist — delete them before generating from the plan"
        : result.reason === "steps-locked"
          ? (result.message ?? "Some steps are locked — cannot regenerate")
          : result.reason === "no-model"
            ? "This instruction has no processed model"
            : (result.message ?? "Failed to generate steps")
    );
  }
});

/**
 * Cancel an instruction's running model conversion or motion plan.
 *
 * @remarks
 * Fails the Processing job rows of that `kind`, then tells the geometry
 * service to stop them (best effort: without it, a finishing job would bring
 * the run back). Cancelling a conversion fails the model's conversion too.
 * `cancelled` is how many jobs were running.
 *
 * @mcp destructive
 */
export const cancelAssemblyJob = defineServiceFn({
  input: z.object({ id: z.string(), kind: z.enum(["convert", "plan"]) }),
  permission: { update: "production" },

  async run(ctx, { id, kind }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const instruction = await service.readInstructionModel(ctx, id);
    if (instruction instanceof CarbonError) return instruction;
    const { modelUploadId } = instruction;

    const cancelled = await client
      .from("assemblyPlanJob")
      .update({
        status: "Failed",
        error: "Cancelled by user",
        updatedAt: datetime.timestamp()
      })
      .eq("modelUploadId", modelUploadId)
      .eq("companyId", companyId)
      .eq("kind", kind)
      .eq("status", "Processing")
      .select("id");
    if (cancelled.error) {
      return ctx.error("internal", "Could not cancel the job", cancelled.error);
    }

    if (ASSEMBLER_SERVICE_URL && cancelled.data.length > 0) {
      await Promise.allSettled(
        cancelled.data.map((job) =>
          fetch(`${ASSEMBLER_SERVICE_URL}/v1/jobs/${job.id}/cancel`, {
            method: "POST",
            headers: ASSEMBLER_SERVICE_API_KEY
              ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
              : {},
            signal: AbortSignal.timeout(5000)
          })
        )
      );
    }

    if (kind === "convert") {
      await client
        .from("modelUpload")
        .update({
          processingStatus: "Failed",
          processingError: "Cancelled by user"
        })
        .eq("id", modelUploadId)
        .eq("companyId", companyId)
        .in("processingStatus", ["Queued", "Processing"]);
    }
    return { cancelled: cancelled.data.length };
  }
});

/**
 * Throw away an instruction's converted model and plans, and convert it
 * again from the source file.
 *
 * @mcp destructive
 */
export const reconvertAssemblyModel = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "production" },

  async run(ctx, { id }) {
    const instruction = await service.readInstructionModel(ctx, id);
    if (instruction instanceof CarbonError) return instruction;
    const invalidated = await service.invalidateAssemblyModelCache(
      ctx.asCaller.supabase,
      instruction.modelUploadId
    );
    if (invalidated.error) {
      return ctx.error(
        "internal",
        "Could not invalidate the model cache",
        invalidated.error
      );
    }
    await trigger("assembly-convert", {
      companyId: ctx.company.id,
      modelUploadId: instruction.modelUploadId,
      userId: ctx.auditUserId
    });
    return { modelUploadId: instruction.modelUploadId };
  }
});

/**
 * Convert an instruction's model that has not been converted, or whose last
 * conversion failed.
 *
 * @remarks
 * Refused while a conversion is running, for a converted model, for a format
 * the geometry service cannot convert (only STEP), and while the service is
 * down.
 *
 * @mcp
 */
export const convertAssemblyModel = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "production" },

  async run(ctx, { id }) {
    const instruction = await service.readInstructionModel(ctx, id);
    if (instruction instanceof CarbonError) return instruction;
    if (!instruction.modelUpload) {
      return ctx.error("notFound", "Could not find the instruction's model");
    }
    const modelState = getAssemblyModelState(instruction.modelUpload);
    if (modelState !== "convertible" && modelState !== "failed") {
      return ctx.error(
        "rule",
        modelState === "processing"
          ? "Model conversion is already in progress"
          : modelState === "converted"
            ? "The model is already converted"
            : "This model cannot be converted (only STEP files are supported)"
      );
    }
    if (!(await service.isAssemblerServiceHealthy())) {
      return service.geometryServiceDown(ctx, "model conversion");
    }
    await trigger("assembly-convert", {
      companyId: ctx.company.id,
      modelUploadId: instruction.modelUpload.id,
      userId: ctx.auditUserId
    });
    return { modelUploadId: instruction.modelUpload.id };
  }
});

/**
 * Match an instruction's model components to its item's bill of materials.
 *
 * @remarks
 * Strong name matches first, then unique quantity matches as low-confidence
 * fallbacks; existing mappings are kept. Then every step's materials are
 * backfilled from the full mapping set (additive: manual edits survive).
 * Returns how many components were mapped, the BOM lines left unmatched and
 * the step materials added.
 *
 * @mcp
 */
export const matchAssemblyBom = defineServiceFn({
  input: z.object({ id: z.string() }),
  permission: { update: "production" },

  async run(ctx, { id }) {
    const args = {
      assemblyInstructionId: id,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    };
    const result = await service.autoMatchAssemblyComponents(
      ctx.asCaller.supabase,
      args
    );
    if ("error" in result) return ctx.error("rule", result.error);
    const materials = await service.syncAssemblyStepMaterialsFromMappings(
      ctx.asCaller.supabase,
      args
    );
    return { ...result, materialsCreated: materials.created };
  }
});

/**
 * Map one model component (by geometry) to a BOM item.
 *
 * @remarks
 * A human-confirmed (high-confidence) mapping. The item flows onto every step
 * of the instruction that installs the component (additive).
 *
 * @mcp
 */
export const mapAssemblyComponent = defineServiceFn({
  input: z.object({
    id: z.string(),
    modelUploadId: z.string().min(1),
    geometryHash: z.string().min(1),
    itemId: z.string().min(1)
  }),
  permission: { update: "production" },

  async run(ctx, { id, modelUploadId, geometryHash, itemId }) {
    const owned = await service.requireOwnRecords(ctx, [
      ["modelUpload", modelUploadId, "model"],
      ["item", itemId, "item"]
    ]);
    if (owned) return owned;
    const upsert = await service.upsertAssemblyComponentMapping(
      ctx.asCaller.supabase,
      {
        modelUploadId,
        geometryHash,
        itemId,
        confidence: "high",
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      }
    );
    if (upsert.error) {
      return ctx.error("internal", "Failed to map part", upsert.error);
    }
    await service.syncAssemblyStepMaterialsFromMappings(ctx.asCaller.supabase, {
      assemblyInstructionId: id,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      geometryHashes: [geometryHash]
    });
    return { geometryHash };
  }
});

/**
 * Move, copy or remove model components between an instruction's steps.
 *
 * @remarks
 * `move` takes them off every other step, `duplicate` adds them to the target
 * and keeps them where they are, `remove` takes them off every step. One
 * transaction. The target step then gets the BOM items those components map
 * to.
 *
 * @mcp destructive
 */
export const reassignAssemblyComponents = defineServiceFn({
  input: assemblyStepComponentsReassignValidator.safeExtend({ id: z.string() }),
  permission: { update: "production" },

  async run(ctx, { id, targetStepId, componentNodeIds, mode }) {
    const moved = await service.catchInternal(
      ctx,
      "Failed to assign components",
      () =>
        service.reassignAssemblyStepComponents(ctx.asSystem.pg, {
          assemblyInstructionId: id,
          companyId: ctx.company.id,
          targetStepId,
          componentNodeIds,
          mode,
          updatedBy: ctx.auditUserId
        })
    );
    if (moved instanceof CarbonError) return moved;
    if (targetStepId) {
      await service.syncAssemblyStepMaterialsFromMappings(
        ctx.asCaller.supabase,
        {
          assemblyInstructionId: id,
          companyId: ctx.company.id,
          userId: ctx.auditUserId,
          stepIds: [targetStepId],
          onlyComponentNodeIds: componentNodeIds
        }
      );
    }
    return { id };
  }
});

/**
 * Set the model components a step installs.
 *
 * @remarks
 * The components added pull their mapped BOM items onto the step's materials
 * (additive: a removal or a manual material edit is left alone).
 *
 * @mcp
 */
export const setAssemblyStepComponents = defineServiceFn({
  input: z.object({
    id: z.string(),
    stepId: z.string(),
    componentNodeIds: z.array(z.string())
  }),
  permission: { update: "production" },

  async run(ctx, { id, stepId, componentNodeIds }) {
    const client = ctx.asCaller.supabase;
    const previous = await client
      .from("assemblyInstructionStep")
      .select("componentNodeIds")
      .eq("id", stepId)
      .eq("assemblyInstructionId", id)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (previous.error) {
      return ctx.error("internal", "Failed to read the step", previous.error);
    }
    if (!previous.data) return ctx.error("notFound", "Step not found");

    const update = await service.updateAssemblyStepComponents(client, {
      id: stepId,
      componentNodeIds,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update components", update.error);
    }

    const before = new Set(previous.data.componentNodeIds ?? []);
    const added = componentNodeIds.filter((nodeId) => !before.has(nodeId));
    if (added.length > 0) {
      await service.syncAssemblyStepMaterialsFromMappings(client, {
        assemblyInstructionId: id,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        stepIds: [stepId],
        onlyComponentNodeIds: added
      });
    }
    return { stepId };
  }
});

/**
 * Copy an instruction's steps into a job operation.
 *
 * @remarks
 * Refused when the operation's job is locked. Steps are matched by the
 * instruction step they came from: updated, inserted, or deleted when gone;
 * the operation's own steps are untouched. Each synced step's BOM parts,
 * slides and tools are linked from the operation's materials and tools.
 * Returns the counts, and the parts that had no matching material.
 *
 * @mcp destructive
 */
export const syncAssemblyToOperation = defineServiceFn({
  input: z.object({ id: z.string(), operationId: z.string().min(1) }),
  permission: { update: "production" },

  async run(ctx, { id, operationId }) {
    const operation = await ctx.asCaller.supabase
      .from("jobOperation")
      .select("id, job(status)")
      .eq("id", operationId)
      .eq("companyId", ctx.company.id)
      .maybeSingle();
    if (operation.error || !operation.data) {
      return ctx.error("notFound", "Operation not found", operation.error);
    }
    if (isJobLocked(operation.data.job?.status)) {
      return ctx.error(
        "rule",
        "This job is locked — steps can't be synced to it"
      );
    }
    try {
      return await service.syncAssemblyInstructionToOperation(ctx.asSystem.pg, {
        assemblyInstructionId: id,
        operationId,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error(
        "rule",
        err instanceof Error ? err.message : "Failed to sync assembly to BOP",
        err
      );
    }
  }
});
/**
 * Convert sales order lines to jobs
 *
 * @remarks
 * One job per lot (the item's batch size) for every Make to Order line of
 * order `orderId` that has no job yet, each with the line's configuration and
 * its quote line's method (the item's when the line was reconfigured). A line
 * whose item an unreleased change notice holds gets no job. A line that is
 * refused or fails is named in the refusal; the jobs made for the other lines
 * stay.
 *
 * @mcp
 */
export const convertSalesOrderLinesToJobs = defineServiceFn({
  input: z.object({ orderId: z.string() }),
  permission: { create: "production" },
  async run(ctx, { orderId }) {
    const companyId = ctx.company.id;
    const owned = await service.requireOwnRecords(ctx, [
      ["salesOrder", orderId, "sales order"]
    ]);
    if (owned) return owned;

    const lines = await ctx.asSystem.supabase
      .from("salesOrderLine")
      .select("itemId")
      .eq("salesOrderId", orderId)
      .eq("companyId", companyId)
      .not("itemId", "is", null);
    if (lines.error) {
      return ctx.error(
        "internal",
        "Failed to read the order lines",
        lines.error
      );
    }
    const unreleased = await getUnreleasedChangeOrderItems(
      ctx.asSystem.supabase,
      {
        itemIds: [...new Set(lines.data.map((line) => line.itemId!))],
        companyId
      }
    );
    if (unreleased.error) return ctx.error("internal", unreleased.error);

    const converted = await service.convertSalesOrderLinesToJobs(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        orderId,
        companyId,
        userId: ctx.auditUserId,
        refusedItems: new Map(
          unreleased.data.map((held) => [
            held.itemId,
            `${unreleasedChangeOrderItemsMessage([held])} A job cannot be made for it.`
          ])
        )
      }
    );
    if (converted.error) {
      return ctx.error(
        "rule",
        `Failed to convert sales order lines to jobs: ${
          typeof converted.error === "string"
            ? converted.error
            : converted.error.message
        }`,
        converted.error
      );
    }
    return { orderId };
  }
});

/**
 * Create a job for one sales order line.
 *
 * @remarks
 * The line must be on order `salesOrderId`, and the job's records this
 * company's; refused for an item an unreleased change notice holds and for a
 * Make to Asset item that cannot complete to an asset. The order line's
 * configuration wins over its quote line's, and a line reconfigured on the
 * order is built from the item, not the quote's method. Not published: the
 * sales order line's Jobs form.
 */
export const createSalesOrderLineJob = defineServiceFn({
  input: salesOrderToJobValidator.safeExtend({
    customFields: customFieldsInput
  }),
  permission: { create: "production" },
  async run(ctx, { id: _id, ...job }) {
    const companyId = ctx.company.id;
    const system = ctx.asSystem.supabase;
    const line = await system
      .from("salesOrderLine")
      .select("configuration")
      .eq("id", job.salesOrderLineId)
      .eq("salesOrderId", job.salesOrderId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (line.error) {
      return ctx.error("internal", "Failed to read the order line", line.error);
    }
    if (!line.data) {
      return ctx.error("notFound", "The sales order line could not be found.");
    }

    const refusal = await jobCreationRefusal(ctx, job);
    if (refusal) return refusal;

    const quoteLine = job.quoteLineId
      ? await system
          .from("quoteLine")
          .select("configuration")
          .eq("id", job.quoteLineId)
          .eq("companyId", companyId)
          .maybeSingle()
      : { data: null };
    const { configuration, reconfigured } = resolveJobConfiguration(
      line.data.configuration,
      quoteLine.data?.configuration
    );

    const created = await service.insertJob(
      system,
      ctx.asSystem.pg,
      {
        ...job,
        configuration:
          configuration ?? service.parseConfiguration(job.configuration),
        jobId: job.jobId || undefined,
        fixedAssetClassId: job.fixedAssetClassId || null,
        fixedAssetId: job.fixedAssetId || null,
        companyId,
        createdBy: ctx.auditUserId
      },
      {
        methodSource:
          job.quoteId && job.quoteLineId && !reconfigured
            ? "quoteLine"
            : "item",
        source: "salesOrder"
      }
    );
    if (created.error || !created.data) {
      return ctx.error("internal", "Failed to insert job", created.error);
    }
    return { id: created.data.id };
  }
});

/**
 * Delete job operation step
 *
 * @mcp destructive
 */
export const deleteJobOperationStep = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteJobOperationStep(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete job operation step slide
 *
 * @mcp destructive
 */
export const deleteJobOperationStepSlide = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteJobOperationStepSlide(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete job operation parameter
 *
 * @mcp destructive
 */
export const deleteJobOperationParameter = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteJobOperationParameter(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete job operation tool
 *
 * @mcp destructive
 */
export const deleteJobOperationTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteJobOperationTool(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Delete procedure
 *
 * @mcp destructive
 */
export const deleteProcedure = defineServiceFn({
  input: z.looseObject({ procedureId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteProcedure(
        ctx.asCaller.supabase,
        input.procedureId as never
      )
    );
  }
});

/**
 * Delete procedure step
 *
 * @mcp destructive
 */
export const deleteProcedureStep = defineServiceFn({
  input: z.looseObject({ procedureStepId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteProcedureStep(
        ctx.asCaller.supabase,
        input.procedureStepId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete procedure parameter
 *
 * @mcp destructive
 */
export const deleteProcedureParameter = defineServiceFn({
  input: z.looseObject({ procedureParameterId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteProcedureParameter(
        ctx.asCaller.supabase,
        input.procedureParameterId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete production event
 *
 * @mcp destructive
 */
export const deleteProductionEvent = defineServiceFn({
  input: z.looseObject({ productionEventId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteProductionEvent(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.productionEventId as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Delete production quantity
 *
 * @mcp destructive
 */
export const deleteProductionQuantity = defineServiceFn({
  input: z.looseObject({ productionQuantityId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteProductionQuantity(
        ctx.asCaller.supabase,
        input.productionQuantityId as never
      )
    );
  }
});

/**
 * Get active job operation by job id
 *
 * @mcp read
 */
export const getActiveJobOperationByJobId = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return await service.getActiveJobOperationByJobId(
      ctx.asCaller.supabase,
      input.jobId as never,
      ctx.company.id
    );
  }
});

/**
 * Get active job operations by location
 *
 * @mcp read
 */
export const getActiveJobOperationsByLocation = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    workCenterIds: z.array(z.string()).optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getActiveJobOperationsByLocation(
        ctx.asCaller.supabase,
        input.locationId,
        input.workCenterIds
      )
    );
  }
});

/**
 * Get jobs by date range
 *
 * @mcp read
 */
export const getJobsByDateRange = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    startDate: z.string(),
    endDate: z.string()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobsByDateRange(
        ctx.asCaller.supabase,
        input.locationId as never,
        input.startDate as never,
        input.endDate as never
      )
    );
  }
});

/**
 * Get unscheduled jobs
 *
 * @mcp read
 */
export const getUnscheduledJobs = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getUnscheduledJobs(
        ctx.asCaller.supabase,
        input.locationId as never
      )
    );
  }
});

/**
 * Get active production events
 *
 * @mcp read
 */
export const getActiveProductionEvents = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getActiveProductionEvents(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete scrap reason
 *
 * @mcp destructive
 */
export const deleteScrapReason = defineServiceFn({
  input: z.looseObject({ scrapReasonId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteScrapReason(
        ctx.asCaller.supabase,
        input.scrapReasonId as never
      )
    );
  }
});

/**
 * Delete failure mode
 *
 * @mcp destructive
 */
export const deleteFailureMode = defineServiceFn({
  input: z.looseObject({ failureModeId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteFailureMode(
        ctx.asCaller.supabase,
        input.failureModeId as never
      )
    );
  }
});

/**
 * Delete maintenance dispatch
 *
 * @mcp destructive
 */
export const deleteMaintenanceDispatch = defineServiceFn({
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaintenanceDispatch(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

/**
 * Delete maintenance dispatch event
 *
 * @mcp destructive
 */
export const deleteMaintenanceDispatchEvent = defineServiceFn({
  input: z.looseObject({ eventId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaintenanceDispatchEvent(
        ctx.asCaller.supabase,
        input.eventId as never
      )
    );
  }
});

/**
 * Delete maintenance schedule
 *
 * @mcp destructive
 */
export const deleteMaintenanceSchedule = defineServiceFn({
  input: z.looseObject({ scheduleId: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteMaintenanceSchedule(
        ctx.asCaller.supabase,
        input.scheduleId as never
      )
    );
  }
});

/**
 * Get demand projections
 *
 * @mcp read
 */
export const getDemandProjections = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    locationId: z.string(),
    periodIds: z.array(z.string())
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getDemandProjections(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get job documents
 *
 * @mcp read
 */
export const getJobDocuments = defineServiceFn({
  input: z.looseObject({
    id: z.string().nullable(),
    salesOrderLineId: z.string().nullable().optional(),
    quoteLineId: z.string().nullable().optional(),
    itemId: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return await service.getJobDocuments(
      ctx.asCaller.supabase,
      ctx.company.id,
      payload(ctx, input).build() as never
    );
  }
});

/**
 * Get job documents with item id
 *
 * @mcp read
 */
export const getJobDocumentsWithItemId = defineServiceFn({
  input: z.looseObject({
    job: z.looseObject({
      id: z.string().nullable(),
      salesOrderLineId: z.string().nullable(),
      quoteLineId: z.string().nullable()
    }),
    itemId: z.string()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return await service.getJobDocumentsWithItemId(
      ctx.asCaller.supabase,
      ctx.company.id,
      payload(ctx, input.job).build() as never,
      input.itemId as never
    );
  }
});

/**
 * Get job
 *
 * @mcp read
 */
export const getJob = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJob(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get job expedite forecast
 *
 * @mcp read
 */
export const getJobExpediteForecast = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobExpediteForecast(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        input.jobId as never,
        ctx.company.id,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Get job by operation id
 *
 * @mcp read
 */
export const getJobByOperationId = defineServiceFn({
  input: z.looseObject({ operationId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobByOperationId(
        ctx.asCaller.supabase,
        input.operationId as never
      )
    );
  }
});

/**
 * Get job purchase order lines
 *
 * @mcp read
 */
export const getJobPurchaseOrderLines = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobPurchaseOrderLines(
        ctx.asCaller.supabase,
        input.jobId as never
      )
    );
  }
});

/**
 * The Outbound report: open jobs at a location that fill a sales order, with
 * where each one ships, ordered by the plant-calendar day they complete.
 *
 * @mcp read
 */
export const getCompletionJobs = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    timeZone: z.string(),
    throughDate: z.string().nullable(),
    search: z.string().nullable()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCompletionJobs(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get capacity reservations for resources
 *
 * @mcp read
 */
export const getCapacityReservationsForResources = defineServiceFn({
  input: z.looseObject({
    locationId: z.string().optional(),
    window: z
      .looseObject({ from: z.string(), to: z.string() })
      .describe(
        "Explicit [from, to) instant window (ISO strings) for the resource Gantt's day/week/shift views — returns reservations that OVERLAP it. Omit to keep the default forward horizon (everything ending within the last day onward)."
      )
      .optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getCapacityReservationsForResources(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never,
        payload(ctx, input.window).build() as never
      )
    );
  }
});

/**
 * Get maintenance downtime for resources
 *
 * @mcp read
 */
export const getMaintenanceDowntimeForResources = defineServiceFn({
  input: z.looseObject({ locationId: z.string().optional() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceDowntimeForResources(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get jobs
 *
 * @mcp read
 */
export const getJobs = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getJobs(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get jobs by sales order line
 *
 * @mcp read
 */
export const getJobsBySalesOrderLine = defineServiceFn({
  input: z.looseObject({ salesOrderLineId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobsBySalesOrderLine(
        ctx.asCaller.supabase,
        input.salesOrderLineId as never
      )
    );
  }
});

/**
 * Get jobs list
 *
 * @mcp read
 */
export const getJobsList = defineServiceFn({
  input: z.looseObject({
    statuses: z
      .array(
        z.enum([
          "Draft",
          "Ready",
          "In Progress",
          "Paused",
          "Completed",
          "Cancelled",
          "Overdue",
          "Due Today",
          "Planned",
          "Closed"
        ])
      )
      .optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobsList(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input.statuses).build() as never
      )
    );
  }
});

/**
 * Get job make method by id
 *
 * @mcp read
 */
export const getJobMakeMethodById = defineServiceFn({
  input: z.looseObject({ jobMakeMethodId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobMakeMethodById(
        ctx.asCaller.supabase,
        input.jobMakeMethodId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get root make method
 *
 * @mcp read
 */
export const getRootMakeMethod = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getRootMakeMethod(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get job materials with quantity on hand
 *
 * @mcp read
 */
export const getJobMaterialsWithQuantityOnHand = defineServiceFn({
  input: z.looseObject({
    jobId: z.string(),
    locationId: z.string(),
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobMaterialsWithQuantityOnHand(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id,
        input.locationId as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get job material item ids
 *
 * @mcp read
 */
export const getJobMaterialItemIds = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobMaterialItemIds(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get job order status map
 *
 * @mcp read
 */
export const getJobOrderStatusMap = defineServiceFn({
  input: z.looseObject({
    jobId: z.string(),
    locationId: z.string(),
    jobStatus: z.string().nullable(),
    materials: z.array(
      z.looseObject({
        description: z.string(),
        estimatedQuantity: z.number(),
        id: z.string(),
        itemReadableId: z.string(),
        itemScrapPercentage: z.number(),
        itemTrackingType: z.enum([
          "Inventory",
          "Non-Inventory",
          "Serial",
          "Batch"
        ]),
        jobMakeMethodId: z.string(),
        jobMaterialItemId: z.string(),
        methodType: z.enum([
          "Purchase to Order",
          "Pull from Inventory",
          "Make to Order"
        ]),
        name: z.string(),
        quantityFromProductionOrderInStorageUnit: z.number(),
        quantityFromProductionOrderNotInStorageUnit: z.number(),
        quantityInTransitToStorageUnit: z.number(),
        quantityIssued: z.number(),
        quantityOnHandInStorageUnit: z.number(),
        quantityOnHandNotInStorageUnit: z.number(),
        quantityOnProductionOrder: z.number(),
        quantityOnPurchaseOrder: z.number(),
        quantityOnSalesOrder: z.number(),
        quantityPerParent: z.number(),
        storageUnitId: z.string(),
        storageUnitName: z.string(),
        substitutedFromItemId: z.string(),
        thumbnailPath: z.string(),
        type: z.enum([
          "Part",
          "Service",
          "Material",
          "Tool",
          "Fixture",
          "Consumable"
        ]),
        unitOfMeasureCode: z.string()
      })
    ),
    asOfDate: z.string().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return await service.getJobOrderStatusMap(
      ctx.asCaller.supabase,
      input.jobId as never,
      ctx.company.id,
      input.locationId as never,
      input.jobStatus as never,
      payload(ctx, input.materials).build() as never,
      input.asOfDate as never
    );
  }
});

/**
 * Get job method tree
 *
 * @mcp read
 */
export const getJobMethodTree = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await utils.getJobMethodTree(ctx.asCaller.supabase, input.jobId as never)
    );
  }
});

/**
 * Get job materials by method id
 *
 * @mcp read
 */
export const getJobMaterialsByMethodId = defineServiceFn({
  input: z.looseObject({ jobMakeMethodId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobMaterialsByMethodId(
        ctx.asCaller.supabase,
        input.jobMakeMethodId as never
      )
    );
  }
});

/**
 * Get job operations
 *
 * @mcp read
 */
export const getJobOperations = defineServiceFn({
  input: z.looseObject({
    jobId: z.string(),
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getJobOperations(
        ctx.asCaller.supabase,
        input.jobId as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get job operation dependencies
 *
 * @mcp read
 */
export const getJobOperationDependencies = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobOperationDependencies(
        ctx.asCaller.supabase,
        input.jobId as never
      )
    );
  }
});

/**
 * Get job operation attachments
 *
 * @mcp read
 */
export const getJobOperationAttachments = defineServiceFn({
  input: z.looseObject({ jobOperationIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return await service.getJobOperationAttachments(
      ctx.asCaller.supabase,
      payload(ctx, input.jobOperationIds).build() as never
    );
  }
});

/**
 * Get job operations list
 *
 * @mcp read
 */
export const getJobOperationsList = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobOperationsList(
        ctx.asCaller.supabase,
        input.jobId as never
      )
    );
  }
});

/**
 * Get job operations by method id
 *
 * @mcp read
 */
export const getJobOperationsByMethodId = defineServiceFn({
  input: z.looseObject({ jobMakeMethodId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobOperationsByMethodId(
        ctx.asCaller.supabase,
        input.jobMakeMethodId as never
      )
    );
  }
});

/**
 * Get job operation step records
 *
 * @mcp read
 */
export const getJobOperationStepRecords = defineServiceFn({
  input: z.looseObject({
    jobId: z.string(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getJobOperationStepRecords(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get outside operations by job id
 *
 * @mcp read
 */
export const getOutsideOperationsByJobId = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getOutsideOperationsByJobId(
        ctx.asCaller.supabase,
        input.jobId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get procedure
 *
 * @mcp read
 */
export const getProcedure = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProcedure(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get procedure versions
 *
 * @mcp read
 */
export const getProcedureVersions = defineServiceFn({
  input: z.looseObject({ name: z.string(), version: z.number() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProcedureVersions(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get procedures
 *
 * @mcp read
 */
export const getProcedures = defineServiceFn({
  input: z.looseObject({
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getProcedures(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get procedures list
 *
 * @mcp read
 */
export const getProceduresList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getProceduresList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get production event
 *
 * @mcp read
 */
export const getProductionEvent = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProductionEvent(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get production events
 *
 * @mcp read
 */
export const getProductionEvents = defineServiceFn({
  input: z.looseObject({
    jobOperationIds: z.array(z.string()),
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getProductionEvents(
        ctx.asCaller.supabase,
        payload(ctx, input.jobOperationIds).build() as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get production planning
 *
 * @mcp read
 */
export const getProductionPlanning = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    periods: z.array(z.string()),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    asOf: z.string(),
    actionTypes: z.array(z.string()).optional(),
    actionAssignees: z.array(z.string()).optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getProductionPlanning(
        ctx.asCaller.supabase,
        input.locationId as never,
        ctx.company.id,
        payload(ctx, input.periods).build() as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get production projections
 *
 * @mcp read
 */
export const getProductionProjections = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    periods: z.array(z.string()),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getProductionProjections(
        ctx.asCaller.supabase,
        input.locationId as never,
        payload(ctx, input.periods).build() as never,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get production quantity
 *
 * @mcp read
 */
export const getProductionQuantity = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getProductionQuantity(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get production quantities
 *
 * @mcp read
 */
export const getProductionQuantities = defineServiceFn({
  input: z.looseObject({
    jobOperationIds: z.array(z.string()),
    search: z.string().nullable().optional(),
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0)
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getProductionQuantities(
        ctx.asCaller.supabase,
        payload(ctx, input.jobOperationIds).build() as never,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get production data by operations
 *
 * @mcp read
 */
export const getProductionDataByOperations = defineServiceFn({
  input: z.looseObject({ jobOperationIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return await service.getProductionDataByOperations(
      ctx.asCaller.supabase,
      payload(ctx, input.jobOperationIds).build() as never
    );
  }
});

/**
 * Get scrap reasons list
 *
 * @mcp read
 */
export const getScrapReasonsList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getScrapReasonsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get scrap reason
 *
 * @mcp read
 */
export const getScrapReason = defineServiceFn({
  input: z.looseObject({ scrapReasonId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getScrapReason(
        ctx.asCaller.supabase,
        input.scrapReasonId as never
      )
    );
  }
});

/**
 * Get scrap reasons
 *
 * @mcp read
 */
export const getScrapReasons = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getScrapReasons(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get failure mode
 *
 * @mcp read
 */
export const getFailureMode = defineServiceFn({
  input: z.looseObject({ failureModeId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getFailureMode(
        ctx.asCaller.supabase,
        input.failureModeId as never
      )
    );
  }
});

/**
 * Get failure modes
 *
 * @mcp read
 */
export const getFailureModes = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getFailureModes(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get failure modes list
 *
 * @mcp read
 */
export const getFailureModesList = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getFailureModesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get maintenance dispatch
 *
 * @mcp read
 */
export const getMaintenanceDispatch = defineServiceFn({
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceDispatch(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

/**
 * Get maintenance dispatch comments
 *
 * @mcp read
 */
export const getMaintenanceDispatchComments = defineServiceFn({
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceDispatchComments(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

/**
 * Get maintenance dispatch events
 *
 * @mcp read
 */
export const getMaintenanceDispatchEvents = defineServiceFn({
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceDispatchEvents(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

/**
 * Get maintenance dispatch items
 *
 * @mcp read
 */
export const getMaintenanceDispatchItems = defineServiceFn({
  input: z.looseObject({ dispatchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceDispatchItems(
        ctx.asCaller.supabase,
        input.dispatchId as never
      )
    );
  }
});

/**
 * Get maintenance schedule
 *
 * @mcp read
 */
export const getMaintenanceSchedule = defineServiceFn({
  input: z.looseObject({ scheduleId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getMaintenanceSchedule(
        ctx.asCaller.supabase,
        input.scheduleId as never
      )
    );
  }
});

/**
 * Get tracked entity by job id
 *
 * @mcp read
 */
export const getTrackedEntityByJobId = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTrackedEntityByJobId(
        ctx.asCaller.supabase,
        input.jobId as never
      )
    );
  }
});

/**
 * Get tracked entities by job id
 *
 * @mcp read
 */
export const getTrackedEntitiesByJobId = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getTrackedEntitiesByJobId(
        ctx.asCaller.supabase,
        input.jobId as never
      )
    );
  }
});

/**
 * What a job has already received to inventory: its received quantity and the tracked entities its receipts posted
 *
 * @mcp read
 */
export const getJobReceiptSnapshot = defineServiceFn({
  input: z.looseObject({ jobId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return await service.getJobReceiptSnapshot(
      ctx.asSystem.pg,
      input.jobId as never,
      ctx.company.id
    );
  }
});

/**
 * Recalculate job requirements
 *
 * @mcp
 */
export const recalculateJobRequirements = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.recalculateJobRequirements(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        payload(ctx, input).withUser().forUpdate() as never
      )
    );
  }
});

/**
 * Run MRP
 *
 * @remarks
 * Plans the whole company whatever `type` and `id` name (they are logged),
 * and rewrites its forecasts and planning actions. It reads with the service
 * role, as every MRP run does: a caller's partial view would plan from part of
 * the demand. The planning pages' Recalculate (`api+/mrp.ts`) needs the same
 * inventory update.
 *
 * @mcp
 */
export const runMRP = defineServiceFn({
  input: z.object({
    type: z.enum([
      "company",
      "location",
      "job",
      "salesOrder",
      "item",
      "purchaseOrder"
    ]),
    id: z.string()
  }),
  permission: { update: "inventory" },
  async run(ctx, { type, id }) {
    return unwrap(
      ctx,
      await service.runMRP(ctx.asSystem.supabase, ctx.asSystem.pg, {
        type,
        id,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
    );
  }
});

/**
 * Update job batch number
 *
 * @mcp
 */
export const updateJobBatchNumber = defineServiceFn({
  input: z.looseObject({
    trackedEntityId: z.string(),
    value: z.string().nullable()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateJobBatchNumber(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.trackedEntityId as never,
        input.value as never
      )
    );
  }
});

/**
 * Get job release readiness
 *
 * @mcp read
 */
export const getJobReleaseReadiness = defineServiceFn({
  input: z.looseObject({ jobIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobReleaseReadiness(
        ctx.asCaller.supabase,
        input.jobIds,
        ctx.company.id
      )
    );
  }
});

/**
 * Update job material order
 *
 * @mcp
 */
export const updateJobMaterialOrder = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), order: z.number() }))
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      ...(await service.updateJobMaterialOrder(
        ctx.asCaller.supabase,
        payload(ctx, input.updates).forUpdate() as never
      ))
    );
  }
});

/**
 * Update job operation step order
 *
 * @mcp
 */
export const updateJobOperationStepOrder = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      ...(await service.updateJobOperationStepOrder(
        ctx.asCaller.supabase,
        payload(ctx, input.updates).forUpdate() as never
      ))
    );
  }
});

/**
 * Update kanban job
 *
 * @mcp
 */
export const updateKanbanJob = defineServiceFn({
  input: z.looseObject({ id: z.string(), jobId: z.string().nullable() }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateKanbanJob(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpdate() as never
      )
    );
  }
});

const stepOrderInput = z.object({
  operationId: z.string(),
  updates: z.array(z.object({ id: z.string(), sortOrder: z.number() })).min(1)
});

/**
 * Reorder the steps of a quote line's operation.
 *
 * @remarks
 * All or nothing: a step that is not on `operationId` refuses the whole
 * reorder. Needs sales update, as the quote's method editor does, and
 * production update, which the step rows require.
 *
 * @mcp
 */
export const updateQuoteOperationStepOrder = defineServiceFn({
  input: stepOrderInput,
  permission: { update: ["sales", "production"] },
  async run(ctx, { operationId, updates }) {
    await updateSortOrder(ctx.asSystem.pg, {
      table: "quoteOperationStep",
      column: "sortOrder",
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      parent: { column: "operationId", id: operationId },
      updates
    });
    return { operationId };
  }
});

/**
 * Reorder the steps of an item's make method operation.
 *
 * @remarks
 * Refused unless the method is a Draft, when the item's revision is released
 * and release control enforces it, and while a change notice holds the
 * method. All or nothing: a step that is not on `operationId` refuses the
 * whole reorder. Needs parts update, as the method editor does, and
 * production update, which the step rows require.
 *
 * @mcp
 */
export const updateMethodOperationStepOrder = defineServiceFn({
  input: stepOrderInput,
  permission: { update: ["parts", "production"] },
  async run(ctx, { operationId, updates }) {
    const lock = await checkRevisionLock(ctx.asCaller.supabase, {
      kind: "operation",
      id: operationId,
      companyId: ctx.company.id
    });
    if (!lock.ok) return ctx.error("rule", lock.message);
    const refusal = await methodStepRefusal(
      ctx.asCaller.supabase,
      ctx.company.id,
      { operationId }
    );
    if (refusal) return ctx.error("rule", refusal);
    await updateSortOrder(ctx.asSystem.pg, {
      table: "methodOperationStep",
      column: "sortOrder",
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      parent: { column: "operationId", id: operationId },
      updates
    });
    return withLockNotice(lock, { operationId });
  }
});

/**
 * Update procedure step order
 *
 * @mcp
 */
export const updateProcedureStepOrder = defineServiceFn({
  input: z.looseObject({
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      ...(await service.updateProcedureStepOrder(
        ctx.asCaller.supabase,
        payload(ctx, input.updates).forUpdate() as never
      ))
    );
  }
});

/**
 * Create a job for an item.
 *
 * @remarks
 * Draft unless `status` is Planned; a job reaches the floor only through its
 * release. The records it names must be this company's, and it is refused for
 * an item an unreleased change notice holds and for a Make to Asset item that
 * cannot complete to an asset, as `createJob` is. `options.source` is
 * telemetry only: it records which surface raised the job.
 *
 * @mcp
 */
export const insertJob = defineServiceFn({
  input: z.looseObject({
    itemId: z.string(),
    quantity: z.number(),
    jobId: z.string().optional(),
    locationId: z.string().optional(),
    dueDate: z.string().optional(),
    startDate: z.string().optional(),
    priority: z.number().optional(),
    status: z.enum(["Draft", "Planned"]).optional(),
    deadlineType: z
      .enum(["ASAP", "Hard Deadline", "Soft Deadline", "No Deadline"])
      .optional(),
    storageUnitId: z.string().optional(),
    unitOfMeasureCode: z.string().optional(),
    customerId: z.string().optional(),
    salesOrderId: z.string().optional(),
    salesOrderLineId: z.string().optional(),
    quoteId: z.string().optional(),
    quoteLineId: z.string().optional(),
    modelUploadId: z.string().optional(),
    notes: z.string().optional(),
    customFields: z.unknown().optional(),
    configuration: z.record(z.string(), z.unknown()).optional(),
    fixedAssetClassId: z.string().nullable().optional(),
    fixedAssetId: z.string().nullable().optional(),
    options: z
      .looseObject({
        skipMethod: z.boolean().optional(),
        skipRecalculate: z.boolean().optional(),
        methodSource: z.enum(["item", "quoteLine"]).optional(),
        source: z
          .enum([
            "salesOrder",
            "kanban",
            "workflow",
            "unknown",
            "erp",
            "bulk",
            "mrp",
            "api"
          ])
          .nullable()
          .optional()
      })
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, { options, ...job }) {
    const refusal = await jobCreationRefusal(ctx, job);
    if (refusal) return refusal;
    return unwrap(
      ctx,
      await service.insertJob(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        {
          ...job,
          customFields: job.customFields as Json | undefined,
          companyId: ctx.company.id,
          createdBy: ctx.auditUserId
        },
        options as never
      )
    );
  }
});

/**
 * Create a job operation step
 *
 * @remarks
 * Upsert job operation step
 *
 * @mcp
 */
export const createJobOperationStep = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    type: z.enum([
      "Task",
      "Value",
      "Measurement",
      "Checkbox",
      "Timestamp",
      "Person",
      "List",
      "File",
      "Inspection"
    ]),
    unitOfMeasureCode: z.string().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    listValues: z.array(z.string()).optional(),
    sortOrder: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertJobOperationStep(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a job operation step
 *
 * @remarks
 * Upsert job operation step
 *
 * @mcp
 */
export const updateJobOperationStep = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      type: z.enum([
        "Task",
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Inspection"
      ]),
      unitOfMeasureCode: z.string().optional(),
      minValue: z.number().nullable().optional(),
      maxValue: z.number().nullable().optional(),
      listValues: z.array(z.string()).optional(),
      sortOrder: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertJobOperationStep(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Duplicate job operation step
 *
 * @mcp
 */
export const duplicateJobOperationStep = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.duplicateJobOperationStep(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Create a job operation step slide
 *
 * @remarks
 * Upsert job operation step slide
 *
 * @mcp
 */
export const createJobOperationStepSlide = defineServiceFn({
  input: z.looseObject({
    stepId: z.string().min(1),
    imagePath: z.string().optional(),
    modelUploadId: z.string().optional(),
    caption: z.string().optional(),
    sortOrder: z.number().min(0).optional(),
    size: z.enum(["small", "medium", "large"]).optional(),
    annotations: z
      .array(
        z.looseObject({
          id: z.string(),
          x: z.number(),
          y: z.number(),
          label: z.string().nullable().optional(),
          color: z.string().nullable().optional(),
          toolId: z.string().nullable().optional()
        })
      )
      .nullable()
      .optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertJobOperationStepSlide(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a job operation step slide
 *
 * @remarks
 * Upsert job operation step slide
 *
 * @mcp
 */
export const updateJobOperationStepSlide = defineServiceFn({
  input: z
    .looseObject({
      stepId: z.string().min(1),
      imagePath: z.string().optional(),
      modelUploadId: z.string().optional(),
      caption: z.string().optional(),
      sortOrder: z.number().min(0).optional(),
      size: z.enum(["small", "medium", "large"]).optional(),
      annotations: z
        .array(
          z.looseObject({
            id: z.string(),
            x: z.number(),
            y: z.number(),
            label: z.string().nullable().optional(),
            color: z.string().nullable().optional(),
            toolId: z.string().nullable().optional()
          })
        )
        .nullable()
        .optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertJobOperationStepSlide(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a job operation parameter
 *
 * @remarks
 * Upsert job operation parameter
 *
 * @mcp
 */
export const createJobOperationParameter = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    key: z.string().min(1),
    value: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertJobOperationParameter(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a job operation parameter
 *
 * @remarks
 * Upsert job operation parameter
 *
 * @mcp
 */
export const updateJobOperationParameter = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertJobOperationParameter(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a job operation tool
 *
 * @remarks
 * Upsert job operation tool
 *
 * @mcp
 */
export const createJobOperationTool = defineServiceFn({
  input: z.looseObject({
    operationId: z.string().min(1),
    toolId: z.string().min(1),
    quantity: z.number().min(0.000001),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertJobOperationTool(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a job operation tool
 *
 * @remarks
 * Upsert job operation tool
 *
 * @mcp
 */
export const updateJobOperationTool = defineServiceFn({
  input: z
    .looseObject({
      operationId: z.string().min(1),
      toolId: z.string().min(1),
      quantity: z.number().min(0.000001),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertJobOperationTool(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Set job material step link
 *
 * @mcp destructive
 */
export const setJobMaterialStepLink = defineServiceFn({
  input: z.looseObject({
    jobMaterialId: z.string(),
    jobOperationStepId: z.string(),
    linked: z.boolean(),
    quantity: z.number().nullable().optional()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.setJobMaterialStepLink(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Set job operation tool step link
 *
 * @mcp destructive
 */
export const setJobOperationToolStepLink = defineServiceFn({
  input: z.looseObject({
    operationId: z.string(),
    toolId: z.string(),
    jobOperationStepId: z.string(),
    linked: z.boolean()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.setJobOperationToolStepLink(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

const saveMethodInput = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  parts: methodPartsInput.optional()
});

/**
 * Save a job's method onto an item's make method (Save Method).
 *
 * @remarks
 * Overwrites make method `targetId` with job `sourceId`'s root method, the
 * parts `parts` names. Needs parts update, since it rewrites the item's bill
 * of material and process, and is refused under the same revision lock.
 *
 * @mcp destructive
 */
export const upsertMakeMethodFromJob = defineServiceFn({
  input: saveMethodInput,
  permission: { update: ["production", "parts"] },
  async run(ctx, input) {
    const refusal = await saveMethodRefusal(ctx, input.targetId);
    if (refusal) return refusal;
    return unwrap(
      ctx,
      await service.upsertMakeMethodFromJob(
        ctx.asSystem.supabase,
        ctx.asSystem.pg,
        { ...input, companyId: ctx.company.id, userId: ctx.auditUserId }
      )
    );
  }
});

/**
 * Save a job's sub-assembly method onto an item's make method.
 *
 * @remarks
 * Overwrites make method `targetId` with job make method `sourceId`, the
 * parts `parts` names. Needs parts update and is refused under the same
 * revision lock as `upsertMakeMethodFromJob`.
 *
 * @mcp destructive
 */
export const upsertMakeMethodFromJobMethod = defineServiceFn({
  input: saveMethodInput,
  permission: { update: ["production", "parts"] },
  async run(ctx, input) {
    const refusal = await saveMethodRefusal(ctx, input.targetId);
    if (refusal) return refusal;
    return unwrap(
      ctx,
      await service.upsertMakeMethodFromJobMethod(
        ctx.asSystem.supabase,
        ctx.asSystem.pg,
        { ...input, companyId: ctx.company.id, userId: ctx.auditUserId }
      )
    );
  }
});

/**
 * Create a procedure
 *
 * @remarks
 * Upsert procedure
 *
 * @mcp
 */
export const createProcedure = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    version: z.number().min(0),
    processId: z.string().optional(),
    content: z.string().optional(),
    copyFromId: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertProcedure(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a procedure
 *
 * @remarks
 * Upsert procedure
 *
 * @mcp
 */
export const updateProcedure = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      version: z.number().min(0),
      processId: z.string().optional(),
      content: z.string().optional(),
      copyFromId: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertProcedure(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a procedure step
 *
 * @remarks
 * Upsert procedure step
 *
 * @mcp
 */
export const createProcedureStep = defineServiceFn({
  input: z.looseObject({
    procedureId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    type: z.enum([
      "Task",
      "Value",
      "Measurement",
      "Checkbox",
      "Timestamp",
      "Person",
      "List",
      "File",
      "Inspection"
    ]),
    unitOfMeasureCode: z.string().optional(),
    minValue: z.number().min(0).optional(),
    maxValue: z.number().min(0).optional(),
    listValues: z.array(z.string()).optional(),
    sortOrder: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertProcedureStep(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a procedure step
 *
 * @remarks
 * Upsert procedure step
 *
 * @mcp
 */
export const updateProcedureStep = defineServiceFn({
  input: z
    .looseObject({
      procedureId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      type: z.enum([
        "Task",
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Inspection"
      ]),
      unitOfMeasureCode: z.string().optional(),
      minValue: z.number().min(0).optional(),
      maxValue: z.number().min(0).optional(),
      listValues: z.array(z.string()).optional(),
      sortOrder: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertProcedureStep(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a procedure parameter
 *
 * @remarks
 * Upsert procedure parameter
 *
 * @mcp
 */
export const createProcedureParameter = defineServiceFn({
  input: z.looseObject({
    procedureId: z.string().min(1),
    key: z.string().min(1),
    value: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertProcedureParameter(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a procedure parameter
 *
 * @remarks
 * Upsert procedure parameter
 *
 * @mcp
 */
export const updateProcedureParameter = defineServiceFn({
  input: z
    .looseObject({
      procedureId: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertProcedureParameter(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a scrap reason
 *
 * @remarks
 * Upsert scrap reason
 *
 * @mcp
 */
export const createScrapReason = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertScrapReason(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a scrap reason
 *
 * @remarks
 * Upsert scrap reason
 *
 * @mcp
 */
export const updateScrapReason = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertScrapReason(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a failure mode
 *
 * @remarks
 * Upsert failure mode
 *
 * @mcp
 */
export const createFailureMode = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertFailureMode(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a failure mode
 *
 * @remarks
 * Upsert failure mode
 *
 * @mcp
 */
export const updateFailureMode = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertFailureMode(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a maintenance dispatch comment
 *
 * @remarks
 * Upsert maintenance dispatch comment
 *
 * @mcp
 */
export const createMaintenanceDispatchComment = defineServiceFn({
  input: z.looseObject({
    maintenanceDispatchId: z.string().min(1),
    comment: z.string().min(1),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaintenanceDispatchComment(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a maintenance dispatch comment
 *
 * @remarks
 * Upsert maintenance dispatch comment
 *
 * @mcp
 */
export const updateMaintenanceDispatchComment = defineServiceFn({
  input: z
    .looseObject({
      maintenanceDispatchId: z.string().min(1),
      comment: z.string().min(1),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaintenanceDispatchComment(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a maintenance dispatch event
 *
 * @remarks
 * Upsert maintenance dispatch event
 *
 * @mcp
 */
export const createMaintenanceDispatchEvent = defineServiceFn({
  input: z.looseObject({
    maintenanceDispatchId: z.string().min(1),
    employeeId: z.string().min(1),
    workCenterId: z.string().min(1),
    startTime: z.string().min(1),
    endTime: z.string().optional(),
    notes: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaintenanceDispatchEvent(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a maintenance dispatch event
 *
 * @remarks
 * Upsert maintenance dispatch event
 *
 * @mcp
 */
export const updateMaintenanceDispatchEvent = defineServiceFn({
  input: z
    .looseObject({
      maintenanceDispatchId: z.string().min(1),
      employeeId: z.string().min(1),
      workCenterId: z.string().min(1),
      startTime: z.string().min(1),
      endTime: z.string().optional(),
      notes: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaintenanceDispatchEvent(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a maintenance dispatch item
 *
 * @remarks
 * Upsert maintenance dispatch item
 *
 * @mcp
 */
export const createMaintenanceDispatchItem = defineServiceFn({
  input: z.looseObject({
    maintenanceDispatchId: z.string().min(1),
    itemId: z.string().min(1),
    quantity: z.number().min(1),
    unitOfMeasureCode: z.string().min(1),
    unitCost: z.number().min(0).optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaintenanceDispatchItem(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a maintenance dispatch item
 *
 * @remarks
 * Upsert maintenance dispatch item
 *
 * @mcp
 */
export const updateMaintenanceDispatchItem = defineServiceFn({
  input: z
    .looseObject({
      maintenanceDispatchId: z.string().min(1),
      itemId: z.string().min(1),
      quantity: z.number().min(1),
      unitOfMeasureCode: z.string().min(1),
      unitCost: z.number().min(0).optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaintenanceDispatchItem(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Create a maintenance schedule
 *
 * @remarks
 * Upsert maintenance schedule
 *
 * @mcp
 */
export const createMaintenanceSchedule = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    description: z.string().optional(),
    workCenterId: z.string().min(1),
    frequency: z.enum(["Daily", "Weekly", "Monthly", "Quarterly", "Annual"]),
    priority: z.enum(["Low", "Medium", "High", "Critical"]),
    estimatedDuration: z.number().optional(),
    active: z.boolean().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaintenanceSchedule(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a maintenance schedule
 *
 * @remarks
 * Upsert maintenance schedule
 *
 * @mcp
 */
export const updateMaintenanceSchedule = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      description: z.string().optional(),
      workCenterId: z.string().min(1),
      frequency: z.enum(["Daily", "Weekly", "Monthly", "Quarterly", "Annual"]),
      priority: z.enum(["Low", "Medium", "High", "Critical"]),
      estimatedDuration: z.number().optional(),
      active: z.boolean().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertMaintenanceSchedule(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Get people assignments
 *
 * @mcp read
 */
export const getPeopleAssignments = defineServiceFn({
  input: z.looseObject({ locationId: z.string(), date: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPeopleAssignments(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get people absences
 *
 * @mcp read
 */
export const getPeopleAbsences = defineServiceFn({
  input: z.looseObject({ date: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPeopleAbsences(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.date as never
      )
    );
  }
});

/**
 * Get people assignments range
 *
 * @mcp read
 */
export const getPeopleAssignmentsRange = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    startDate: z.string(),
    endDate: z.string()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPeopleAssignmentsRange(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get people absences range
 *
 * @mcp read
 */
export const getPeopleAbsencesRange = defineServiceFn({
  input: z.looseObject({ startDate: z.string(), endDate: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPeopleAbsencesRange(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Open job-operation hours per work center for the capacity view
 *
 * @mcp read
 */
export const getPeopleCapacityOperations = defineServiceFn({
  input: z.looseObject({
    locationId: z.string(),
    startDate: z.string().nullable(),
    endDate: z.string()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getPeopleCapacityOperations(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * The `workCenterShift` links (rung 1 of the availability ladder) for a set of work centers, in ONE `.in()` query
 *
 * @mcp read
 */
export const getWorkCenterShifts = defineServiceFn({
  input: z.looseObject({ workCenterIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getWorkCenterShifts(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.workCenterIds
      )
    );
  }
});

/**
 * WorkCenter-kind reservations overlapping a window — the Capacity view's Scheduled series
 *
 * @mcp read
 */
export const getWorkCenterReservationsRange = defineServiceFn({
  input: z.looseObject({ startAt: z.string(), endAt: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getWorkCenterReservationsRange(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get location employees
 *
 * @mcp read
 */
export const getLocationEmployees = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLocationEmployees(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Gated abilities per work center at a location, for the people board's advisory qualification badge
 *
 * @mcp read
 */
export const getWorkCenterRequiredAbilities = defineServiceFn({
  input: z.looseObject({ locationId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getWorkCenterRequiredAbilities(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.locationId as never
      )
    );
  }
});

/**
 * Get active employee abilities
 *
 * @mcp read
 */
export const getActiveEmployeeAbilities = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getActiveEmployeeAbilities(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Reactive replanning: notify that a scheduling INPUT changed (shift, qualification, work center, location)
 *
 * @mcp
 */
export const notifyScheduleInputsChanged = defineServiceFn({
  input: z.looseObject({
    kind: z.enum([
      "ability",
      "shift",
      "employee-shift",
      "work-center",
      "location",
      "reorder",
      "people"
    ]),
    reason: z.string(),
    entityId: z.string().optional()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    const sent = await service.notifyScheduleInputsChanged(
      ctx.company.id,
      input.kind,
      input.reason,
      input.entityId
    );
    if (!sent) return ctx.error("unavailable", "The scheduler was not told");
  }
});

/**
 * Get unbatched batchable operation count
 *
 * @mcp read
 */
export const getUnbatchedBatchableOperationCount = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getUnbatchedBatchableOperationCount(
        ctx.asCaller.supabase,
        ctx.company.id
      )
    );
  }
});

/**
 * Get job operation batches
 *
 * @mcp read
 */
export const getJobOperationBatches = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getJobOperationBatches(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get job operation batch member stats
 *
 * @mcp read
 */
export const getJobOperationBatchMemberStats = defineServiceFn({
  input: z.looseObject({ batchIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobOperationBatchMemberStats(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input.batchIds).build() as never
      )
    );
  }
});

/**
 * Get job operation batch members
 *
 * @mcp read
 */
export const getJobOperationBatchMembers = defineServiceFn({
  input: z.looseObject({ batchIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobOperationBatchMembers(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input.batchIds).build() as never
      )
    );
  }
});

/**
 * Get batch output lots
 *
 * @mcp read
 */
export const getBatchOutputLots = defineServiceFn({
  input: z.looseObject({ batchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getBatchOutputLots(
        ctx.asCaller.supabase,
        input.batchId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get job operation batch with members
 *
 * @mcp read
 */
export const getJobOperationBatchWithMembers = defineServiceFn({
  input: z.looseObject({ batchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobOperationBatchWithMembers(
        ctx.asCaller.supabase,
        input.batchId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get job operation batch events
 *
 * @mcp read
 */
export const getJobOperationBatchEvents = defineServiceFn({
  input: z.looseObject({ batchId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getJobOperationBatchEvents(
        ctx.asCaller.supabase,
        input.batchId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get batchable operations
 *
 * @mcp read
 */
export const getBatchableOperations = defineServiceFn({
  input: z.looseObject({ locationId: z.string(), processId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getBatchableOperations(
        ctx.asCaller.supabase,
        ctx.company.id,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get batchable processes
 *
 * @mcp read
 */
export const getBatchableProcesses = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "production" },
  async run(ctx) {
    return unwrap(
      ctx,
      await service.getBatchableProcesses(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get assembly instruction
 *
 * @mcp read
 */
export const getAssemblyInstruction = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAssemblyInstruction(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get assembly instructions
 *
 * @mcp read
 */
export const getAssemblyInstructions = defineServiceFn({
  input: z.looseObject({
    search: z.string().optional(),
    status: z.enum(["Draft", "Published", "Archived"]).optional(),
    itemId: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return paged(
      ctx,
      await service.getAssemblyInstructions(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Get assembly instructions for item
 *
 * @mcp read
 */
export const getAssemblyInstructionsForItem = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAssemblyInstructionsForItem(
        ctx.asCaller.supabase,
        input.itemId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get assembly instruction steps
 *
 * @mcp read
 */
export const getAssemblyInstructionSteps = defineServiceFn({
  input: z.looseObject({ assemblyInstructionId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAssemblyInstructionSteps(
        ctx.asCaller.supabase,
        input.assemblyInstructionId as never
      )
    );
  }
});

/**
 * Upsert assembly instruction
 *
 * @mcp
 */
export const upsertAssemblyInstruction = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    name: z.string(),
    modelUploadId: z.string(),
    itemId: z.string().nullable().optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertAssemblyInstruction(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Update assembly instruction status
 *
 * @mcp
 */
export const updateAssemblyInstructionStatus = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    data: z.looseObject({ status: z.enum(["Draft", "Published", "Archived"]) })
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateAssemblyInstructionStatus(
        ctx.asCaller.supabase,
        input.id as never,
        payload(ctx, input.data).forUpdate() as never
      )
    );
  }
});

/**
 * Sibling versions of an instruction, for the header's version switcher
 *
 * @mcp read
 */
export const getAssemblyInstructionVersions = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    rootInstructionId: z.string().nullable().optional()
  }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAssemblyInstructionVersions(
        ctx.asCaller.supabase,
        payload(ctx, input).build() as never
      )
    );
  }
});

/**
 * Create a new Draft version of an assembly instruction as a copy of an
 * existing one, with every step and its materials, slides and tools.
 *
 * @remarks
 * The new version is the highest version plus one. A copy that fails partway
 * leaves a Draft that can be deleted.
 *
 * @mcp
 */
export const copyAssemblyInstructionAsVersion = defineServiceFn({
  input: z.looseObject({ copyFromId: z.string() }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.copyAssemblyInstructionAsVersion(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().forUpsert() as never
      )
    );
  }
});

/**
 * Publish a version of an assembly instruction: archive the version that was
 * Published, publish this one, and move in-flight work to it.
 *
 * @remarks
 * Only job operations that are not Done or Canceled, on jobs that are not
 * Completed, Closed or Cancelled, move. Method operations are not changed.
 *
 * @mcp
 */
export const activateAssemblyInstructionVersion = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.activateAssemblyInstructionVersion(
        ctx.asCaller.supabase,
        payload(ctx, input).withUser().build() as never
      )
    );
  }
});

/**
 * Delete assembly instruction
 *
 * @mcp destructive
 */
export const deleteAssemblyInstruction = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteAssemblyInstruction(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Upsert assembly instruction step
 *
 * @mcp
 */
export const upsertAssemblyInstructionStep = defineServiceFn({
  input: z.looseObject({
    title: z.string().nullable().optional(),
    type: z
      .enum([
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Task",
        "Inspection"
      ])
      .optional(),
    description: z.unknown().optional(),
    required: z.boolean().optional(),
    unitOfMeasureCode: z.string().nullable().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    listValues: z.array(z.string()).nullable().optional(),
    componentNodeIds: z.array(z.string()).optional(),
    motion: z
      .union([
        z.looseObject({
          type: z.literal("linear"),
          direction: z.tuple([z.number(), z.number(), z.number()]),
          distance: z.number().gt(0)
        }),
        z.looseObject({
          type: z.literal("L"),
          segments: z
            .array(
              z.looseObject({
                direction: z.tuple([z.number(), z.number(), z.number()]),
                distance: z.number().gt(0)
              })
            )
            .min(2)
        }),
        z.looseObject({
          type: z.literal("helix"),
          axis: z.tuple([z.number(), z.number(), z.number()]),
          origin: z.tuple([z.number(), z.number(), z.number()]),
          pitch: z.number().gt(0),
          turns: z.number().gt(0),
          approach: z.number().min(0)
        }),
        z.looseObject({
          type: z.literal("path"),
          keyframes: z
            .array(
              z.looseObject({
                t: z.number().min(0).max(1),
                position: z.tuple([z.number(), z.number(), z.number()]),
                quaternion: z.tuple([
                  z.number(),
                  z.number(),
                  z.number(),
                  z.number()
                ])
              })
            )
            .min(2)
        }),
        z.looseObject({
          type: z.literal("waypoints"),
          waypoints: z
            .array(
              z.looseObject({
                offset: z.tuple([z.number(), z.number(), z.number()]),
                rotation: z.tuple([
                  z.number(),
                  z.number(),
                  z.number(),
                  z.number()
                ])
              })
            )
            .min(2)
        }),
        z.looseObject({ type: z.literal("none") })
      ])
      .optional(),
    camera: z
      .union([
        z.looseObject({
          position: z.tuple([z.number(), z.number(), z.number()]),
          target: z.tuple([z.number(), z.number(), z.number()]),
          fov: z.number().gt(0)
        }),
        z.looseObject({
          source: z.literal("plan"),
          direction: z.tuple([z.number(), z.number(), z.number()])
        })
      ])
      .nullable()
      .optional(),
    fastener: z
      .looseObject({
        spec: z.string().optional(),
        count: z.number().int().gt(0).optional(),
        torqueNm: z.number().gt(0).optional(),
        tool: z.string().optional()
      })
      .nullable()
      .optional(),
    durationSeconds: z.number().nullable().optional(),
    id: z.string().optional(),
    assemblyInstructionId: z.string(),
    sortOrder: z.number().optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertAssemblyInstructionStep(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Partial update of a step's viewer-authored motion path and/or camera pose
 *
 * @mcp
 */
export const updateAssemblyStepMotion = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    motion: z
      .union([
        z.looseObject({
          type: z.literal("linear"),
          direction: z.tuple([z.number(), z.number(), z.number()]),
          distance: z.number().gt(0)
        }),
        z.looseObject({
          type: z.literal("L"),
          segments: z
            .array(
              z.looseObject({
                direction: z.tuple([z.number(), z.number(), z.number()]),
                distance: z.number().gt(0)
              })
            )
            .min(2)
        }),
        z.looseObject({
          type: z.literal("helix"),
          axis: z.tuple([z.number(), z.number(), z.number()]),
          origin: z.tuple([z.number(), z.number(), z.number()]),
          pitch: z.number().gt(0),
          turns: z.number().gt(0),
          approach: z.number().min(0)
        }),
        z.looseObject({
          type: z.literal("path"),
          keyframes: z
            .array(
              z.looseObject({
                t: z.number().min(0).max(1),
                position: z.tuple([z.number(), z.number(), z.number()]),
                quaternion: z.tuple([
                  z.number(),
                  z.number(),
                  z.number(),
                  z.number()
                ])
              })
            )
            .min(2)
        }),
        z.looseObject({
          type: z.literal("waypoints"),
          waypoints: z
            .array(
              z.looseObject({
                offset: z.tuple([z.number(), z.number(), z.number()]),
                rotation: z.tuple([
                  z.number(),
                  z.number(),
                  z.number(),
                  z.number()
                ])
              })
            )
            .min(2)
        }),
        z.looseObject({ type: z.literal("none") })
      ])
      .optional(),
    camera: z
      .union([
        z.looseObject({
          position: z.tuple([z.number(), z.number(), z.number()]),
          target: z.tuple([z.number(), z.number(), z.number()]),
          fov: z.number().gt(0)
        }),
        z.looseObject({
          source: z.literal("plan"),
          direction: z.tuple([z.number(), z.number(), z.number()])
        })
      ])
      .nullable()
      .optional(),
    orientation: z
      .tuple([z.number(), z.number(), z.number(), z.number()])
      .nullable()
      .optional(),
    reset: z.boolean().optional()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateAssemblyStepMotion(
        ctx.asSystem.pg,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Update assembly step hidden components
 *
 * @mcp
 */
export const updateAssemblyStepHiddenComponents = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    assemblyInstructionId: z.string(),
    hiddenComponentNodeIds: z.array(z.string())
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateAssemblyStepHiddenComponents(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Wrap a top-level step into a new sub-assembly; the step becomes its first step
 *
 * @mcp
 */
export const makeAssemblySubAssembly = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    stepId: z.string()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return await service.makeAssemblySubAssembly(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().build() as never
    );
  }
});

/**
 * Add a step at the end of the instruction, or at the end of the sub-assembly `parentStepId` names (directly before its header)
 *
 * @mcp
 */
export const insertAssemblyInstructionStep = defineServiceFn({
  input: z.looseObject({
    title: z.string().nullable().optional(),
    type: z
      .enum([
        "Value",
        "Measurement",
        "Checkbox",
        "Timestamp",
        "Person",
        "List",
        "File",
        "Task",
        "Inspection"
      ])
      .optional(),
    description: z.unknown().optional(),
    required: z.boolean().optional(),
    unitOfMeasureCode: z.string().nullable().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    listValues: z.array(z.string()).nullable().optional(),
    componentNodeIds: z.array(z.string()).optional(),
    motion: z
      .union([
        z.looseObject({
          type: z.literal("linear"),
          direction: z.tuple([z.number(), z.number(), z.number()]),
          distance: z.number().gt(0)
        }),
        z.looseObject({
          type: z.literal("L"),
          segments: z
            .array(
              z.looseObject({
                direction: z.tuple([z.number(), z.number(), z.number()]),
                distance: z.number().gt(0)
              })
            )
            .min(2)
        }),
        z.looseObject({
          type: z.literal("helix"),
          axis: z.tuple([z.number(), z.number(), z.number()]),
          origin: z.tuple([z.number(), z.number(), z.number()]),
          pitch: z.number().gt(0),
          turns: z.number().gt(0),
          approach: z.number().min(0)
        }),
        z.looseObject({
          type: z.literal("path"),
          keyframes: z
            .array(
              z.looseObject({
                t: z.number().min(0).max(1),
                position: z.tuple([z.number(), z.number(), z.number()]),
                quaternion: z.tuple([
                  z.number(),
                  z.number(),
                  z.number(),
                  z.number()
                ])
              })
            )
            .min(2)
        }),
        z.looseObject({
          type: z.literal("waypoints"),
          waypoints: z
            .array(
              z.looseObject({
                offset: z.tuple([z.number(), z.number(), z.number()]),
                rotation: z.tuple([
                  z.number(),
                  z.number(),
                  z.number(),
                  z.number()
                ])
              })
            )
            .min(2)
        }),
        z.looseObject({ type: z.literal("none") })
      ])
      .optional(),
    camera: z
      .union([
        z.looseObject({
          position: z.tuple([z.number(), z.number(), z.number()]),
          target: z.tuple([z.number(), z.number(), z.number()]),
          fov: z.number().gt(0)
        }),
        z.looseObject({
          source: z.literal("plan"),
          direction: z.tuple([z.number(), z.number(), z.number()])
        })
      ])
      .nullable()
      .optional(),
    fastener: z
      .looseObject({
        spec: z.string().optional(),
        count: z.number().int().gt(0).optional(),
        torqueNm: z.number().gt(0).optional(),
        tool: z.string().optional()
      })
      .nullable()
      .optional(),
    durationSeconds: z.number().nullable().optional(),
    assemblyInstructionId: z.string(),
    parentStepId: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return await service.insertAssemblyInstructionStep(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().forUpsert() as never
    );
  }
});

/**
 * Rename a sub-assembly and/or set the step that uses it (`null` = it joins the main build)
 *
 * @mcp
 */
export const updateAssemblySubAssembly = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    headerId: z.string(),
    title: z.string().optional(),
    usedInStepId: z.string().nullable().optional()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return await service.updateAssemblySubAssembly(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().forUpdate() as never
    );
  }
});

/**
 * Remove the sub-assembly but keep its steps: they return to the top level in place
 *
 * @mcp destructive
 */
export const ungroupAssemblySubAssembly = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    headerId: z.string()
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return await service.ungroupAssemblySubAssembly(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().build() as never
    );
  }
});

/**
 * Delete a sub-assembly together with its steps
 *
 * @mcp destructive
 */
export const deleteAssemblySubAssembly = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    headerId: z.string()
  }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return await service.deleteAssemblySubAssembly(
      ctx.asSystem.pg,
      payload(ctx, input).withUser().build() as never
    );
  }
});

/**
 * Update assembly instruction step status
 *
 * @mcp
 */
export const updateAssemblyInstructionStepStatus = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    data: z.looseObject({ status: z.enum(["Todo", "Review", "Done"]) })
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.updateAssemblyInstructionStepStatus(
        ctx.asCaller.supabase,
        input.id as never,
        payload(ctx, input.data).forUpdate() as never
      )
    );
  }
});

/**
 * Drag-sort of the step list: each step's new position and sub-assembly (`parentStepId`, `null` = top level; omitted = unchanged)
 *
 * @mcp
 */
export const updateAssemblyInstructionStepOrder = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    updates: z.array(
      z.looseObject({
        id: z.string(),
        sortOrder: z.number(),
        parentStepId: z.string().nullable().optional()
      })
    )
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return await service.updateAssemblyInstructionStepOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.assemblyInstructionId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

/**
 * Delete assembly instruction step
 *
 * @mcp destructive
 */
export const deleteAssemblyInstructionStep = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteAssemblyInstructionStep(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get assembly instruction step slides
 *
 * @mcp read
 */
export const getAssemblyInstructionStepSlides = defineServiceFn({
  input: z.looseObject({ stepIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAssemblyInstructionStepSlides(
        ctx.asCaller.supabase,
        payload(ctx, input.stepIds).build() as never
      )
    );
  }
});

/**
 * Create a assembly instruction step slide
 *
 * @remarks
 * Upsert assembly instruction step slide
 *
 * @mcp
 */
export const createAssemblyInstructionStepSlide = defineServiceFn({
  input: z.looseObject({
    stepId: z.string().min(1),
    imagePath: z.string().optional(),
    modelUploadId: z.string().optional(),
    caption: z.string().optional(),
    sortOrder: z.number().min(0).optional(),
    size: z.enum(["small", "medium", "large"]).optional(),
    annotations: z
      .array(
        z.looseObject({
          id: z.string(),
          x: z.number(),
          y: z.number(),
          label: z.string().nullable().optional(),
          color: z.string().nullable().optional(),
          toolId: z.string().nullable().optional()
        })
      )
      .nullable()
      .optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional(),
    updatedAt: z.string().optional()
  }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertAssemblyInstructionStepSlide(
        ctx.asCaller.supabase,
        payload(ctx, input).forCreate() as never
      )
    );
  }
});

/**
 * Update a assembly instruction step slide
 *
 * @remarks
 * Upsert assembly instruction step slide
 *
 * @mcp
 */
export const updateAssemblyInstructionStepSlide = defineServiceFn({
  input: z
    .looseObject({
      stepId: z.string().min(1),
      imagePath: z.string().optional(),
      modelUploadId: z.string().optional(),
      caption: z.string().optional(),
      sortOrder: z.number().min(0).optional(),
      size: z.enum(["small", "medium", "large"]).optional(),
      annotations: z
        .array(
          z.looseObject({
            id: z.string(),
            x: z.number(),
            y: z.number(),
            label: z.string().nullable().optional(),
            color: z.string().nullable().optional(),
            toolId: z.string().nullable().optional()
          })
        )
        .nullable()
        .optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional(),
      updatedAt: z.string().optional()
    })
    .required({ id: true }),
  permission: { update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertAssemblyInstructionStepSlide(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpdate() as never
      )
    );
  }
});

/**
 * Delete assembly instruction step slide
 *
 * @mcp destructive
 */
export const deleteAssemblyInstructionStepSlide = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteAssemblyInstructionStepSlide(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get assembly instruction step tools
 *
 * @mcp read
 */
export const getAssemblyInstructionStepTools = defineServiceFn({
  input: z.looseObject({ stepIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAssemblyInstructionStepTools(
        ctx.asCaller.supabase,
        payload(ctx, input.stepIds).build() as never
      )
    );
  }
});

/**
 * Upsert assembly instruction step tool
 *
 * @mcp
 */
export const upsertAssemblyInstructionStepTool = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    stepId: z.string(),
    itemId: z.string(),
    quantity: z.number().optional(),
    sortOrder: z.number().optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertAssemblyInstructionStepTool(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Delete assembly instruction step tool
 *
 * @mcp destructive
 */
export const deleteAssemblyInstructionStepTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteAssemblyInstructionStepTool(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get assembly instruction step materials
 *
 * @mcp read
 */
export const getAssemblyInstructionStepMaterials = defineServiceFn({
  input: z.looseObject({ stepIds: z.array(z.string()) }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAssemblyInstructionStepMaterials(
        ctx.asCaller.supabase,
        payload(ctx, input.stepIds).build() as never
      )
    );
  }
});

/**
 * Upsert assembly instruction step material
 *
 * @mcp
 */
export const upsertAssemblyInstructionStepMaterial = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    stepId: z.string(),
    itemId: z.string(),
    quantity: z.number().nullable().optional(),
    sortOrder: z.number().optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertAssemblyInstructionStepMaterial(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Update assembly instruction step material order
 *
 * @mcp
 */
export const updateAssemblyInstructionStepMaterialOrder = defineServiceFn({
  input: z.looseObject({
    assemblyInstructionId: z.string(),
    updates: z.array(z.looseObject({ id: z.string(), sortOrder: z.number() }))
  }),
  permission: { update: "production" },
  async run(ctx, input) {
    return await service.updateAssemblyInstructionStepMaterialOrder(
      ctx.asSystem.pg,
      ctx.company.id,
      ctx.auditUserId,
      input.assemblyInstructionId as never,
      payload(ctx, input.updates).forUpdate() as never
    );
  }
});

/**
 * Delete assembly instruction step material
 *
 * @mcp destructive
 */
export const deleteAssemblyInstructionStepMaterial = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteAssemblyInstructionStepMaterial(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * Get assembly units
 *
 * @mcp read
 */
export const getAssemblyUnits = defineServiceFn({
  input: z.looseObject({ modelUploadId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAssemblyUnits(
        ctx.asCaller.supabase,
        input.modelUploadId as never
      )
    );
  }
});

/**
 * Upsert assembly unit
 *
 * @mcp
 */
export const upsertAssemblyUnit = defineServiceFn({
  input: z.looseObject({
    id: z.string().optional(),
    modelUploadId: z.string(),
    name: z.string(),
    componentNodeIds: z.array(z.string()),
    itemId: z.string().nullable().optional()
  }),
  permission: { create: "production", update: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.upsertAssemblyUnit(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});

/**
 * Delete assembly unit
 *
 * @mcp destructive
 */
export const deleteAssemblyUnit = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteAssemblyUnit(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Latest plan job in any state — used to tell "planning is running" apart from "planning failed" and to avoid enqueueing duplicate plan runs
 *
 * @mcp read
 */
export const getLatestAssemblyPlanJob = defineServiceFn({
  input: z.looseObject({ modelUploadId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getLatestAssemblyPlanJob(
        ctx.asCaller.supabase,
        input.modelUploadId as never
      )
    );
  }
});

/**
 * Downloads and parses plan.json for a model's latest successful plan
 *
 * @mcp read
 */
export const getAssemblyPlanJson = defineServiceFn({
  input: z.looseObject({ modelUploadId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return await service.getAssemblyPlanJson(
      ctx.asCaller.supabase,
      input.modelUploadId as never
    );
  }
});

/**
 * Mappings from distinct model components (geometry hashes) to BOM items
 *
 * @mcp read
 */
export const getAssemblyComponentMappings = defineServiceFn({
  input: z.looseObject({ modelUploadId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.getAssemblyComponentMappings(
        ctx.asCaller.supabase,
        input.modelUploadId as never
      )
    );
  }
});

/**
 * Delete assembly component mapping
 *
 * @mcp destructive
 */
export const deleteAssemblyComponentMapping = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.deleteAssemblyComponentMapping(
        ctx.asCaller.supabase,
        input.id as never
      )
    );
  }
});

/**
 * The engineering bill of materials of a made item, flattened through its Make
 * subassemblies with quantities multiplied per level.
 *
 * @remarks
 * Uses the Active make method, else the first one.
 *
 * @mcp read
 */
export const getFlattenedBomMaterials = defineServiceFn({
  input: z.looseObject({ itemId: z.string() }),
  permission: { view: "production" },
  async run(ctx, input) {
    return await service.getFlattenedBomMaterials(
      ctx.asCaller.supabase,
      input.itemId as never,
      ctx.company.id
    );
  }
});

/**
 * Create a presigned upload URL for a job document
 *
 * @mcp
 */
export const createJobDocumentUploadUrl = defineServiceFn({
  input: z.looseObject({ jobId: z.string(), name: z.string() }),
  permission: { create: "production" },
  async run(ctx, input) {
    return unwrap(
      ctx,
      await service.createJobDocumentUploadUrl(
        ctx.asCaller.supabase,
        payload(ctx, input).forUpsert() as never
      )
    );
  }
});
