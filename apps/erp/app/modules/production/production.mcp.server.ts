import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database, Json } from "@carbon/database";
import { evaluateLinesForSurface, isBlocked } from "@carbon/ee/rules.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { deleteMaintenanceDispatchItem as deleteMaintenanceDispatchItemCommand } from "~/modules/resources/resources.mcp.server";
import { getDatabaseClient } from "~/services/database.server";
import { commandError } from "~/services/mcp-command-error";
import {
  requireToolCompanyRecord,
  requireToolPermission
} from "~/services/mcp-guards.server";
import type {
  jobMaterialValidator,
  jobOperationStatus,
  jobOperationValidator,
  jobStatus
} from "./production.models";
import {
  createJobOperation,
  deleteJobOperationWithDependencies,
  prepareAssemblyPlanRun,
  setJobOperationStatus,
  startAssemblyPlanRun,
  transitionJobStatus
} from "./production.server";
import {
  pullJobMaterialMakeMethod,
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  upsertJobMaterial as upsertJobMaterialRow,
  upsertJobOperation as upsertJobOperationRow
} from "./production.service";

// MCP-exposed production writes that depend on server-only modules
// (`@carbon/auth/users.server`, `@carbon/ee/rules.server`). These CANNOT
// live in `production.service.ts`: that file is re-exported by the
// `~/modules/production` barrel, which client components value-import, so it is
// part of the client bundle and React Router's dot-server plugin rejects any
// `.server` reference reachable from it. This module is server-only (never
// re-exported by the barrel) and is pulled into the MCP tool set by
// `scripts/generate-mcp.ts` + the Carbon API registry
// (`api+/v1+/lib/registry.server.ts`), which run server-side only.
//
// The MCP executor injects companyId/userId from the OAuth token but performs no
// per-tool permission check, and some of these writes reach privileged paths (a
// SECURITY DEFINER RPC, an Inngest trigger) that bypass RLS — so the ERP route's
// permission gate is re-applied inline via `hasPermission` on the caller's claims.

/**
 * Issue material to a job operation, enforcing work-center material-issue rules first.
 * Wraps the `issue` edge function (type "partToOperation").
 *
 * The work-center rule check fails closed: a failed or empty operation lookup throws rather
 * than silently skipping the rule and letting the edge function run unchecked.
 */
export async function issueMaterial(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    operationId: string;
    itemId: string;
    quantity: number;
    materialId?: string;
    jobOperationStepId?: string;
    adjustmentType?: string;
    acknowledged?: boolean;
  }
) {
  const { data: jobOp, error: jobOpError } = await client
    .from("jobOperation")
    .select("workCenterId")
    .eq("id", args.operationId)
    .eq("companyId", companyId)
    .maybeSingle();
  // Fail closed: a failed or empty lookup must not silently skip the work-center
  // material-issue rule and let the `issue` edge function run unchecked.
  if (jobOpError || !jobOp) {
    throw new Error(`Job operation ${args.operationId} was not found.`);
  }
  const workCenterId = jobOp.workCenterId;
  if (workCenterId) {
    const ruleEval = await evaluateLinesForSurface({
      client,
      companyId,
      userId,
      targetType: "workCenter",
      surface: "materialIssue",
      lines: [
        {
          lineId: args.operationId,
          itemId: args.itemId,
          workCenterId,
          operation: {
            id: args.operationId,
            itemId: args.itemId,
            quantity: args.quantity,
            workInstructionId: null
          },
          quantity: args.quantity
        }
      ]
    });
    if (
      ruleEval.violations.length > 0 &&
      isBlocked(ruleEval.violations, args.acknowledged ?? false)
    ) {
      throw new Error(
        `Material issue blocked by a work-center rule: ${ruleEval.violations
          .map((v) => v.message)
          .join("; ")}`
      );
    }
  }

  return client.functions.invoke("issue", {
    body: {
      id: args.operationId,
      type: "partToOperation",
      itemId: args.itemId,
      materialId: args.materialId,
      jobOperationStepId: args.jobOperationStepId,
      quantity: args.quantity,
      adjustmentType: args.adjustmentType,
      companyId,
      userId
    }
  });
}

/**
 * Complete a job to inventory (finished goods, backflush, cost rollup). Wraps the
 * `complete_job_to_inventory` RPC — the same entry point the ERP job-complete route uses.
 *
 * The RPC is SECURITY DEFINER (bypasses RLS) and the MCP endpoint does not enforce per-tool
 * claims, so the ERP route's `{ update: "production" }` gate is re-applied here to prevent an
 * unprivileged MCP caller from completing jobs.
 */
