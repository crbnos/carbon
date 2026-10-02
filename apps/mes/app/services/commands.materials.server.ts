// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { evaluateLinesForSurface, isBlocked } from "@carbon/ee/rules.server";
import { getLogger } from "@carbon/logger";
import type {
  IssueMaterialBody,
  IssueTrackedBody,
  UnconsumeBody
} from "@carbon/mes-core/models";
import type { Violation } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandResult } from "./api-result.server";
import { failed, ok } from "./api-result.server";

/**
 * Material commands — issue an untracked part, issue tracked entities, and undo
 * a tracked consumption — extracted from `x+/issue.tsx`,
 * `x+/issue-tracked-entity.tsx` and `x+/unconsume.tsx` so the web MES and the
 * mobile API run ONE code path. See `commands.server.ts` for the contract.
 *
 * `client` is the SERVICE ROLE client in every caller, exactly as the three web
 * routes use it: the rule evaluator reads `storageUnits_recursive` and the
 * `issue` edge function is invoked privileged. Because RLS is bypassed, every
 * read here filters `companyId` itself — the ids arrive from a form body.
 *
 * What a rules refusal is: `{ kind: "blocked", message, details }` carrying the
 * `violations` and `ruleNames` the evaluator produced. The web routes render
 * that into exactly the body they return today (a 200 `data: null` shape for
 * `issue`, a 400 for `unconsume`); the API answers 409 with `details`.
 */

const logger = getLogger("mes", "commands.materials");

/** What a `blocked` failure carries, for a caller that renders the violations. */
export type RuleRefusalDetails = {
  violations: Violation[];
  ruleNames: Record<string, string>;
};

export type IssueTrackedResult = {
  splitEntities: unknown[];
  warning: string | undefined;
};

type Scope = { companyId: string; userId: string };

/**
 * Supabase wraps non-2xx edge-fn responses in `FunctionsHttpError` where the
 * actual body lives on `context`. Try to pull our `{ message }` out; fall back
 * to the wrapper's own message if parsing fails. Moved verbatim from
 * `x+/issue-tracked-entity.tsx`.
 */
async function issueErrorMessage(error: unknown, fallback: string) {
  let message = fallback;
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.clone().json();
      if (body && typeof body.message === "string") {
        message = body.message;
      }
    } catch {
      /* fall through to default */
    }
  } else if ((error as { message?: string }).message) {
    message = (error as { message: string }).message;
  }
  return message;
}

/**
 * Issue (or adjust) an untracked part against one operation.
 *
 * Outcomes: `not_found` when the operation is not this company's,
 * `blocked` when a workCenter-scoped `materialIssue` rule refuses it,
 * `error` (with the edge function's error in `details`) when `issue` fails.
 */
