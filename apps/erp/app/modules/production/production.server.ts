// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { batchTrigger, trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import { runLocationSchedule } from "@carbon/planning";
import { serverFns } from "@carbon/server-functions";
import {
  async,
  chunkArray,
  datetime,
  getErrorMessage,
  groupBy,
  scrapAllowance,
  unchecked
} from "@carbon/utils";
import { parseDateTime, toCalendarDateTime } from "@internationalized/date";
import { sql } from "kysely";
import { z } from "zod";
import {
  cancelOpenPickingListsForJob,
  getDefaultStorageUnitForJob,
  mergeTrackedEntities
} from "~/modules/inventory/inventory.service";
import { getUnreleasedChangeOrderIssue } from "~/modules/items/items.server";
import { isSalesOrderClosed } from "~/modules/sales/sales.models";
import {
  CarbonError,
  defineServiceFn,
  type ServiceContext
} from "~/modules/service-fn.server";
import { methodItemType, methodType } from "~/modules/shared/shared.models";
import { isActiveCompanyEmployee } from "~/modules/shared/shared.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import {
  type AssemblyModelState,
  assemblyStepComponentsReassignValidator,
  bulkJobValidator,
  copyPeopleBoardValidator,
  copyPeopleWeekValidator,
  deadlineTypes,
  getAssemblyModelState,
  getDueDateForColumn,
  isAssemblyPlanRunning,
  isJobEditableFromPlanning,
  isJobLocked,
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
  scheduleJobUpdateValidator,
  scheduleOperationReorderValidator
} from "./production.models";
import {
  applyProductionPlanningDateActions,
  assignPeopleWeek,
  assignPlanningActions,
  autoMatchAssemblyComponents,
  calculateJobPriority,
  clearPeopleAbsence,
  copyPeopleBoard,
  copyPeopleWeek,
  createAssemblyPlanJob,
  createJobOperationBatch,
  deletePeopleAssignment,
  dismissPlanningActions,
  generateAssemblyStepsFromPlan,
  getBatchOutputLots,
  getJobReleaseReadiness,
  getLatestAssemblyPlanJob,
  getModelForItem,
  getPlanningActionsByIds,
  insertJob,
  invalidateAssemblyModelCache,
  markPlanningActionsActioned,
  movePeopleAssignment,
  movePeopleWeek,
  notifyScheduleInputsChanged,
  pullJobMaterialMakeMethod,
  reassignAssemblyStepComponents,
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  recalculateJobRequirements,
  releaseJobOperationBatch,
  releasePlanningActionClaim,
  reopenDismissedPlanningActions,
  returnPickedRemaindersForJob,
  returnPickedRemaindersForOperation,
  runMRP,
  setPeopleAbsence,
  setPeopleAbsenceRange,
  setPeopleAssignmentHours,
  setPeopleDay,
  setPeopleOvertimeBulk,
  settleNewSupplyPlanningActions,
  syncAssemblyInstructionToOperation,
  syncAssemblyStepMaterialsFromMappings,
  unassignPeopleWeek,
  unreleaseJobOperationBatch,
  updateAssemblyStepComponents,
  updateJob,
  updateJobOperationBatch,
  updateJobStatus,
  updatePlanningJob,
  upsertAssemblyComponentMapping,
  upsertAssemblyInstruction,
  upsertJobMaterial,
  upsertJobMaterialMakeMethod,
  upsertJobMethod,
  upsertJobOperation,
  upsertPeopleAssignment,
  upsertProductionEvent,
  upsertProductionQuantity
} from "./production.service";
import { jobReleaseProblems } from "./ui/Jobs/job-release-logic";

const logger = getLogger("erp", "production");

// The geometry (assembler) service backs model conversion and motion planning.
// When it's unreachable those actions can't run, so loaders probe its health and
// the UI soft-gates the assembler-dependent controls. Result cached so a
// navigation burst doesn't fan out one probe per route.
//
// The default deployment is a scale-to-zero Lambda: a cold /health takes ~2-5s
// to init, so the probe timeout must outlast a cold start (the old 2s abort
// read every cold service as down). Healthy sticks longer than unhealthy —
// a failed probe usually WARMED the service (the request went through; we just
// stopped waiting), so re-probe quickly instead of pinning "down" for 15s.
const ASSEMBLER_HEALTHY_TTL_MS = 60_000;
const ASSEMBLER_UNHEALTHY_TTL_MS = 5_000;
const ASSEMBLER_HEALTH_TIMEOUT_MS = 10_000;
let assemblerHealthCache: { healthy: boolean; expires: number } | null = null;

