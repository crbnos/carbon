import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database, Json } from "@carbon/database";
import {
  evaluateLinesForSurface,
  isBlocked
} from "@carbon/ee/storage-rules.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { getDatabaseClient } from "~/services/database.server";
import type { jobMaterialValidator } from "./production.models";
import {
  pullJobMaterialMakeMethod,
  recalculateJobMakeMethodRequirements,
  recalculateJobOperationDependencies,
  upsertJobMaterial as upsertJobMaterialRow
} from "./production.service";

// MCP-exposed production writes that depend on server-only modules
// (`@carbon/auth/users.server`, `@carbon/ee/storage-rules.server`). These CANNOT
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
 * regenerates the whole location IN-PROCESS via `@carbon/ee/planning`
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