export async function completeJob(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    jobId: string;
    quantity: number;
    storageUnitId?: string;
    locationId?: string;
  }
) {
  const claims = await getUserClaims(userId, companyId);
  if (!hasPermission(claims?.permissions, "production", "update", companyId)) {
    throw new Error(
      "You do not have permission to complete jobs to inventory (production update)."
    );
  }
  return client.rpc("complete_job_to_inventory", {
    p_job_id: args.jobId,
    p_quantity_complete: args.quantity,
    p_storage_unit_id: args.storageUnitId ?? undefined,
    p_location_id: args.locationId ?? undefined,
    p_company_id: companyId,
    p_user_id: userId
  });
}

/**
 * Schedule or reschedule a job's operations. Routes through
 * `recalculateJobOperationDependencies`, which resolves the job's location and
 * regenerates the whole location IN-PROCESS via `@carbon/planning`
 * (`runLocationSchedule`) — the same in-process path the rest of the app uses now
 * that the `schedule` edge function is gone. Forecast-first scheduling is a single
 * forward-ASAP pass, so there are no `mode`/`direction` knobs to validate.
 *
 * The scheduling path has no gate of its own — every ERP route that reschedules
 * does `requirePermissions({ update: "production" })` first — so the same
 * `production` update gate is re-applied here (the MCP executor performs no
 * per-tool check). `client` MUST stay named `client` and first — the MCP executor
 * injects it positionally by that exact name; renaming breaks the tool.
 */
export async function scheduleJob(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    jobId: string;
  }
) {
  const claims = await getUserClaims(userId, companyId);
  if (!hasPermission(claims?.permissions, "production", "update", companyId)) {
    throw new Error(
      "You do not have permission to schedule jobs (production update)."
    );
  }
  return recalculateJobOperationDependencies(client, getDatabaseClient(), {
    jobId: args.jobId,
    companyId,
    userId
  });
}

/**
 * Upsert a job material WITH the route-level orchestration the bare service
 * function lacks. Shadows `production.service.ts`'s `upsertJobMaterial` in the
 * MCP/API registry (the mcp.server spread wins), so the published tool name is
 * unchanged; the ERP routes keep calling the service directly and run this
 * orchestration themselves.
 *
 * Without this, a connector-created material sat at `estimatedQuantity = 0`
 * (the column default — the requirements recalc that fills it lives in the
 * ROUTES, not the service), and since `quantityToIssue` is GENERATED as
 * `estimatedQuantity - quantityIssued`, issue/picking pulled nothing.
 *
 * Mirrors `x+/job+/methods+/$jobId.material.new.tsx` and `.material.$id.tsx`:
 * - Make-to-Order pulls the subassembly's method — on create, and on the
 *   TRANSITION into Make to Order only (a re-pull wipes existing edits).
 * - Create recalcs requirements + operation dependencies when the job is
 *   already released (release itself recalcs the whole job, so Draft/Planned
 *   creates match the UI: estimates fill at release).
 * - Update recalcs requirements ALWAYS; dependencies when the material is
 *   Make to Order and tied to an operation.
 */
