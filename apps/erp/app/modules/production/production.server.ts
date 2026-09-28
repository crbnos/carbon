import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { runLocationSchedule } from "@carbon/planning";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelOpenPickingListsForJob } from "~/modules/inventory/inventory.service";
import {
  type CommandResult,
  commandFailed,
  commandOk
} from "~/services/command-result";
import { getDatabaseClient } from "~/services/database.server";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import {
  isAssemblyPlanRunning,
  type jobOperationStatus,
  type jobStatus
} from "./production.models";
import {
  createAssemblyPlanJob,
  getJobReleaseReadiness,
  getLatestAssemblyPlanJob,
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  recalculateJobRequirements,
  returnPickedRemaindersForJob,
  returnPickedRemaindersForOperation,
  runMRP,
  updateJobOperationStatus,
  updateJobStatus,
  upsertJobOperation
} from "./production.service";

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
// each supplier's outside operations from every member job on one PO.
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
}): Promise<{ error: string | null }> {
  const serviceRole = getCarbonServiceRole();
  const purchaseOrders = { ...purchaseOrdersBySupplierId };

  for (const id of jobIds) {
    const recalc = await recalculateJobRequirements(serviceRole, {
      id,
      companyId,
      userId
    });
    if (recalc.error) return { error: `Failed to recalculate job ${id}` };

    await runMRP(serviceRole, db, { type: "job", id, companyId, userId });

    const update = await updateJobStatus(client, {
      id,
      companyId,
      status: "Ready",
      updatedBy: userId
    });
    if (update.error) return { error: `Failed to release job ${id}` };

    const purchaseOrder = await serviceRole.functions.invoke<{
      purchaseOrderIdsBySupplierId?: Record<string, string>;
    }>("create", {
      body: {
        type: "purchaseOrderFromJob",
        jobId: id,
        purchaseOrdersBySupplierId: purchaseOrders,
        companyId,
        userId
      }
    });
    if (purchaseOrder.error) {
      return {
        error: await getEdgeFunctionErrorMessage(
          purchaseOrder.error,
          `Failed to create purchase orders for job ${id}`
        )
      };
    }
    Object.assign(
      purchaseOrders,
      purchaseOrder.data?.purchaseOrderIdsBySupplierId ?? {}
    );

    await client
      .from("job")
      .update({ releasedDate: datetime.timestamp() })
      .eq("id", id)
      .eq("companyId", companyId);
  }
  return { error: null };
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

  const problems = readiness.data.jobs.flatMap((job) => [
    ...(job.manufacturingBlocked
      ? [`${job.jobId}: manufacturing is blocked`]
      : []),
    ...(job.missingAssemblies.length > 0
      ? [
          `${job.jobId}: no operations on ${job.missingAssemblies
            .map((m) => m.description)
            .join(", ")}`
        ]
      : []),
    // No per-operation supplier picker here: an ambiguous or missing supplier
    // is settled on the job's own Release.
    ...job.outsideOperationsWithoutSupplier.map((op) =>
      op.missing === "choose"
        ? `${job.jobId}: choose a supplier for ${op.description} on the job`
        : `${job.jobId}: ${op.description} has no supplier`
    )
  ]);
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

// ---------------------------------------------------------------------------
// Route commands. Each is ONE UI action, called by its route and published
// under the tool name of the bare primitive it replaces by a same-named export
// in `production.mcp.server.ts`, so MCP, the in-app agent and workflows run
// exactly what the UI runs. Request concerns (auth, form parsing, flash,
// redirect) stay in the route; the wrapper re-applies the route's gates.
// ---------------------------------------------------------------------------

const logger = getLogger("erp", "production-commands");

type JobStatus = (typeof jobStatus)[number];

/**
 * Move a job to a new status with everything the job status route runs for
 * that target (`x+/job+/$jobId.status.tsx`):
 * - Ready refuses while the item's manufacturing is blocked.
 * - Ready with `schedule` is the Release dialog: release readiness, the
 *   dialog's supplier choices, `releaseJobs` (requirements, MRP, status,
 *   purchase orders, released date), then one schedule run for the location.
 * - Planned or Ready without `schedule`: requirements recalc and MRP, then the
 *   status write. Planned with `schedule` also stamps supplier choices,
 *   reschedules the location and creates the job's purchase orders.
 * - Cancelled first returns picked material and cancels the job's open
 *   picking lists; either failure aborts before the status changes.
 * - Closed posts the job's WIP variance through `close-job` after the write.
 *
 * Completed is not handled here: the Complete button runs
 * `$jobId.complete.tsx` (`complete_job_to_inventory`), and a bare Completed
 * skips the receipt and backflush. Callers must refuse it before this runs;
 * the route never receives it from the UI.
 */
export async function transitionJobStatus(
  client: SupabaseClient<Database>,
  args: {
    jobId: string;
    companyId: string;
    userId: string;
    status: JobStatus;
    schedule?: boolean;
    purchaseOrdersBySupplierId?: Record<string, string>;
    supplierProcessByOperationId?: Record<string, string>;
  }
): Promise<CommandResult<{ id: string; status: JobStatus }>> {
  const { jobId: id, companyId, userId, status } = args;
  const shouldSchedule = args.schedule === true;
  const purchaseOrdersBySupplierId = args.purchaseOrdersBySupplierId ?? {};
  const supplierChoices = args.supplierProcessByOperationId ?? {};
  const serviceRole = getCarbonServiceRole();

  if (status === "Ready") {
    const { data } = await client
      .from("job")
      .select("item(itemReplenishment(manufacturingBlocked))")
      .eq("id", id)
      .single();
    if (data?.item?.itemReplenishment?.manufacturingBlocked) {
      return commandFailed("Manufacturing is blocked");
    }
  }

  if (status === "Ready" && shouldSchedule) {
    const readiness = await getJobReleaseReadiness(client, [id], companyId);
    const missing = readiness.data?.jobs[0]?.missingAssemblies ?? [];
    if (readiness.error) {
      return commandFailed("Failed to validate job", readiness.error);
    }
    if (missing.length > 0) {
      return commandFailed(
        `Assign an operation to each assembly before releasing: ${missing
          .map((m) => m.description)
          .join(", ")}`
      );
    }

    try {
      await stampSupplierChoices({
        jobId: id,
        companyId,
        userId,
        choices: supplierChoices
      });
    } catch (err) {
      return commandFailed("Failed to save the supplier choice", err);
    }

    const released = await releaseJobs({
      client,
      db: getDatabaseClient(),
      jobIds: [id],
      companyId,
      userId,
      purchaseOrdersBySupplierId
    });
    if (released.error) return commandFailed(released.error);

    try {
      await scheduleJobLocation({ id, companyId, userId });
    } catch (err) {
      logger.error("Error", { error: err });
      return commandFailed("Failed to schedule job", err);
    }
    return commandOk({ id, status });
  }

  if (status === "Planned" || status === "Ready") {
    await recalculateJobRequirements(serviceRole, { id, companyId, userId });
    await runMRP(serviceRole, getDatabaseClient(), {
      type: "job",
      id,
      companyId,
      userId
    });
  }

  // The status is committed BEFORE the scheduler runs: scheduling only batches
  // jobs already Ready/In Progress/Paused.
  if (status === "Cancelled") {
    const sweep = await returnPickedRemaindersForJob(serviceRole, {
      jobId: id,
      userId,
      companyId
    });
    if (sweep.error) {
      return commandFailed(
        "Cancel aborted: returning picked material failed",
        sweep.error
      );
    }
    const picks = await cancelOpenPickingListsForJob(getDatabaseClient(), {
      jobId: id,
      companyId,
      userId
    });
    if (picks.error) {
      return commandFailed(
        "Cancel aborted: its picking lists could not be closed",
        picks.error
      );
    }
  }

  const update = await updateJobStatus(client, {
    id,
    companyId,
    status,
    assignee: status === "Cancelled" ? null : undefined,
    updatedBy: userId
  });
  if (update.error) {
    return commandFailed("Failed to update job status", update.error);
  }

  if (status === "Planned" && shouldSchedule) {
    try {
      await stampSupplierChoices({
        jobId: id,
        companyId,
        userId,
        choices: supplierChoices
      });
      await Promise.all([
        scheduleJobLocation({ id, companyId, userId }),
        serviceRole.functions.invoke("create", {
          body: {
            type: "purchaseOrderFromJob",
            jobId: id,
            purchaseOrdersBySupplierId,
            companyId,
            userId
          }
        })
      ]);
    } catch (err) {
      logger.error("Error", { error: err });
      return commandFailed("Failed to schedule job", err, { id, status });
    }
  }

  if (status === "Closed") {
    await serviceRole.functions.invoke("close-job", {
      body: { jobId: id, userId, companyId }
    });
  }

  return commandOk({ id, status });
}

// Forecast-first scheduling regenerates the whole location the job is in,
// in-process (Node). Throws on failure.
async function scheduleJobLocation({
  id,
  companyId,
  userId
}: {
  id: string;
  companyId: string;
  userId: string;
}) {
  const serviceRole = getCarbonServiceRole();
  const { data: jobLocation } = await serviceRole
    .from("job")
    .select("locationId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (!jobLocation?.locationId) {
    throw new Error("Job has no location to schedule");
  }
  await runLocationSchedule({
    db: getDatabaseClient(),
    client: serviceRole,
    locationId: jobLocation.locationId,
    companyId,
    userId
  });
}

// The release dialog's supplier pick for an outside operation whose process
// has several suppliers, stamped on the operation so purchaseOrderFromJob
// resolves it. Must land BEFORE the purchase orders are created. Both ids come
// from the caller and drive a service-role write, so the operation must belong
// to THIS job and the supplier process to that operation's own process.
async function stampSupplierChoices({
  jobId,
  companyId,
  userId,
  choices
}: {
  jobId: string;
  companyId: string;
  userId: string;
  choices: Record<string, string>;
}) {
  const serviceRole = getCarbonServiceRole();
  const operationSupplierChoices = Object.entries(choices);
  if (operationSupplierChoices.length === 0) return;

  const operationIds = operationSupplierChoices.map(
    ([operationId]) => operationId
  );
  const supplierProcessIds = operationSupplierChoices.map(([, sp]) => sp);

  const [
    { data: jobOperations, error: jobOperationsError },
    { data: supplierProcesses, error: supplierProcessesError }
  ] = await Promise.all([
    serviceRole
      .from("jobOperation")
      .select("id, processId")
      .eq("jobId", jobId)
      .eq("companyId", companyId)
      .in("id", operationIds),
    serviceRole
      .from("supplierProcess")
      .select("id, processId")
      .eq("companyId", companyId)
      .in("id", supplierProcessIds)
  ]);
  if (jobOperationsError) throw new Error(jobOperationsError.message);
  if (supplierProcessesError) throw new Error(supplierProcessesError.message);

  const operationProcessById = new Map(
    (jobOperations ?? []).map((op) => [op.id, op.processId])
  );
  const supplierProcessProcessById = new Map(
    (supplierProcesses ?? []).map((sp) => [sp.id, sp.processId])
  );

  for (const [operationId, supplierProcessId] of operationSupplierChoices) {
    const operationProcessId = operationProcessById.get(operationId);
    if (!operationProcessId) {
      throw new Error(`Operation ${operationId} does not belong to this job`);
    }
    if (
      supplierProcessProcessById.get(supplierProcessId) !== operationProcessId
    ) {
      throw new Error(
        "Selected supplier does not belong to the operation's process"
      );
    }
  }

  const updateResults = await Promise.all(
    operationSupplierChoices.map(([operationId, supplierProcessId]) =>
      serviceRole
        .from("jobOperation")
        .update({
          operationSupplierProcessId: supplierProcessId,
          updatedBy: userId
        })
        .eq("id", operationId)
        .eq("companyId", companyId)
    )
  );
  const failedUpdate = updateResults.find((result) => result.error);
  if (failedUpdate?.error) throw new Error(failedUpdate.error.message);
}

/**
 * Create a job operation as the operation form does
 * (`x+/job+/methods+/$jobId.operation.new.tsx`): the job and its make method
 * must belong to the company, the row is inserted on the service role, then
 * the make method's requirements and the job's operation dependencies are
 * recalculated. A recalc failure is reported with the created id.
 */
export async function createJobOperation(
  operation: Parameters<typeof upsertJobOperation>[1] & { createdBy: string }
): Promise<CommandResult<{ id: string }>> {
  const serviceRole = getCarbonServiceRole();
  const { jobId, companyId, createdBy: userId } = operation;

  const insert = await upsertJobOperation(serviceRole, operation);
  const jobOperationId = insert.data?.id;
  if (insert.error || !jobOperationId) {
    return commandFailed("Failed to insert job operation", insert.error);
  }

  const [requirements, dependencies] = await Promise.all([
    recalculateJobMakeMethodRequirements(serviceRole, {
      id: operation.jobMakeMethodId,
      companyId,
      userId
    }),
    recalculateJobOperationDependencies(serviceRole, getDatabaseClient(), {
      jobId,
      companyId,
      userId
    })
  ]);
  if (requirements.error) {
    return commandFailed(
      "Failed to recalculate job make method requirements",
      requirements.error,
      { id: jobOperationId }
    );
  }
  if (dependencies?.error) {
    return commandFailed(
      "Failed to recalculate job operation dependencies",
      dependencies.error,
      { id: jobOperationId }
    );
  }
  return commandOk({ id: jobOperationId });
}

/**
 * Delete a job operation as the operation delete action does
 * (`x+/job+/methods+/$jobId.operation.delete.tsx`): refused while the
 * operation has recorded production events, then the job's operation
 * dependencies are recalculated. The operation must belong to the company
 * (and to `jobId` when given); an unknown id is an error.
 */
export async function deleteJobOperationWithDependencies(
  client: SupabaseClient<Database>,
  args: { id: string; jobId?: string; companyId: string; userId: string }
): Promise<CommandResult<{ id: string }>> {
  const { id, companyId, userId } = args;
  const serviceRole = getCarbonServiceRole();

  const operation = await serviceRole
    .from("jobOperation")
    .select("jobId")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (operation.error) {
    return commandFailed("Failed to read job operation", operation.error);
  }
  if (!operation.data || (args.jobId && operation.data.jobId !== args.jobId)) {
    return commandFailed("Job operation not found");
  }
  const jobId = operation.data.jobId;

  const events = await client
    .from("productionEvent")
    .select("id", { count: "exact", head: true })
    .eq("jobOperationId", id);
  if (events.error) {
    return commandFailed(
      "Failed to check for recorded production events",
      events.error
    );
  }
  if ((events.count ?? 0) > 0) {
    return commandFailed(
      "Cannot delete an operation that has recorded production events"
    );
  }

  const deleted = await client
    .from("jobOperation")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id");
  if (deleted.error) return commandFailed(deleted.error.message, deleted.error);
  if (!deleted.data?.length) return commandFailed("Job operation not found");

  const recalc = await recalculateJobOperationDependencies(
    serviceRole,
    getDatabaseClient(),
    { jobId, companyId, userId }
  );
  if (recalc?.error) {
    return commandFailed(
      "Failed to recalculate job operation dependencies",
      recalc.error,
      { id }
    );
  }
  return commandOk({ id });
}

/**
 * The preconditions every "run motion planning" action checks
 * (`x+/assembly+/$id.plan.rerun.tsx`): the model finished converting, the
 * geometry service is up, and no live plan run exists for the model. A stale
 * Queued/Processing row the liveness check rules dead is marked Failed so it
 * cannot shadow the new run.
 */
export async function prepareAssemblyPlanRun(
  client: SupabaseClient<Database>,
  args: {
    modelUploadId: string;
    companyId: string;
    processingStatus: string | null | undefined;
  }
): Promise<CommandResult<null>> {
  if (args.processingStatus !== "Success") {
    return commandFailed("The model must finish converting before planning");
  }
  if (!(await isAssemblerServiceHealthy())) {
    return commandFailed(
      "The geometry service is unavailable — motion planning can't run right now."
    );
  }
  const planJob = await getLatestAssemblyPlanJob(client, args.modelUploadId);
  if (isAssemblyPlanRunning(planJob.data)) {
    return commandFailed("Motion planning is already running");
  }
  if (
    planJob.data?.status === "Queued" ||
    planJob.data?.status === "Processing"
  ) {
    await client
      .from("assemblyPlanJob")
      .update({
        status: "Failed",
        error:
          planJob.data.status === "Queued"
            ? "Planning never started — the job event was lost"
            : "Planning run was lost (worker restarted mid-run)",
        updatedAt: new Date().toISOString()
      })
      .eq("id", planJob.data.id)
      .eq("companyId", args.companyId);
  }
  return commandOk(null);
}

/**
 * Start a motion-planning run for a converted model, as every planning action
 * does: pre-create the Queued plan job row so the UI shows the run at once,
 * then send the `assembly-plan` event carrying its id so the worker adopts the
 * row. The row insert is best-effort (the worker inserts its own row when it
 * fails); the event is what starts planning.
 */
export async function startAssemblyPlanRun(
  client: SupabaseClient<Database>,
  args: {
    modelUploadId: string;
    companyId: string;
    userId: string;
    reMotionFor?: string;
    reDetectUnits?: boolean;
  }
): Promise<CommandResult<{ planJobId: string | null }>> {
  const { modelUploadId, companyId, userId } = args;
  const created = await createAssemblyPlanJob(client, {
    modelUploadId,
    companyId,
    userId
  });
  await trigger("assembly-plan", {
    modelUploadId,
    companyId,
    userId,
    ...(created.data?.id ? { planJobId: created.data.id } : {}),
    ...(args.reMotionFor ? { reMotionFor: args.reMotionFor } : {}),
    ...(args.reDetectUnits ? { reDetectUnits: true } : {})
  });
  return commandOk({ planJobId: created.data?.id ?? null });
}

/**
 * Set a job operation's status as the operation status control does
 * (`x+/job+/methods+/operation.status.tsx`). Done may complete the job through
 * the database interceptor, so picked material still staged at the line is
 * returned afterwards; that sweep failing does not undo the status and is
 * reported with the updated row.
 */
export async function setJobOperationStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    userId: string;
    status: (typeof jobOperationStatus)[number];
  }
): Promise<CommandResult<{ id: string }>> {
  const { id, companyId, userId, status } = args;
  const update = await updateJobOperationStatus(client, id, status, userId);
  if (update.error) {
    return commandFailed("Failed to update status", update.error);
  }
  if (status === "Done") {
    const sweep = await returnPickedRemaindersForOperation(
      getCarbonServiceRole(),
      { jobOperationId: id, userId, companyId }
    );
    if (sweep?.error) {
      return commandFailed(
        "Operation updated, but returning picked material failed",
        sweep.error,
        { id }
      );
    }
  }
  return commandOk({ id });
}
