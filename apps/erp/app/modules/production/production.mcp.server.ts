// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { evaluateLinesForSurface, isBlocked } from "@carbon/ee/rules.server";
import { serverFns } from "@carbon/server-functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";
import { recalculateJobOperationDependencies } from "./production.service";

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
// Some of these writes reach privileged paths (a SECURITY DEFINER RPC, an
// Inngest trigger) that bypass RLS. The API gate (`gate` in
// `api+/v1+/lib/base.server.ts`) checks each published tool's permission for
// every caller: API keys, OAuth connectors and workflows.

/**
 * Issue material to a job operation, enforcing work-center material-issue rules first.
 * Wraps the `issue` server function (type "partToOperation").
 *
 * The work-center rule check fails closed: a failed or empty operation lookup throws rather
 * than silently skipping the rule and letting the server function run unchecked.
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
  // material-issue rule and let the `issue` server function run unchecked.
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

  return serverFns
    .as({ client, db: getDatabaseClient(), companyId, userId })
    .invoke("issue", {
      id: args.operationId,
      type: "partToOperation",
      itemId: args.itemId,
      materialId: args.materialId,
      jobOperationStepId: args.jobOperationStepId,
      quantity: args.quantity,
      adjustmentType: args.adjustmentType as
        | "Negative Adjmt."
        | "Positive Adjmt."
        | "Set Quantity"
    });
}

/**
 * Schedule or reschedule a job's operations. Routes through
 * `recalculateJobOperationDependencies`, which resolves the job's location and
 * regenerates the whole location IN-PROCESS via `@carbon/planning`
 * (`runLocationSchedule`) — the same in-process path the rest of the app uses.
 * Forecast-first scheduling is a single forward-ASAP pass, so there are no
 * `mode`/`direction` knobs to validate.
 *
 * The scheduling path has no gate of its own: the API gate checks the tool's
 * `production` update permission for every caller. `client` MUST stay named
 * `client` and first — the MCP executor injects it positionally by that exact
 * name; renaming breaks the tool.
 */
export async function scheduleJob(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  args: {
    jobId: string;
  }
) {
  return recalculateJobOperationDependencies(client, getDatabaseClient(), {
    jobId: args.jobId,
    companyId,
    userId
  });
}
