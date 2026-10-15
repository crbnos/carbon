// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Json } from "@carbon/database";
import { ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { batchTrigger, trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import { runLocationSchedule } from "@carbon/planning";
import { serverFns } from "@carbon/server-functions";
import {
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
  getDefaultStorageUnitForJob
} from "~/modules/inventory/inventory.service";
import { isSalesOrderClosed } from "~/modules/sales/sales.models";
import {
  CarbonError,
  defineServiceFn,
  type ServiceContext
} from "~/modules/service-fn.server";
import { methodItemType, methodType } from "~/modules/shared/shared.models";
import {
  bulkJobValidator,
  deadlineTypes,
  isJobLocked,
  jobOperationStatus,
  jobOperationValidator,
  jobStatus,
  jobValidator,
  makeToAssetItemError,
  productionEventValidator,
  scheduleOperationReorderValidator
} from "./production.models";
import {
  calculateJobPriority,
  getJobReleaseReadiness,
  insertJob,
  notifyScheduleInputsChanged,
  pullJobMaterialMakeMethod,
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  recalculateJobRequirements,
  releaseJobOperationBatch,
  returnPickedRemaindersForJob,
  returnPickedRemaindersForOperation,
  runMRP,
  updateJob,
  updateJobStatus,
  upsertJobMaterial,
  upsertJobMaterialMakeMethod,
  upsertJobMethod,
  upsertJobOperation,
  upsertProductionEvent
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
 * Release jobs to the floor.
 *
 * @remarks
 * What the Release dialog, the jobs table's Release Jobs and an API caller
 * all run. Each Draft / Planned job is checked on its own: nothing to make,
 * manufacturing blocked, an assembly with no operations, an outside operation
 * with no supplier (or several and none chosen), a Make to Asset job that
 * cannot complete to its asset, and a supplier with Draft purchase orders when
 * no choice was sent. A job with a problem is named in `failed`; the rest are
 * released, then each location they are at is scheduled once.
 *
 * `supplierProcessByOperationId` picks the supplier for an outside operation;
 * it is saved on the operation first. `purchaseOrdersBySupplierId` maps a
 * supplier to `new` or one of its Draft purchase orders.
 *
 * A job that is not Draft or Planned is listed in `skipped`. A job released
 * whose purchase orders then failed is in `released` and in `warnings`.
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
 * Reorder several operations of one schedule column.
 *
 * @remarks
 * Writes the priorities (and work center) a drop on the schedule board gives
 * them, as one all-or-nothing statement. The checks are the single-operation
 * update's, made once for the set: every operation exists and is open, its job
 * is unlocked and at the work center's location, and the work center runs its
 * process.
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

    return {
      workCenterChanged: operations.data.some(
        (o) => o.workCenterId !== destination.id
      )
    };
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

    let configuration: Record<string, unknown> | undefined;
    if (configStr) {
      try {
        configuration = JSON.parse(configStr);
      } catch {
        // invalid JSON: no configuration
      }
    }

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
