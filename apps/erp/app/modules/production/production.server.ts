// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { datetime, getErrorMessage } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { isJobLocked } from "./production.models";
import {
  getJobReleaseReadiness,
  recalculateJobRequirements,
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

// Release jobs to the floor: the one path the job page and batch release share.
// Per job, in order: refresh requirements, run MRP, flip to Ready, put outside
// operations on purchase orders, stamp releasedDate. Scheduling is the
// caller's (one location run, or a notify, after all jobs are released).
//
// `purchaseOrdersBySupplierId` maps a supplier to "new" or a Draft PO id; a
// supplier's first "new" PO is reused for the jobs after it, so a batch puts
// each supplier's outside operations from every member job on one PO. The map
// is returned with those POs filled in, for a caller releasing job by job.
// `releasedJobIds` are the jobs that ARE Ready when this returns — on an error
// after the status flip (purchase orders) the job is released, and the caller
// must still schedule it and say so.
// Validation (getJobReleaseReadiness) is the caller's, BEFORE this runs.
export async function releaseJobs({
  client,
  db,
  jobIds,
  companyId,
  userId,
  purchaseOrdersBySupplierId
}: {
  client: SupabaseClient<Database>;
  db: Kysely<KyselyDatabase>;
  jobIds: string[];
  companyId: string;
  userId: string;
  purchaseOrdersBySupplierId: Record<string, string>;
}): Promise<{
  error: string | null;
  purchaseOrdersBySupplierId: Record<string, string>;
  releasedJobIds: string[];
}> {
  const serviceRole = getCarbonServiceRole();
  const purchaseOrders = { ...purchaseOrdersBySupplierId };
  const releasedJobIds: string[] = [];
  const fail = (error: string) => ({
    error,
    purchaseOrdersBySupplierId: purchaseOrders,
    releasedJobIds
  });

  for (const id of jobIds) {
    const recalc = await recalculateJobRequirements(serviceRole, db, {
      id,
      companyId,
      userId
    });
    if (recalc.error) return fail("The job could not be recalculated");

    // A failed plan never blocks a release: the scheduled MRP run (every 3
    // hours) and Material Planning's Recalculate both repair it.
    const mrp = await runMRP(serviceRole, db, {
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
    const update = await updateJobStatus(client, {
      id,
      companyId,
      status: "Ready",
      updatedBy: userId,
      fromStatuses: ["Draft", "Planned"]
    });
    if (update.error) return fail("The job could not be released");
    if (!update.updated) {
      return fail("The job is no longer Draft or Planned");
    }
    releasedJobIds.push(id);

    const purchaseOrder = await serverFns
      .system({ db, companyId, userId })
      .invoke("create", {
        type: "purchaseOrderFromJob",
        jobId: id,
        purchaseOrdersBySupplierId: purchaseOrders
      });
    if (purchaseOrder.error) {
      return fail(
        `The job is released, but its purchase orders could not be created: ${getErrorMessage(
          purchaseOrder.error,
          "unknown error"
        )}`
      );
    }
    Object.assign(
      purchaseOrders,
      purchaseOrder.data?.purchaseOrderIdsBySupplierId ?? {}
    );

    // The date feeds the completion-time KPI and nothing else writes it, so a
    // silent failure would be permanent.
    const stamped = await client
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
      return fail(
        "The job is released, but its release date could not be saved"
      );
    }
  }
  return {
    error: null,
    purchaseOrdersBySupplierId: purchaseOrders,
    releasedJobIds
  };
}

// Releasing a batch releases its Draft/Planned member jobs through the same
// path as the job page: every one is validated first and ANY problem refuses the
// whole batch before anything changes. `purchaseOrdersBySupplierId` is the
// planner's PO choice from the Release dialog; unattended callers (bulk release)
// pass none, and a batch that needs a choice — a supplier with Draft POs to pick
// from — is refused so the planner can release it from its dialog.
export async function releaseBatchMemberJobs({
  client,
  db,
  jobIds,
  companyId,
  userId,
  purchaseOrdersBySupplierId
}: {
  client: SupabaseClient<Database>;
  db: Kysely<KyselyDatabase>;
  jobIds: string[];
  companyId: string;
  userId: string;
  purchaseOrdersBySupplierId?: Record<string, string>;
}): Promise<{ error: string | null }> {
  const jobs = await client
    .from("job")
    .select("id, status")
    .in("id", [...new Set(jobIds)])
    .eq("companyId", companyId);
  if (jobs.error) return { error: "Failed to load the batch's jobs" };

  const toRelease = (jobs.data ?? [])
    .filter((job) => job.status === "Draft" || job.status === "Planned")
    .map((job) => job.id);
  if (toRelease.length === 0) return { error: null };

  const readiness = await getJobReleaseReadiness(client, toRelease, companyId);
  if (readiness.error || !readiness.data) {
    return { error: "Failed to validate the batch's jobs" };
  }

  const problems = readiness.data.jobs.flatMap((job) =>
    jobReleaseProblems(job).map((problem) => `${job.jobId}: ${problem}`)
  );
  if (problems.length > 0) {
    return { error: `Fix these jobs before releasing: ${problems.join("; ")}` };
  }

  if (
    !purchaseOrdersBySupplierId &&
    readiness.data.suppliers.some((s) => s.draftPurchaseOrders.length > 0)
  ) {
    return {
      error:
        "Outside operations need a purchase order choice — open the batch to release it"
    };
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

  return releaseJobs({
    client,
    db,
    jobIds: toRelease,
    companyId,
    userId,
    purchaseOrdersBySupplierId: purchaseOrders
  });
}

/**
 * Write the priorities (and work center) a drop on the schedule board gives
 * several operations of one column, as one all-or-nothing statement. The
 * checks are the single-operation update's, made once for the set: every
 * operation exists and is open, its job is unlocked and at the work center's
 * location, and the work center runs its process.
 */
export async function reorderScheduleOperations(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    columnId: string;
    updates: { id: string; priority: number }[];
  }
): Promise<
  | { success: true; workCenterChanged: boolean }
  | { success: false; message: string }
> {
  const { companyId, userId, columnId, updates } = args;
  const invalid = {
    success: false as const,
    message: "Invalid scheduling request"
  };
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
    operations.data.some((o) => o.status === "Done" || o.status === "Canceled")
  ) {
    return invalid;
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
    return invalid;
  }

  const processByOperation = new Map(
    operations.data.map((o) => [o.id, o.processId])
  );

  try {
    await db.transaction().execute(async (trx) => {
      // Read again under a lock: a job completed or moved since the first read
      // must not have its operations rescheduled.
      const current = await trx
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
        throw new Error("Job unavailable");
      }

      const written = await sql<{ id: string }>`
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
      `.execute(trx);
      // An operation that finished, left or changed process since the read:
      // none are written.
      if (written.rows.length !== ids.length) {
        throw new Error("Operation unavailable");
      }
    });
  } catch (err) {
    return {
      success: false,
      message: getErrorMessage(err, "Failed to reorder operations")
    };
  }

  return {
    success: true,
    workCenterChanged: operations.data.some(
      (o) => o.workCenterId !== destination.id
    )
  };
}