export async function isAssemblerServiceHealthy(): Promise<boolean> {
  if (!ASSEMBLER_SERVICE_URL) return false;

  const now = Date.now();
  if (assemblerHealthCache && assemblerHealthCache.expires > now) {
    return assemblerHealthCache.healthy;
  }

  let healthy = false;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    ASSEMBLER_HEALTH_TIMEOUT_MS
  );
  try {
    const response = await fetch(`${ASSEMBLER_SERVICE_URL}/health`, {
      method: "GET",
      signal: controller.signal
    });
    healthy = response.ok;
  } catch {
    healthy = false;
  } finally {
    clearTimeout(timeout);
  }

  assemblerHealthCache = {
    healthy,
    expires:
      now + (healthy ? ASSEMBLER_HEALTHY_TTL_MS : ASSEMBLER_UNHEALTHY_TTL_MS)
  };
  return healthy;
}

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
    const mrp = await runMRP(ctx.asSystem.supabase, ctx.asSystem.pg, {
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

    const recalc = await recalculateJobRequirements(
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

    const flipped = await updateJobStatus(ctx.asCaller.supabase, {
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

    const mrp = await runMRP(ctx.asSystem.supabase, ctx.asSystem.pg, {
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
      const recalc = await recalculateJobRequirements(
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
      const mrp = await runMRP(ctx.asSystem.supabase, ctx.asSystem.pg, {
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
      const update = await updateJobStatus(ctx.asCaller.supabase, {
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

      const purchaseOrder = await serverFns
        .system({ db: ctx.asSystem.pg, companyId, userId })
        .invoke("create", {
          type: "purchaseOrderFromJob",
          jobId: id,
          purchaseOrdersBySupplierId: purchaseOrders
        });
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

    const stamped = await stampSupplierChoices(ctx, {
      jobIds: releasable.map((job) => job.id),
      choices: supplierProcessByOperationId
    });
    if (stamped) return stamped;

    const readiness = await getJobReleaseReadiness(
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
 * Save the release dialog's supplier for outside operations whose process has
 * several, so `purchaseOrderFromJob` resolves it. Runs before the purchase
 * orders are created. Both ids come from the caller and drive an RLS-bypassing
 * write, so the operation must belong to one of `jobIds` and the supplier
 * process to the operation's own process.
 */
async function stampSupplierChoices(
  ctx: ServiceContext,
  { jobIds, choices }: { jobIds: string[]; choices: Record<string, string> }
): Promise<CarbonError | null> {
  const entries = Object.entries(choices);
  if (entries.length === 0) return null;
  const companyId = ctx.company.id;
  const system = ctx.asSystem.supabase;

  const [operations, supplierProcesses] = await Promise.all([
    system
      .from("jobOperation")
      .select("id, processId")
      .in("jobId", jobIds)
      .eq("companyId", companyId)
      .in(
        "id",
        entries.map(([operationId]) => operationId)
      ),
    system
      .from("supplierProcess")
      .select("id, processId")
      .eq("companyId", companyId)
      .in(
        "id",
        entries.map(([, supplierProcessId]) => supplierProcessId)
      )
  ]);
  if (operations.error || supplierProcesses.error) {
    return ctx.error(
      "internal",
      "Failed to save the supplier choice",
      operations.error ?? supplierProcesses.error
    );
  }

  const processOfOperation = new Map(
    operations.data.map((op) => [op.id, op.processId])
  );
  const processOfSupplierProcess = new Map(
    supplierProcesses.data.map((sp) => [sp.id, sp.processId])
  );
  for (const [operationId, supplierProcessId] of entries) {
    const processId = processOfOperation.get(operationId);
    if (!processId) {
      return ctx.error(
        "validation",
        `Operation ${operationId} does not belong to these jobs`
      );
    }
    if (processOfSupplierProcess.get(supplierProcessId) !== processId) {
      return ctx.error(
        "validation",
        "Selected supplier does not belong to the operation's process"
      );
    }
  }

  const updates = await Promise.all(
    entries.map(([operationId, supplierProcessId]) =>
      system
        .from("jobOperation")
        .update({
          operationSupplierProcessId: supplierProcessId,
          updatedBy: ctx.auditUserId
        })
        .eq("id", operationId)
        .eq("companyId", companyId)
    )
  );
  const failed = updates.find((update) => update.error)?.error;
  return failed
    ? ctx.error("internal", "Failed to save the supplier choice", failed)
    : null;
}

/**
 * Cancel a job.
 *
 * @remarks
 * The one cancel path: the job status route and the planning Cancel action
 * both call it, so neither can skip a step. In order:
 *   1. return the picked material the job did not consume,
 *   2. cancel its lines on every open picking list,
 *   3. set the job Cancelled and clear its assignee.
 * It stops at the first failure, before the status changes, so a retry starts
 * from the same place.
 *
 * Returns `conflict`, with nothing changed, when `fromStatuses` is sent and
 * the job has left them.
 *
 * @mcp
 */
export const cancelJob = defineServiceFn({
  input: z.object({
    jobId: z.string(),
    /**
     * Cancel only while the job is still in one of these statuses, checked
     * before step 1 and again in the status UPDATE. Planning's Cancel sends
     * Draft / Planned: it read the status earlier, and a job released since
     * must not lose its picks.
     */
    fromStatuses: z.array(z.enum(jobStatus)).optional()
  }),
  permission: { update: "production" },

  async run(ctx, { jobId, fromStatuses }) {
    const companyId = ctx.company.id;
    const userId = ctx.auditUserId;
    const statusChanged = () =>
      ctx.error("conflict", "The job's status changed; cancel it on the job");

    if (fromStatuses) {
      const current = await ctx.asCaller.supabase
        .from("job")
        .select("status")
        .eq("id", jobId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (current.error) {
        return ctx.error("internal", "Failed to read the job", current.error);
      }
      if (!current.data || !fromStatuses.includes(current.data.status)) {
        return statusChanged();
      }
    }

    const sweep = await returnPickedRemaindersForJob(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      { jobId, userId, companyId }
    );
    if (sweep.error) {
      return ctx.error(
        "internal",
        "Cancel aborted: returning picked material failed",
        sweep.error
      );
    }

    const picks = await cancelOpenPickingListsForJob(ctx.asSystem.pg, {
      jobId,
      companyId,
      userId
    });
    if (picks.error) {
      return ctx.error(
        "internal",
        "Cancel aborted: its picking lists could not be closed",
        picks.error
      );
    }

    const update = await updateJobStatus(ctx.asCaller.supabase, {
      id: jobId,
      companyId,
      status: "Cancelled",
      assignee: null,
      updatedBy: userId,
      ...(fromStatuses ? { fromStatuses } : {})
    });
    if (update.error) {
      return ctx.error("internal", "Failed to update job status", update.error);
    }
    if (!update.updated) return statusChanged();

    return { jobId };
  }
});

type JobStatus = (typeof jobStatus)[number];

/**
 * Move a job from one of `from` to `to`, as one guarded UPDATE: the job must be
 * in `from` when it is read and still when it is written.
 */
async function moveJobStatus(
  ctx: ServiceContext,
  jobId: string,
  {
    from,
    to,
    refusal
  }: { from: readonly JobStatus[]; to: JobStatus; refusal: string }
) {
  const job = await ctx.asCaller.supabase
    .from("job")
    .select("status")
    .eq("id", jobId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (job.error)
    return ctx.error("internal", "Failed to read the job", job.error);
  if (!job.data) return ctx.error("notFound", "Job not found");
  if (!from.includes(job.data.status)) return ctx.error("rule", refusal);

  const update = await updateJobStatus(ctx.asCaller.supabase, {
    id: jobId,
    companyId: ctx.company.id,
    status: to,
    updatedBy: ctx.auditUserId,
    fromStatuses: [...from]
  });
  if (update.error) {
    return ctx.error("internal", "Failed to update job status", update.error);
  }
  if (!update.updated) {
    return ctx.error("conflict", "The job's status changed; reload the job");
  }
  return { jobId, status: to };
}

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
    return moveJobStatus(ctx, jobId, {
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
    const job = await ctx.asCaller.supabase
      .from("job")
      .select(
        "status, quantity, salesOrderLineId, fixedAssetClassId, fixedAssetId, item(itemTrackingType, itemReplenishment(manufacturingBlocked))"
      )
      .eq("id", jobId)
      .eq("companyId", companyId)
      .maybeSingle();
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

    const recalc = await recalculateJobRequirements(
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
    const mrp = await runMRP(ctx.asSystem.supabase, ctx.asSystem.pg, {
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

    return moveJobStatus(ctx, jobId, {
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
    return moveJobStatus(ctx, jobId, {
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
    const closed = await moveJobStatus(ctx, jobId, {
      from: ["Completed"],
      to: "Closed",
      refusal: "Only a Completed job can be closed"
    });
    if (closed instanceof CarbonError) return closed;

    const writeOff = await serverFns
      .system({
        db: ctx.asSystem.pg,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
      .invoke("close-job", { jobId });
    if (writeOff.error) {
      logger.error("Failed to write off WIP for closed job", {
        jobId,
        companyId: ctx.company.id,
        error: writeOff.error
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
    const sweep = await returnPickedRemaindersForJob(
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

    const readiness = await getJobReleaseReadiness(
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

      const result = await releaseJobOperationBatch(client, ctx.asSystem.pg, {
        batchId: batch.id,
        companyId,
        userId: ctx.auditUserId
      });
      if (result.error) {
        failed.push({
          ...ref,
          message: getErrorMessage(result.error, "Failed to release")
        });
        continue;
      }

      // After the status flip is persisted: the wave must see the new state.
      await notifyScheduleInputsChanged(
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
      await notifyScheduleInputsChanged(
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

    try {
      await notifyScheduleInputsChanged(
        companyId,
        "reorder",
        "Schedule reordered"
      );
    } catch (notifyError) {
      // The wave can retry; the move stands.
      logger.error("Failed to notify schedule inputs changed", {
        companyId,
        error: notifyError
      });
    }
    return { id };
  }
});

/** Post an ended event's time to the GL; a skip or failure is the reason, not an error. */
async function postEndedEvent(ctx: ServiceContext, productionEventId: string) {
  const posting = await serverFns
    .system({
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    })
    .invoke("post-production-event", { productionEventId });
  if (posting.error) return posting.error.message || "unknown error";
  if (posting.data.success === false) {
    return posting.data.reason ?? "unknown reason";
  }
  return null;
}

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
      return ctx.error("rule", "Cannot modify a locked job. Reopen it first.");
    }

    const insert = await upsertProductionEvent(ctx.asCaller.supabase, {
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
      ? await postEndedEvent(ctx, insert.data.id)
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
    const update = await upsertProductionEvent(ctx.asCaller.supabase, {
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

    const postingError = event.endTime ? await postEndedEvent(ctx, id) : null;
    return { id, postingError };
  }
});

type OwnedTable =
  | "item"
  | "location"
  | "customer"
  | "modelUpload"
  | "fixedAssetClass"
  | "fixedAsset";

/**
 * `notFound` unless every id is a row of this company. Ids from a form prove
 * nothing about tenancy, and the writes after this run with the service role.
 * Read with the service role, since a production user may not hold the
 * other module's view and RLS would read their own row as absent.
 */
async function requireOwnRecords(
  ctx: ServiceContext,
  records: [table: OwnedTable, id: string | null | undefined, label: string][]
): Promise<CarbonError | null> {
  const checks = await Promise.all(
    records
      .filter(([, id]) => id)
      .map(async ([table, id, label]) => {
        const row = await ctx.asSystem.supabase
          .from(table as "item")
          .select("id")
          .eq("id", id!)
          .eq("companyId", ctx.company.id)
          .maybeSingle();
        if (row.error) {
          return ctx.error(
            "internal",
            `Failed to verify the ${label}`,
            row.error
          );
        }
        return row.data
          ? null
          : ctx.error(
              "notFound",
              `The ${label} could not be found. It may have been deleted, or it belongs to another company.`
            );
      })
  );
  return checks.find((check) => check !== null) ?? null;
}

/**
 * The jobs, read as the caller, refusing the request when any is locked
 * (Completed, Closed or Cancelled). Ids of other companies are not returned.
 */
async function readUnlockedJobs(ctx: ServiceContext, ids: string[]) {
  const jobs = await ctx.asCaller.supabase
    .from("job")
    .select("id, status, quantity, fixedAssetClassId, fixedAssetId")
    .in("id", ids)
    .eq("companyId", ctx.company.id);
  if (jobs.error) {
    return ctx.error("internal", "Failed to read the jobs", jobs.error);
  }
  if (jobs.data.some((job) => isJobLocked(job.status))) {
    return ctx.error("rule", "Cannot modify a locked job. Reopen it first.");
  }
  return jobs.data;
}

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
    const jobs = await readUnlockedJobs(ctx, ids);
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
    const jobs = await readUnlockedJobs(ctx, ids);
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
      const method = await upsertJobMethod(
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
 * the jobs at its location on the new date (`calculateJobPriority`). A field
 * left out keeps the job's current value; a `dueDate` of null clears it.
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
    const client = ctx.asCaller.supabase;
    const jobs = await readUnlockedJobs(ctx, ids);
    if (jobs instanceof CarbonError) return jobs;

    for (const id of ids) {
      const current = await client
        .from("job")
        .select("dueDate, deadlineType, locationId")
        .eq("id", id)
        .eq("companyId", companyId)
        .single();
      if (current.error) {
        return ctx.error("internal", current.error.message, current.error);
      }
      const newDueDate =
        dueDate !== undefined ? dueDate || null : current.data.dueDate;
      const newDeadlineType = deadlineType ?? current.data.deadlineType;
      const priority = await calculateJobPriority(client, {
        jobId: id,
        dueDate: newDueDate,
        deadlineType: newDeadlineType,
        companyId,
        locationId: current.data.locationId
      });
      const update = await client
        .from("job")
        .update({
          ...(dueDate !== undefined && { dueDate: newDueDate }),
          ...(deadlineType && { deadlineType }),
          priority,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
        .eq("id", id)
        .eq("companyId", companyId);
      if (update.error) {
        return ctx.error("internal", update.error.message, update.error);
      }
    }
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
    const jobs = await readUnlockedJobs(ctx, ids);
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
      const recalc = await recalculateJobRequirements(
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
    const jobs = await readUnlockedJobs(ctx, ids);
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
    const jobs = await readUnlockedJobs(ctx, ids);
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
    const jobs = await readUnlockedJobs(ctx, [id]);
    if (jobs instanceof CarbonError) return jobs;
    if (jobs.length === 0) return ctx.error("notFound", "Job not found");

    const owned = await requireOwnRecords(ctx, [
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

    const result = await updateJob(ctx.asCaller.supabase, {
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

    const recalculate = await recalculateJobRequirements(
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

    const method = await upsertJobMethod(
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
 * Each job's due date when `count` jobs are spread from the first job's due
 * date to the last's: several jobs a day when there are more jobs than days,
 * several days a job otherwise. The last job is due on the last date.
 */
function spreadDueDates(
  count: number,
  first: string | undefined,
  last: string | undefined
): (string | undefined)[] {
  if (!first || !last) return Array.from({ length: count }, () => first);
  const startDate = toCalendarDateTime(parseDateTime(first));
  const endDate = toCalendarDateTime(parseDateTime(last));
  const daysBetween = endDate.compare(startDate);
  const jobsPerDay = (count - 1) / daysBetween;
  const daysPerJob = daysBetween / (count - 1);

  let cumulativeJobs = 0;
  return Array.from({ length: count }, (_, i) => {
    if (i === count - 1) return last;
    if (jobsPerDay >= 1) {
      cumulativeJobs += 1;
      const dayOffset = Math.floor(cumulativeJobs / jobsPerDay);
      return startDate.add({ days: dayOffset }).toString();
    }
    const dayOffset = Math.floor(i * daysPerJob);
    return startDate.add({ days: dayOffset }).toString();
  });
}

/**
 * A job's configuration: an object, or the JSON a form posts. Anything else
 * (invalid JSON) is no configuration.
 */
function parseConfiguration(
  value: unknown
): Record<string, unknown> | undefined {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

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

    const configuration = parseConfiguration(configStr);

    const owned = await requireOwnRecords(ctx, [
      ["item", job.itemId, "item"],
      ["location", job.locationId, "location"],
      ["customer", job.customerId, "customer"],
      ["modelUpload", job.modelUploadId, "model"]
    ]);
    if (owned) return owned;

    const jobs = Math.ceil(totalQuantity / quantityPerJob);
    const quantityOfLastJob = totalQuantity - (jobs - 1) * quantityPerJob;
    const dueDates = spreadDueDates(jobs, dueDateOfFirstJob, dueDateOfLastJob);
    const storageUnitId = await getDefaultStorageUnitForJob(
      ctx.asSystem.supabase,
      job.itemId,
      job.locationId,
      companyId
    );

    const jobIds: string[] = [];
    for (let i = 0; i < jobs; i++) {
      const created = await insertJob(
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
        return ctx.error("internal", "Failed to insert job", created.error);
      }
      jobIds.push(created.data.id);
    }

    await batchTrigger(
      "recalculate",
      jobIds.map((id) => ({
        payload: { type: "jobRequirements", id, companyId, userId }
      }))
    );
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

    const configuration = parseConfiguration(configStr);

    // insertJob runs as the system: every id the caller sent must be this
    // company's before it is written.
    const owned = await requireOwnRecords(ctx, [
      ["item", job.itemId, "item"],
      ["location", job.locationId, "location"],
      ["customer", job.customerId, "customer"],
      ["modelUpload", job.modelUploadId, "model"],
      ["fixedAssetClass", job.fixedAssetClassId, "fixed asset class"],
      ["fixedAsset", job.fixedAssetId, "fixed asset"]
    ]);
    if (owned) return owned;

    const unreleasedIssue = await getUnreleasedChangeOrderIssue(
      ctx.asSystem.supabase,
      { itemId: job.itemId, companyId }
    );
    if (unreleasedIssue) {
      return ctx.error(
        "rule",
        `${unreleasedIssue} A job cannot be made for it.`
      );
    }

    // Refused here, not only at release, so the form says why while the item
    // is still being chosen.
    if (job.fixedAssetClassId || job.fixedAssetId) {
      const item = await ctx.asSystem.supabase
        .from("item")
        .select("itemTrackingType")
        .eq("id", job.itemId)
        .eq("companyId", companyId)
        .single();
      const itemError = makeToAssetItemError({
        ...job,
        itemTrackingType: item.data?.itemTrackingType
      });
      if (itemError) return ctx.error("rule", itemError);
    }

    const created = await insertJob(
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

/** `notFound` unless the job is this company's (read as the caller). */
async function requireJob(ctx: ServiceContext, jobId: string) {
  const job = await ctx.asCaller.supabase
    .from("job")
    .select("id, status")
    .eq("id", jobId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (job.error)
    return ctx.error("internal", "Failed to read the job", job.error);
  if (!job.data) return ctx.error("notFound", "Job not found");
  return job.data;
}

/**
 * Recalculate a job's requirements and operation dependencies (which also
 * reschedules its location). The first failure is returned.
 */
async function recalculateJob(
  ctx: ServiceContext,
  jobId: string,
  { requirements = true }: { requirements?: boolean } = {}
): Promise<CarbonError | null> {
  const params = { companyId: ctx.company.id, userId: ctx.auditUserId };
  const [quantities, dependencies] = await Promise.all([
    requirements
      ? recalculateJobRequirements(ctx.asSystem.supabase, ctx.asSystem.pg, {
          id: jobId,
          ...params
        })
      : null,
    recalculateJobOperationDependencies(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        jobId,
        ...params
      }
    )
  ]);
  if (quantities?.error) {
    return ctx.error(
      "internal",
      "Failed to calculate job quantities",
      quantities.error
    );
  }
  if (dependencies?.error) {
    return ctx.error(
      "internal",
      "Failed to recalculate job operation dependencies",
      dependencies.error
    );
  }
  return null;
}

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
    const job = await requireJob(ctx, method.targetId);
    if (job instanceof CarbonError) return job;

    const copied = await upsertJobMethod(
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

    const recalculated = await recalculateJob(ctx, method.targetId);
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
    const copied = await upsertJobMaterialMakeMethod(
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
      system
        .from("job")
        .select("status")
        .eq("id", material.jobId)
        .eq("companyId", companyId)
        .maybeSingle(),
      requireJobChildren(ctx, material.jobId, {
        jobMakeMethodId: material.jobMakeMethodId,
        jobOperationId: material.jobOperationId
      })
    ]);
    if (job.error)
      return ctx.error("internal", "Failed to read the job", job.error);
    if (!job.data) return ctx.error("notFound", "Job not found");
    if (parents) return parents;

    const insert = await upsertJobMaterial(system, {
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
      const pulled = await pullJobMaterialMakeMethod(system, ctx.asSystem.pg, {
        jobMaterialId: id,
        itemId: material.itemId,
        companyId,
        userId
      });
      if (pulled.error) {
        return ctx.error(
          "internal",
          "Failed to insert job material make method",
          pulled.error
        );
      }
    }

    if (!["Draft", "Planned"].includes(job.data.status ?? "")) {
      const recalculated = await recalculateMaterialMethod(ctx, {
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
    const [existing, parents] = await Promise.all([
      system
        .from("jobMaterial")
        .select("methodType")
        .eq("id", id)
        .eq("jobId", material.jobId)
        .eq("jobMakeMethodId", material.jobMakeMethodId)
        .eq("companyId", companyId)
        .maybeSingle(),
      requireJobChildren(ctx, material.jobId, {
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

    const update = await upsertJobMaterial(system, {
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
      const pulled = await pullJobMaterialMakeMethod(system, ctx.asSystem.pg, {
        jobMaterialId: id,
        itemId: material.itemId,
        companyId,
        userId
      });
      if (pulled.error) {
        return ctx.error(
          "internal",
          "Failed to insert job material make method",
          pulled.error
        );
      }
    }

    const recalculated = await recalculateMaterialMethod(ctx, {
      jobId: material.jobId,
      jobMakeMethodId: material.jobMakeMethodId,
      dependencies: makeToOrder && !!material.jobOperationId
    });
    if (recalculated) return recalculated;
    return { id, methodType: update.data.methodType };
  }
});

/** `notFound` unless the make method and operation given hang off this job. */
async function requireJobChildren(
  ctx: ServiceContext,
  jobId: string,
  {
    jobMakeMethodId,
    jobOperationId
  }: { jobMakeMethodId?: string; jobOperationId?: string }
): Promise<CarbonError | null> {
  const system = ctx.asSystem.supabase;
  const [method, operation] = await Promise.all([
    jobMakeMethodId
      ? system
          .from("jobMakeMethod")
          .select("id")
          .eq("id", jobMakeMethodId)
          .eq("jobId", jobId)
          .eq("companyId", ctx.company.id)
          .maybeSingle()
      : null,
    jobOperationId
      ? system
          .from("jobOperation")
          .select("id")
          .eq("id", jobOperationId)
          .eq("jobId", jobId)
          .eq("companyId", ctx.company.id)
          .maybeSingle()
      : null
  ]);
  const failed = method?.error ?? operation?.error;
  if (failed) return ctx.error("internal", "Failed to read the job", failed);
  if (method && !method.data)
    return ctx.error("notFound", "Make method not found");
  if (operation && !operation.data) {
    return ctx.error("notFound", "Operation not found");
  }
  return null;
}

/** Recalculate one make method's requirements, and the job's dependencies. */
async function recalculateMaterialMethod(
  ctx: ServiceContext,
  {
    jobId,
    jobMakeMethodId,
    dependencies
  }: { jobId: string; jobMakeMethodId: string; dependencies: boolean }
): Promise<CarbonError | null> {
  const params = { companyId: ctx.company.id, userId: ctx.auditUserId };
  const [requirements, dependencyResult] = await Promise.all([
    recalculateJobMakeMethodRequirements(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        id: jobMakeMethodId,
        ...params
      }
    ),
    dependencies
      ? recalculateJobOperationDependencies(
          ctx.asSystem.supabase,
          ctx.asSystem.pg,
          { jobId, ...params }
        )
      : null
  ]);
  if (requirements.error) {
    return ctx.error(
      "internal",
      "Failed to recalculate job make method requirements",
      requirements.error
    );
  }
  if (dependencyResult?.error) {
    return ctx.error(
      "internal",
      "Failed to recalculate job operation dependencies",
      dependencyResult.error
    );
  }
  return null;
}

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
    const recalculated = await recalculateJob(ctx, jobId, {
      requirements: false
    });
    if (recalculated) return recalculated;
    return { id };
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
    const job = await requireJob(ctx, operation.jobId);
    if (job instanceof CarbonError) return job;
    const parents = await requireJobChildren(ctx, operation.jobId, {
      jobMakeMethodId: operation.jobMakeMethodId
    });
    if (parents) return parents;

    const insert = await upsertJobOperation(
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

    const recalculated = await recalculateMaterialMethod(ctx, {
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
    const update = await upsertJobOperation(
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
    const recalculated = await recalculateJob(ctx, jobId, {
      requirements: false
    });
    if (recalculated) return recalculated;
    return { id };
  }
});

/**
 * Reorder a job's operations.
 *
 * @remarks
 * `orders` maps an operation id to its new order. Then the job's operation
 * dependencies are recalculated.
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
    const written = await Promise.all(
      Object.entries(orders).map(([id, order]) =>
        ctx.asCaller.supabase
          .from("jobOperation")
          .update({ order, updatedBy: ctx.auditUserId })
          .eq("id", id)
          .eq("jobId", jobId)
          .eq("companyId", ctx.company.id)
      )
    );
    const failed = written.find((write) => write.error)?.error;
    if (failed) {
      return ctx.error("internal", "Failed to update sort order", failed);
    }
    const recalculated = await recalculateJob(ctx, jobId, {
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
      const sweep = await returnPickedRemaindersForOperation(
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
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error("internal", "Failed to update due date", update.error);
    }
    await notifyScheduleInputsChanged(
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
    const sync = await serverFns
      .system({
        db: ctx.asSystem.pg,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
      .invoke("get-method", {
        type: "procedureToOperation",
        sourceId: procedureId,
        targetId: operationId
      });
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

    const outputs = await getBatchOutputLots(client, batchId, companyId);
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
 * batch (`batch-operations` `create`: eligibility, the process's material
 * rules and the planned output lots are checked there). With `release`, the
 * operations' Draft / Planned jobs are released first through the job page's
 * checks (any problem refuses the batch untouched; `purchaseOrdersBySupplierId`
 * is the release dialog's choice), the batch is created already on the floor,
 * and the scheduler is told.
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

  async run(ctx, { purchaseOrdersBySupplierId, ...batch }) {
    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;

    if (batch.release) {
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
      const released = await releaseBatchMemberJobs(ctx, {
        jobIds: ops.data.map((op) => op.jobId),
        purchaseOrdersBySupplierId
      });
      if (released.error) return released.error;
    }

    const result = await createJobOperationBatch(client, ctx.asSystem.pg, {
      ...batch,
      companyId,
      userId: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error(
        "rule",
        getErrorMessage(result.error, "Failed to create batch"),
        result.error
      );
    }

    if (batch.release) {
      // The batch was inserted Active: the wave places it as one unit.
      await notifyScheduleInputsChanged(
        companyId,
        "work-center",
        "batch released at creation",
        batch.workCenterId
      );
    }
    const created = result.data as { id?: string; readableId?: string } | null;
    return {
      batchId: created?.id ?? null,
      readableId: created?.readableId ?? null
    };
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
    const unreleased = await unreleaseJobOperationBatch(
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
    await notifyScheduleInputsChanged(
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
    const result = await updateJobOperationBatch(
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

type BoardReferenceTable =
  | "department"
  | "employee"
  | "location"
  | "shift"
  | "workCenter";

/**
 * `notFound` unless every id given is this company's. Every board write puts
 * these ids into this company's rows through Kysely (no RLS), and their
 * single-column foreign keys accept another company's row. Empty values are
 * skipped, so optional fields stay optional.
 */
async function requireBoardReferences(
  ctx: ServiceContext,
  refs: Partial<Record<BoardReferenceTable, (string | null | undefined)[]>>
): Promise<CarbonError | null> {
  const checks = await Promise.all(
    (Object.entries(refs) as [BoardReferenceTable, unknown[]][]).map(
      async ([table, values]) => {
        const ids = [
          ...new Set(
            values.filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0
            )
          )
        ];
        if (ids.length === 0) return true;
        // Every table in the union has `id` + `companyId`; the cast only
        // narrows the union so Kysely can type the builder.
        const rows = await ctx.asSystem.pg
          .selectFrom(table as "location")
          .select("id")
          .where("id", "in", ids)
          .where("companyId", "=", ctx.company.id)
          .execute();
        return rows.length === ids.length;
      }
    )
  );
  if (checks.every(Boolean)) return null;
  logger.error("People board reference is not in the caller's company", {
    companyId: ctx.company.id,
    refs
  });
  return ctx.error("notFound", "Not found");
}

/** Tell the scheduler once per work center; with none, once, unscoped. */
async function notifyPeopleChange(
  ctx: ServiceContext,
  reason: string,
  workCenterIds: (string | null | undefined)[] = []
) {
  const ids = [...new Set(workCenterIds.filter(Boolean))] as string[];
  if (ids.length === 0) {
    await notifyScheduleInputsChanged(ctx.company.id, "people", reason);
    return;
  }
  for (const workCenterId of ids) {
    await notifyScheduleInputsChanged(
      ctx.company.id,
      "people",
      reason,
      workCenterId
    );
  }
}

/** The work centers a person is assigned at on a date, for the notice. */
async function notifyForEmployeeDate(
  ctx: ServiceContext,
  employeeId: string,
  date: string,
  reason: string
) {
  const assignments = await ctx.asCaller.supabase
    .from("peopleAssignment")
    .select("workCenterId")
    .eq("companyId", ctx.company.id)
    .eq("employeeId", employeeId)
    .eq("date", date);
  await notifyPeopleChange(
    ctx,
    reason,
    (assignments.data ?? []).map((row) => row.workCenterId)
  );
}

/** A write that throws on failure, as an `internal` error with `message`. */
async function attempt<T>(
  ctx: ServiceContext,
  message: string,
  write: () => Promise<T>
): Promise<T | CarbonError<"internal">> {
  try {
    return await write();
  } catch (err) {
    return ctx.error("internal", message, err);
  }
}

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
    const refused = await requireBoardReferences(ctx, {
      employee: [assignment.employeeId],
      location: [assignment.locationId],
      shift: [assignment.shiftId],
      workCenter: [assignment.workCenterId]
    });
    if (refused) return refused;

    const written = await attempt(ctx, "Failed to assign people member", () =>
      upsertPeopleAssignment(ctx.asSystem.pg, {
        ...assignment,
        companyId: ctx.company.id,
        shiftId: assignment.shiftId || null,
        createdBy: ctx.auditUserId
      })
    );
    if (written instanceof CarbonError) return written;
    await notifyPeopleChange(ctx, "People assignment changed", [
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
    const removed = await deletePeopleAssignment(
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
    await notifyPeopleChange(ctx, "People assignment removed", [
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
    const refused = await requireBoardReferences(ctx, {
      employee: [absence.employeeId],
      shift: [absence.shiftId]
    });
    if (refused) return refused;

    const written = await setPeopleAbsence(ctx.asCaller.supabase, {
      ...absence,
      companyId: ctx.company.id,
      shiftId: absence.shiftId || null,
      createdBy: ctx.auditUserId
    });
    if (written.error) {
      return ctx.error("internal", "Failed to mark absent", written.error);
    }
    await notifyForEmployeeDate(
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
    const cleared = await clearPeopleAbsence(
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
    await notifyForEmployeeDate(
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
    const refused = await requireBoardReferences(ctx, {
      workCenter: [workCenterId]
    });
    if (refused) return refused;

    const moved = await attempt(ctx, "Failed to move assignment", () =>
      movePeopleAssignment(ctx.asSystem.pg, {
        id,
        companyId: ctx.company.id,
        workCenterId
      })
    );
    if (moved instanceof CarbonError) return moved;
    await notifyPeopleChange(ctx, "People assignment moved", [
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
    const refused = await requireBoardReferences(ctx, {
      employee: [day.employeeId],
      location: [day.locationId],
      shift: [day.shiftId],
      workCenter: day.rows.map((row) => row.workCenterId)
    });
    if (refused) return refused;

    const written = await attempt(ctx, "Failed to save working hours", () =>
      setPeopleDay(ctx.asSystem.pg, ctx.auditUserId, {
        ...day,
        companyId: ctx.company.id,
        shiftId: day.shiftId || null,
        note: day.note || null
      })
    );
    if (written instanceof CarbonError) return written;
    await notifyForEmployeeDate(
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
    const result = await setPeopleAssignmentHours(
      ctx.asCaller.supabase,
      ctx.company.id,
      { id, hours: hours ?? null, updatedBy: ctx.auditUserId }
    );
    if (result.error) {
      return ctx.error("internal", "Failed to set hours", result.error);
    }
    await notifyPeopleChange(ctx, "People assignment hours changed", [
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
    const refused = await requireBoardReferences(ctx, {
      department: [overtime.departmentId],
      location: [overtime.locationId],
      shift: [overtime.shiftId]
    });
    if (refused) return refused;

    const rows = await attempt(ctx, "Failed to set overtime", () =>
      setPeopleOvertimeBulk(ctx.asSystem.pg, {
        ...overtime,
        companyId: ctx.company.id,
        toDate: overtime.toDate || null,
        shiftId: overtime.shiftId || null,
        departmentId: overtime.departmentId || null,
        updatedBy: ctx.auditUserId
      })
    );
    if (rows instanceof CarbonError) return rows;
    await notifyPeopleChange(
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
    const refused = await requireBoardReferences(ctx, {
      location: [copy.locationId],
      shift: [copy.shiftId]
    });
    if (refused) return refused;

    const result = await attempt(ctx, "Failed to copy people board", () =>
      copyPeopleBoard(ctx.asSystem.pg, {
        ...copy,
        companyId: ctx.company.id,
        shiftId: copy.shiftId || null,
        createdBy: ctx.auditUserId
      })
    );
    if (result instanceof CarbonError) return result;
    await notifyPeopleChange(ctx, "People board copied from previous day");
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
    const refused = await requireBoardReferences(ctx, {
      employee: [week.employeeId],
      location: [week.locationId],
      shift: [week.shiftId],
      workCenter: [week.workCenterId]
    });
    if (refused) return refused;

    const written = await attempt(ctx, "Failed to assign week", () =>
      assignPeopleWeek(ctx.asSystem.pg, ctx.auditUserId, {
        ...week,
        companyId: ctx.company.id,
        shiftId: week.shiftId || null
      })
    );
    if (written instanceof CarbonError) return written;
    await notifyPeopleChange(ctx, "People week assignment", [
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
    const refused = await requireBoardReferences(ctx, {
      employee: [week.employeeId],
      shift: [week.shiftId],
      workCenter: [week.workCenterId]
    });
    if (refused) return refused;

    const written = await attempt(ctx, "Failed to unassign week", () =>
      unassignPeopleWeek(ctx.asSystem.pg, {
        ...week,
        companyId: ctx.company.id,
        shiftId: week.shiftId || null
      })
    );
    if (written instanceof CarbonError) return written;
    await notifyPeopleChange(ctx, "People week unassignment", [
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
    const refused = await requireBoardReferences(ctx, {
      employee: [week.employeeId],
      shift: [week.shiftId],
      workCenter: [week.workCenterId, week.fromWorkCenterId]
    });
    if (refused) return refused;

    const written = await attempt(ctx, "Failed to move week", () =>
      movePeopleWeek(ctx.asSystem.pg, {
        ...week,
        companyId: ctx.company.id,
        shiftId: week.shiftId || null
      })
    );
    if (written instanceof CarbonError) return written;
    await notifyPeopleChange(ctx, "People week move", [week.workCenterId]);
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
    const refused = await requireBoardReferences(ctx, {
      location: [copy.locationId],
      shift: [copy.shiftId]
    });
    if (refused) return refused;

    const result = await attempt(ctx, "Failed to copy people week", () =>
      copyPeopleWeek(ctx.asSystem.pg, {
        ...copy,
        companyId: ctx.company.id,
        shiftId: copy.shiftId || null,
        createdBy: ctx.auditUserId
      })
    );
    if (result instanceof CarbonError) return result;
    await notifyPeopleChange(ctx, "People week copied from previous week");
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
    const refused = await requireBoardReferences(ctx, {
      employee: [range.employeeId],
      shift: [range.shiftId]
    });
    if (refused) return refused;

    const result = await attempt(ctx, "Failed to set absence range", () =>
      setPeopleAbsenceRange(ctx.asSystem.pg, ctx.auditUserId, {
        ...range,
        companyId: ctx.company.id,
        shiftId: range.shiftId || null
      })
    );
    if (result instanceof CarbonError) return result;
    await notifyPeopleChange(ctx, "People absence range set");
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
 * `production.planning.updateJob` or Apply. The location and every item must
 * be this company's. Per item: one whose manufacturing is blocked or needs
 * configuration is skipped and named in `errors`; each order becomes a
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

    for (const item of items) {
      if (item.orders.length === 0) {
        // Nothing to make: existing supply already covers demand.
        itemsWithoutOrders.push(item.id);
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
        const created = await insertJob(
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

        const method = await upsertJobMethod(client, db, "itemToJob", {
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

    const settled = await settleNewSupplyPlanningActions(db, {
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
      const recalc = await recalculateJobRequirements(client, db, {
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

/** A Draft or Planned job of this company at `locationId`, for planning. */
async function readPlanningJob(
  ctx: ServiceContext,
  jobId: string,
  locationId: string
) {
  const target = await ctx.asSystem.supabase
    .from("job")
    .select("id, status, locationId, salesOrderId, salesOrderLineId")
    .eq("id", jobId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (target.error || !target.data) {
    return ctx.error("notFound", "Job not found", target.error);
  }
  // The drawer lists one location's jobs.
  if (target.data.locationId !== locationId) {
    return ctx.error("conflict", "This job is for another location.");
  }
  return target.data;
}

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
    const target = await readPlanningJob(ctx, job.id, locationId);
    if (target instanceof CarbonError) return target;
    if (!isJobEditableFromPlanning(target.status)) {
      return ctx.error("conflict", notEditableFromPlanning);
    }

    const saved = await updatePlanningJob(ctx.asSystem.supabase, {
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
      const recalc = await recalculateJobRequirements(
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

    const notified = await notifyPlanningScheduleChange(
      ctx,
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
 * Tell the scheduler after a planning write. A follow-up to a write that
 * already landed, so a failure is logged and reported, never thrown.
 */
async function notifyPlanningScheduleChange(
  ctx: ServiceContext,
  reason: string,
  jobId?: string
): Promise<boolean> {
  try {
    await notifyScheduleInputsChanged(ctx.company.id, "reorder", reason, jobId);
    return true;
  } catch (error) {
    logger.error("Failed to notify the scheduler from planning", {
      companyId: ctx.company.id,
      jobId,
      reason,
      error
    });
    return false;
  }
}

/**
 * Plan a Draft job from the planning drawer.
 *
 * @remarks
 * Only this location's make-to-stock Draft jobs: a job a sales order owns is
 * that order's, not planning's. Then `production.job.plan`: the requirements
 * recalculation, Draft → Planned, and MRP, so the job counts as supply and
 * the Make suggestion shrinks by it. `warning` is set when MRP did not run.
 *
 * @mcp
 */
export const planJobFromPlanning = defineServiceFn({
  input: z.object({ locationId: z.string(), jobId: z.string().min(1) }),
  permission: { update: "production" },

  async run(ctx, { locationId, jobId }) {
    const target = await readPlanningJob(ctx, jobId, locationId);
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
  Awaited<ReturnType<typeof getPlanningActionsByIds>>["data"]
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
 * it; Cancel runs `production.job.cancel` from Draft / Planned. Each of those
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
      const released = await releasePlanningActionClaim(client, {
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

    const actionRows = await getPlanningActionsByIds(db, {
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
    const jobs = await attempt(
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
        ReturnType<typeof applyProductionPlanningDateActions>
      >;
      try {
        outcome = await applyProductionPlanningDateActions(db, {
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
        const notified = await notifyPlanningScheduleChange(
          ctx,
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
      const claimed = await markPlanningActionsActioned(db, {
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
          } else {
            const update = await updatePlanningJob(client, {
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
            const recalc = await recalculateJobRequirements(client, db, {
              id: jobId,
              companyId,
              userId
            });
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
 * Report how many of the requested worklist rows changed; none is a conflict
 * (each one was applied or changed since the page loaded).
 */
function changedPlanningActions(
  ctx: ServiceContext,
  result: { data: unknown[] | null; error: unknown },
  requested: number,
  verb: "dismiss" | "reopen" | "assign"
) {
  if (result.error) {
    return ctx.error(
      "internal",
      `Failed to ${verb} planning actions`,
      result.error
    );
  }
  const changed = result.data?.length ?? 0;
  if (changed === 0) {
    return ctx.error(
      "conflict",
      `Nothing to ${verb} — these actions changed since the page loaded`
    );
  }
  return { changed, requested };
}

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
    const result = await dismissPlanningActions(ctx.asSystem.pg, {
      ids: planningActionIds,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      kind: "Make"
    });
    return changedPlanningActions(
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
    const result = await reopenDismissedPlanningActions(ctx.asSystem.pg, {
      ids: planningActionIds,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      kind: "Make"
    });
    return changedPlanningActions(
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
    const result = await assignPlanningActions(ctx.asSystem.pg, {
      ids: planningActionIds,
      companyId: ctx.company.id,
      assignee: assignee || null,
      userId: ctx.auditUserId,
      kind: "Make"
    });
    return changedPlanningActions(
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
      return ctx.error("rule", "Cannot modify a locked job. Reopen it first.");
    }

    const scrapReasonId =
      quantity.type === "Scrap" ? quantity.scrapReasonId : undefined;
    const insert = await upsertProductionQuantity(ctx.asCaller.supabase, {
      ...quantity,
      scrapReasonId,
      companyId
    });
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
    const update = await upsertProductionQuantity(ctx.asCaller.supabase, {
      ...quantity,
      id,
      scrapReasonId:
        quantity.type === "Scrap" ? quantity.scrapReasonId : undefined,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
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

  async run(ctx, { ids, ...fields }) {
    const update = await ctx.asCaller.supabase
      .from("procedure")
      .update({
        ...fields,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
      .in("id", ids)
      .eq("companyId", ctx.company.id);
    if (update.error) {
      return ctx.error("internal", update.error.message, update.error);
    }
    return { ids };
  }
});

// --- Assembly instructions -------------------------------------------------

/** The instruction's model id, `notFound` unless it is this company's. */
async function readInstructionModel(ctx: ServiceContext, id: string) {
  const instruction = await ctx.asCaller.supabase
    .from("assemblyInstruction")
    .select(
      "modelUploadId, modelUpload(id, processingStatus, glbPath, graphPath, modelPath)"
    )
    .eq("id", id)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (instruction.error) {
    return ctx.error(
      "internal",
      "Failed to read the instruction",
      instruction.error
    );
  }
  if (!instruction.data) return ctx.error("notFound", "Instruction not found");
  if (!instruction.data.modelUploadId) {
    return ctx.error("rule", "This instruction has no model");
  }
  return {
    modelUploadId: instruction.data.modelUploadId,
    modelUpload: instruction.data.modelUpload
  };
}

/** The geometry service is down: no conversion or planning can start. */
const geometryServiceDown = (ctx: ServiceContext, work: string) =>
  ctx.error(
    "unavailable",
    `The geometry service is unavailable — ${work} can't run right now.`
  );

/**
 * Start motion planning for a model: the job row first, so the page shows
 * the run on its next load (the worker adopts it via `planJobId`; it inserts
 * its own row when this insert fails), then the event.
 */
async function startAssemblyPlan(
  ctx: ServiceContext,
  modelUploadId: string,
  options: { reMotionFor?: string; reDetectUnits?: boolean } = {}
) {
  const created = await createAssemblyPlanJob(ctx.asCaller.supabase, {
    modelUploadId,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  });
  await trigger("assembly-plan", {
    modelUploadId,
    companyId: ctx.company.id,
    userId: ctx.auditUserId,
    ...(created.data?.id ? { planJobId: created.data.id } : {}),
    ...options
  });
}

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

    const derived = await getModelForItem(client, itemId, companyId);
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
    const assemblerHealthy = await isAssemblerServiceHealthy();
    if (needsConversion && !assemblerHealthy) {
      return geometryServiceDown(ctx, "model conversion");
    }

    const create = await upsertAssemblyInstruction(client, {
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
      const planJob = await getLatestAssemblyPlanJob(client, model.id);
      const planStatus = planJob.data?.status;
      if (
        planStatus !== "Success" &&
        planStatus !== "Processing" &&
        planStatus !== "Queued"
      ) {
        await startAssemblyPlan(ctx, model.id);
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
    const instruction = await readInstructionModel(ctx, id);
    if (instruction instanceof CarbonError) return instruction;
    const { modelUploadId } = instruction;

    if (instruction.modelUpload?.processingStatus !== "Success") {
      return ctx.error(
        "rule",
        "The model must finish converting before planning"
      );
    }
    if (!(await isAssemblerServiceHealthy())) {
      return geometryServiceDown(ctx, "motion planning");
    }

    const planJob = await getLatestAssemblyPlanJob(client, modelUploadId);
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
    await startAssemblyPlan(ctx, modelUploadId, {
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
    const result = await generateAssemblyStepsFromPlan(ctx.asSystem.supabase, {
      assemblyInstructionId: id,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      mode
    });
    if (result.ok) {
      return {
        planning: false,
        created: result.created,
        unmappedComponentCount: result.unmappedComponentCount ?? 0
      };
    }

    if (result.reason === "no-plan" && result.modelUploadId) {
      if (!(await isAssemblerServiceHealthy())) {
        return geometryServiceDown(ctx, "motion planning");
      }
      const [model, planJob] = await Promise.all([
        ctx.asSystem.supabase
          .from("modelUpload")
          .select("processingStatus")
          .eq("id", result.modelUploadId)
          .eq("companyId", ctx.company.id)
          .maybeSingle(),
        getLatestAssemblyPlanJob(ctx.asSystem.supabase, result.modelUploadId)
      ]);
      const isConverting =
        model.data?.processingStatus === "Queued" ||
        model.data?.processingStatus === "Processing";
      if (!isConverting && !isAssemblyPlanRunning(planJob.data)) {
        await startAssemblyPlan(ctx, result.modelUploadId);
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
    const instruction = await readInstructionModel(ctx, id);
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
    const instruction = await readInstructionModel(ctx, id);
    if (instruction instanceof CarbonError) return instruction;
    const invalidated = await invalidateAssemblyModelCache(
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
    const instruction = await readInstructionModel(ctx, id);
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
    if (!(await isAssemblerServiceHealthy())) {
      return geometryServiceDown(ctx, "model conversion");
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
    const result = await autoMatchAssemblyComponents(
      ctx.asCaller.supabase,
      args
    );
    if ("error" in result) return ctx.error("rule", result.error);
    const materials = await syncAssemblyStepMaterialsFromMappings(
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
    const owned = await requireOwnRecords(ctx, [
      ["modelUpload", modelUploadId, "model"],
      ["item", itemId, "item"]
    ]);
    if (owned) return owned;
    const upsert = await upsertAssemblyComponentMapping(ctx.asCaller.supabase, {
      modelUploadId,
      geometryHash,
      itemId,
      confidence: "high",
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (upsert.error) {
      return ctx.error("internal", "Failed to map part", upsert.error);
    }
    await syncAssemblyStepMaterialsFromMappings(ctx.asCaller.supabase, {
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
    const moved = await attempt(ctx, "Failed to assign components", () =>
      reassignAssemblyStepComponents(ctx.asSystem.pg, {
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
      await syncAssemblyStepMaterialsFromMappings(ctx.asCaller.supabase, {
        assemblyInstructionId: id,
        companyId: ctx.company.id,
        userId: ctx.auditUserId,
        stepIds: [targetStepId],
        onlyComponentNodeIds: componentNodeIds
      });
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

    const update = await updateAssemblyStepComponents(client, {
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
      await syncAssemblyStepMaterialsFromMappings(client, {
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
      return await syncAssemblyInstructionToOperation(ctx.asSystem.pg, {
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
