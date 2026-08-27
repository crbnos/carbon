import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import {
  evaluateLinesForSurface,
  isBlocked
} from "@carbon/ee/storage-rules.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { triggerJobSchedule } from "./production.service";

// MCP-exposed production writes that depend on server-only modules
// (`@carbon/auth/users.server`, `@carbon/ee/storage-rules.server`). These CANNOT
// live in `production.service.ts`: that file is re-exported by the
// `~/modules/production` barrel, which client components value-import, so it is
// part of the client bundle and React Router's dot-server plugin rejects any
// `.server` reference reachable from it. This module is server-only (never
// re-exported by the barrel) and is pulled into the MCP tool set by
// `scripts/generate-mcp.ts` + `direct-executor.ts`, which run server-side only.
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
 * Schedule or reschedule a job's operations. Routes through `triggerJobSchedule` (the Inngest
 * scheduling path) rather than invoking the `schedule` edge function directly, so the MCP entry
 * point uses the same validated dispatch the rest of the app does. Invalid `mode`/`direction`
 * strings are rejected up front rather than only at the edge function.
 *
 * `triggerJobSchedule` fires an Inngest event with no gate of its own — every ERP route that
 * calls it does `requirePermissions({ update: "production" })` first — so the same
 * `production` update gate is re-applied here (the MCP executor performs no per-tool check).
 * `client` is unused (the work is an Inngest event) but MUST stay named `client` and first —
 * the MCP executor injects it positionally by that exact name; renaming breaks the tool.
 */
export async function scheduleJob(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    jobId: string;
    mode?: "initial" | "reschedule";
    direction?: "backward" | "forward";
  }
) {
  const claims = await getUserClaims(userId, companyId);
  if (!hasPermission(claims?.permissions, "production", "update", companyId)) {
    throw new Error(
      "You do not have permission to schedule jobs (production update)."
    );
  }
  const mode = args.mode ?? "reschedule";
  const direction = args.direction ?? "backward";
  if (mode !== "initial" && mode !== "reschedule") {
    throw new Error(
      `Invalid schedule mode "${mode}". Expected "initial" or "reschedule".`
    );
  }
  if (direction !== "backward" && direction !== "forward") {
    throw new Error(
      `Invalid schedule direction "${direction}". Expected "backward" or "forward".`
    );
  }
  return triggerJobSchedule(args.jobId, companyId, userId, mode, direction);
}
