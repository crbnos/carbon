// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { datetime, getErrorMessage } from "@carbon/utils";
import { sql } from "kysely";
import { z } from "zod";
import { cancelOpenPickingListsForJob } from "~/modules/inventory/inventory.service";
import { type CarbonError, defineServiceFn } from "~/modules/service-fn.server";
import {
  isJobLocked,
  jobStatus,
  scheduleOperationReorderValidator
} from "./production.models";
import {
  getJobReleaseReadiness,
  recalculateJobRequirements,
  returnPickedRemaindersForJob,
  runMRP,
  updateJobStatus
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
 * Promote a Draft make-to-stock job to Planned from the planning drawer.
 *
 * @remarks
 * MRP does not count a Draft job as supply, so a Draft job and a Make
 * suggestion for the same need sat side by side and could both be built. In
 * order, as `releaseJobs` does: the requirements recalculation (a failure
 * stops here, with the job still Draft, so MRP never counts a job whose
 * requirements are stale), the guarded status flip (only from Draft), then MRP
 * — which now counts the job, so the Make suggestion shrinks by it. No
 * scheduler notice: the scheduler places only released jobs
 * (`activeJobStatuses`), and a Planned job's dates and priority are unchanged.
 * The caller has checked the job's location and that no sales order owns it.
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
 * Release jobs to the floor: the one path the job page and batch release share.
 *
 * @remarks
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
export const releaseJobs = defineServiceFn({
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

    const released = await releaseJobs(ctx, {
      jobIds: toRelease,
      purchaseOrdersBySupplierId: purchaseOrders
    });
    if (released.error) return released.error;
    if (released.data.failure) return released.data.failure;
    return { releasedJobIds: released.data.releasedJobIds };
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