export async function upsertJobMaterial(
  client: SupabaseClient<Database>,
  jobMaterial:
    | (z.infer<typeof jobMaterialValidator> & {
        jobId: string;
        jobOperationId?: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof jobMaterialValidator> & {
        jobId: string;
        jobOperationId?: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  const isUpdate = "updatedBy" in jobMaterial;
  const userId = isUpdate ? jobMaterial.updatedBy : jobMaterial.createdBy;
  const { companyId, jobId } = jobMaterial;

  // The dependency recalc reaches the scheduling engine over Kysely (no RLS),
  // so the routes' production gate is re-applied here, like scheduleJob.
  const action = isUpdate ? ("update" as const) : ("create" as const);
  const claims = await getUserClaims(userId, companyId);
  if (!hasPermission(claims?.permissions, "production", action, companyId)) {
    throw new Error(
      `You do not have permission to ${action} job materials (production ${action}).`
    );
  }

  // Capture the previous methodType BEFORE the write — the make-method pull
  // runs only on the transition INTO "Make to Order".
  let wasMakeToOrder = false;
  if (isUpdate) {
    const existing = await client
      .from("jobMaterial")
      .select("methodType")
      .eq("id", jobMaterial.id)
      .eq("companyId", companyId)
      .single();
    if (existing.error) return existing;
    wasMakeToOrder = existing.data?.methodType === "Make to Order";
  }

  const upserted = await upsertJobMaterialRow(client, jobMaterial);
  if (upserted.error || !upserted.data) return upserted;
  const jobMaterialId = upserted.data.id;

  if (jobMaterial.methodType === "Make to Order" && !wasMakeToOrder) {
    const makeMethod = await pullJobMaterialMakeMethod(client, {
      jobMaterialId,
      itemId: jobMaterial.itemId,
      companyId,
      userId
    });
    if (makeMethod.error) {
      return { data: upserted.data, error: makeMethod.error };
    }
  }

  let recalcRequirements: boolean;
  let recalcDependencies: boolean;
  if (isUpdate) {
    recalcRequirements = true;
    recalcDependencies =
      jobMaterial.methodType === "Make to Order" &&
      Boolean(jobMaterial.jobOperationId);
  } else {
    const job = await client
      .from("job")
      .select("status")
      .eq("id", jobId)
      .single();
    const isReleased = !["Draft", "Planned"].includes(job.data?.status ?? "");
    recalcRequirements = isReleased;
    recalcDependencies = isReleased;
  }

  if (recalcRequirements) {
    const requirements = await recalculateJobMakeMethodRequirements(client, {
      id: jobMaterial.jobMakeMethodId,
      companyId,
      userId
    });
    if (requirements.error) {
      return { data: upserted.data, error: requirements.error };
    }
  }
  if (recalcDependencies) {
    const dependencies = await recalculateJobOperationDependencies(
      client,
      getDatabaseClient(),
      { jobId, companyId, userId }
    );
    if (dependencies?.error) {
      return { data: upserted.data, error: dependencies.error };
    }
  }

  return upserted;
}

/**
 * Change a job's status as the job status buttons do; Completed is refused (use production_completeJob).
 *
 * Runs the same command as the job page (`transitionJobStatus`):
 * - Ready refuses while manufacturing is blocked for the item. With
 *   `schedule: true` it is the Release dialog: release readiness, then
 *   requirements, MRP, purchase orders for outside operations, released date
 *   and a schedule run for the job's location.
 * - Planned or Ready recalculate requirements and run MRP first; Planned with
 *   `schedule: true` also reschedules the location and creates the job's
 *   purchase orders.
 * - Cancelled returns picked material and cancels the job's open picking
 *   lists first, and clears the assignee.
 * - Closed posts the job's WIP variance.
 *
 * `purchaseOrdersBySupplierId` maps a supplier id to an existing Draft
 * purchase order to add outside operations to (the dialog's choice);
 * `supplierProcessByOperationId` maps a job operation id to the supplier
 * process chosen for it. Both default to none. `id` is the job's uuid.
 */
export async function updateJobStatus(
  client: SupabaseClient<Database>,
  params: {
    id: string;
    companyId: string;
    status: (typeof jobStatus)[number];
    updatedBy: string;
    schedule?: boolean;
    purchaseOrdersBySupplierId?: Record<string, string>;
    supplierProcessByOperationId?: Record<string, string>;
  }
) {
  const { id, companyId, status, updatedBy: userId } = params;
  await requireToolPermission(
    userId,
    companyId,
    "production",
    "update",
    "change job status"
  );
  await requireToolCompanyRecord("job", companyId, { id }, "Job");
  if (status === "Completed") {
    throw new Error(
      "Completing a job receives it into inventory and backflushes its materials; use production_completeJob instead of a status change."
    );
  }

  const result = await transitionJobStatus(client, {
    jobId: id,
    companyId,
    userId,
    status,
    schedule: params.schedule,
    purchaseOrdersBySupplierId: params.purchaseOrdersBySupplierId,
    supplierProcessByOperationId: params.supplierProcessByOperationId
  });
  if (result.error) {
    return {
      data: result.data,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}

/**
 * Create or update a job operation as the operation form does. Create also recalculates the make method's requirements and the job's operation dependencies.
 *
 * `createdBy` vs `updatedBy` picks create vs update. On create the job and
 * `jobMakeMethodId` must belong to the company and the make method to the job.
 * An update never moves the operation to another job or make method.
 */
export async function upsertJobOperation(
  client: SupabaseClient<Database>,
  jobOperation:
    | (z.infer<typeof jobOperationValidator> & {
        jobId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof jobOperationValidator> & {
        jobId: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  const isUpdate = "updatedBy" in jobOperation;
  const userId = isUpdate ? jobOperation.updatedBy : jobOperation.createdBy;
  const { companyId, jobId } = jobOperation;
  // Both operation routes gate on production create.
  await requireToolPermission(
    userId,
    companyId,
    "production",
    "create",
    isUpdate ? "update job operations" : "create job operations"
  );

  if (isUpdate) return upsertJobOperationRow(client, jobOperation);

  await Promise.all([
    requireToolCompanyRecord("job", companyId, { id: jobId }, "Job"),
    requireToolCompanyRecord(
      "jobMakeMethod",
      companyId,
      { id: jobOperation.jobMakeMethodId, jobId },
      "Job make method"
    )
  ]);
  const result = await createJobOperation(jobOperation);
  if (result.error) {
    return {
      data: result.data,
      error: commandError(
        result.data
          ? `Job operation ${result.data.id} was created, but ${lowerFirst(result.error.message)}`
          : result.error.message,
        result.cause
      )
    };
  }
  return { data: result.data, error: null };
}

/**
 * Delete a job operation as the operation delete action does: refused while it has recorded production events, then the job's operation dependencies are recalculated.
 *
 * `jobOperationId` is the operation's uuid; an unknown id is an error.
 */
export async function deleteJobOperation(
  client: SupabaseClient<Database>,
  jobOperationId: string,
  companyId: string,
  userId: string
) {
  await requireToolPermission(
    userId,
    companyId,
    "production",
    "delete",
    "delete job operations"
  );
  const result = await deleteJobOperationWithDependencies(client, {
    id: jobOperationId,
    companyId,
    userId
  });
  if (result.error) {
    return {
      data: result.data,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}

/**
 * Remove a spare part from a maintenance dispatch and return it to inventory, as the dispatch's item delete action does.
 *
 * `maintenanceDispatchItemId` is the dispatch item's row id (the `id` from
 * the dispatch's items), not the part's item id. Refused while the dispatch
 * is locked; an unknown id is an error.
 */
export async function deleteMaintenanceDispatchItem(
  client: SupabaseClient<Database>,
  maintenanceDispatchItemId: string,
  companyId: string,
  userId: string
) {
  return deleteMaintenanceDispatchItemCommand(
    client,
    maintenanceDispatchItemId,
    companyId,
    userId
  );
}

/**
 * Start motion planning for a converted assembly model, as the assembly planning actions do: creates the plan job and sends the planning event.
 *
 * Refused until the model has finished converting, while the geometry
 * service is unavailable, or while a plan run for the model is live. A stale
 * Queued/Processing run is marked Failed first. Returns the new plan job's id
 * (null when only the worker's own row will exist).
 */
export async function createAssemblyPlanJob(
  client: SupabaseClient<Database>,
  args: { modelUploadId: string; companyId: string; userId: string }
) {
  const { modelUploadId, companyId, userId } = args;
  await requireToolPermission(
    userId,
    companyId,
    "production",
    "update",
    "plan assemblies"
  );
  const model = await client
    .from("modelUpload")
    .select("processingStatus")
    .eq("id", modelUploadId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (model.error || !model.data) throw new Error("Model not found.");

  const ready = await prepareAssemblyPlanRun(client, {
    modelUploadId,
    companyId,
    processingStatus: model.data.processingStatus
  });
  if (ready.error) {
    return {
      data: null,
      error: commandError(ready.error.message, ready.cause)
    };
  }
  const started = await startAssemblyPlanRun(client, {
    modelUploadId,
    companyId,
    userId
  });
  return { data: { id: started.data?.planJobId ?? null }, error: null };
}

/**
 * Set a job operation's status as the operation status control does; Done also returns picked material still staged at the line (the job may complete).
 *
 * `id` is the job operation's uuid. A failed material return is reported as
 * an error after the status has changed.
 */
export async function updateJobOperationStatus(
  client: SupabaseClient<Database>,
  id: string,
  status: (typeof jobOperationStatus)[number],
  companyId: string,
  userId: string
) {
  await requireToolPermission(
    userId,
    companyId,
    "production",
    "update",
    "change job operation status"
  );
  await requireToolCompanyRecord(
    "jobOperation",
    companyId,
    { id },
    "Job operation"
  );
  const result = await setJobOperationStatus(client, {
    id,
    companyId,
    userId,
    status
  });
  if (result.error) {
    return {
      data: result.data,
      error: commandError(result.error.message, result.cause)
    };
  }
  return { data: result.data, error: null };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