export async function issueMaterial(
  client: SupabaseClient<Database>,
  scope: Scope,
  body: IssueMaterialBody
): Promise<CommandResult<null>> {
  const { companyId, userId } = scope;
  const {
    jobOperationId,
    materialId,
    jobOperationStepId,
    itemId,
    quantity,
    adjustmentType
  } = body;
  const acknowledged = body.acknowledged === true;

  // Resolve workCenter context off the operation so workCenter-scoped rules
  // can evaluate against this materialIssue.
  // `workInstructionId` is in the runtime row but absent from the generated
  // DB types (stale until next regen). Select the typed column and let the
  // manual cast below resolve the field.
  const { data: jobOpRow } = await client
    .from("jobOperation")
    .select("workCenterId")
    .eq("id", jobOperationId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (!jobOpRow) {
    logger.warn("Job operation not found for company", {
      companyId,
      jobOperationId
    });
    return failed({ kind: "not_found", message: "Job operation not found" });
  }

  if (jobOpRow.workCenterId) {
    const ruleEval = await evaluateLinesForSurface({
      client,
      companyId,
      userId,
      targetType: "workCenter",
      surface: "materialIssue",
      lines: [
        {
          lineId: jobOperationId,
          itemId,
          workCenterId: jobOpRow.workCenterId,
          operation: {
            id: jobOperationId,
            itemId,
            quantity,
            workInstructionId:
              (jobOpRow as { workInstructionId?: string | null })
                .workInstructionId ?? null
          },
          quantity
        }
      ]
    });
    if (
      ruleEval.violations.length > 0 &&
      isBlocked(ruleEval.violations, acknowledged)
    ) {
      return failed({
        kind: "blocked",
        message:
          ruleEval.violations[0]?.message ??
          "Rule violation prevented material issue",
        details: {
          violations: ruleEval.violations,
          ruleNames: ruleEval.ruleNames
        } satisfies RuleRefusalDetails
      });
    }
  }

  const issue = await client.functions.invoke("issue", {
    body: {
      id: jobOperationId,
      type: "partToOperation",
      itemId,
      materialId,
      jobOperationStepId,
      quantity,
      adjustmentType,
      companyId,
      userId
    }
  });

  if (issue.error) {
    return failed({
      kind: "error",
      message: "Failed to issue material",
      details: issue.error
    });
  }

  return ok(null);
}

/**
 * Issue tracked entities (serial/lot) to an operation, or to every member of an
 * operation batch.
 *
 * Batch mode: one pick for the whole operation batch. The edge fn splits the
 * picked lots pro-rata by each member's remaining requirement and records
 * per-member consumption, so costing and genealogy stay per job.
 */
export async function issueTrackedEntities(
  client: SupabaseClient<Database>,
  scope: Scope,
  body: IssueTrackedBody
): Promise<CommandResult<IssueTrackedResult>> {
  const { companyId, userId } = scope;
  const {
    materialId,
    jobOperationId,
    itemId,
    batchId,
    parentTrackedEntityId,
    children,
    jobOperationStepId,
    unitNumber,
    overrideExpired,
    overrideReason
  } = body;

  if (batchId ? !itemId : !parentTrackedEntityId) {
    return failed({
      kind: "validation",
      message: "Failed to validate payload"
    });
  }

  const issue = await client.functions.invoke("issue", {
    body: batchId
      ? {
          type: "trackedEntitiesToBatch",
          batchId,
          itemId,
          children,
          overrideExpired,
          overrideReason,
          companyId,
          userId
        }
      : {
          type: "trackedEntitiesToOperation",
          materialId,
          jobOperationId,
          itemId,
          parentTrackedEntityId,
          children,
          jobOperationStepId,
          unitNumber,
          overrideExpired,
          overrideReason,
          companyId,
          userId
        }
  });

  if (issue.error) {
    logger.error("Failed to issue material", { error: issue.error });
    return failed({
      kind: "validation",
      message: await issueErrorMessage(issue.error, "Failed to issue material")
    });
  }

  // No label print on issue: the split child is CONSUMED (it departed into the
  // job) and consumed portions get no label; the surviving lineside entity
  // keeps its existing label.
  return ok({
    splitEntities: issue.data?.splitEntities || [],
    warning: issue.data?.warning as string | undefined
  });
}

/**
 * Return consumed tracked entities to stock from a job operation.
 *
 * Outcomes: `validation` when `materialId` is absent or the edge function
 * fails, `not_found` when the material is not this company's, `blocked` when a
 * workCenter-scoped `materialReceive` rule refuses it.
 */
export async function unconsumeTrackedEntities(
  client: SupabaseClient<Database>,
  scope: Scope,
  body: UnconsumeBody
): Promise<CommandResult<null>> {
  const { companyId, userId } = scope;
  const { materialId, parentTrackedEntityId, children } = body;

  if (!materialId) {
    return failed({ kind: "validation", message: "materialId required" });
  }
  const acknowledged = Boolean(body.acknowledged);

  // materialReceive surface — return-to-stock from a job operation. Resolve
  // workCenter via jobMaterial → jobOperation. Skip rule eval if material's
  // operation is unresolvable (consistent with permissive-fallback elsewhere).
  const { data: matRow } = await client
    .from("jobMaterial")
    .select("jobOperationId, itemId, quantity")
    .eq("id", materialId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (!matRow) {
    logger.warn("Job material not found for company", {
      companyId,
      materialId
    });
    return failed({ kind: "not_found", message: "Material not found" });
  }

  if (matRow.jobOperationId) {
    // `workInstructionId` is in the runtime row but absent from the generated
    // DB types (stale until next regen). Select only the typed column;
    // pick up `workInstructionId` via cast below.
    const { data: jobOpRow } = await client
      .from("jobOperation")
      .select("workCenterId")
      .eq("id", matRow.jobOperationId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (jobOpRow?.workCenterId) {
      const workInstructionId =
        (jobOpRow as { workInstructionId?: string | null }).workInstructionId ??
        null;
      const ruleEval = await evaluateLinesForSurface({
        client,
        companyId,
        userId,
        targetType: "workCenter",
        surface: "materialReceive",
        lines: [
          {
            lineId: materialId,
            itemId: (matRow.itemId as string | null) ?? null,
            workCenterId: jobOpRow.workCenterId,
            operation: {
              id: matRow.jobOperationId,
              itemId: (matRow.itemId as string | null) ?? null,
              quantity: matRow.quantity ?? null,
              workInstructionId
            },
            quantity: matRow.quantity ?? 0
          }
        ]
      });
      if (
        ruleEval.violations.length > 0 &&
        isBlocked(ruleEval.violations, acknowledged)
      ) {
        return failed({
          kind: "blocked",
          message:
            ruleEval.violations[0]?.message ??
            "Rule violation prevented material return",
          details: {
            violations: ruleEval.violations,
            ruleNames: ruleEval.ruleNames
          } satisfies RuleRefusalDetails
        });
      }
    }
  }

  const issue = await client.functions.invoke("issue", {
    body: {
      type: "unconsumeTrackedEntities",
      materialId,
      parentTrackedEntityId,
      children,
      companyId,
      userId
    }
  });

  if (issue.error) {
    logger.error("Failed to issue material", { error: issue.error });
    return failed({ kind: "validation", message: "Failed to issue material" });
  }

  return ok(null);
}
