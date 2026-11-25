// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { evaluateLinesForSurface, isBlocked } from "@carbon/ee/rules.server";
import { getLogger } from "@carbon/logger";
import { EPSILON, round } from "@carbon/utils";
import { data } from "react-router";
import { itemScanTotals, planItemScanIssue } from "~/utils/itemScan";
import { erpPosting } from "./erp";
import {
  getJobOperationIssueScope,
  getSuggestedAllocationForMaterial
} from "./inventory.service";
import { issueTrackedEntityValidator } from "./models";
import {
  abilityBlockRefusal,
  childrenConsumedInto
} from "./operations.service";
import { resolveWorkUnit } from "./work-unit.server";

const logger = getLogger("mes", "issue");

type Caller = { companyId: string; userId: string };
type Refusal = { success: false; message: string };
const refuse = (message: string): Refusal => ({ success: false, message });

/**
 * The work center's rules that block a material movement at an operation, or
 * null when none does (or the operation has no work center).
 */
async function workCenterRuleBlock(
  { companyId, userId }: Caller,
  input: {
    jobOperationId: string;
    itemId: string;
    quantity: number;
    workCenterId: string | null;
    surface: "materialIssue" | "materialReceive";
    acknowledged: boolean;
  }
) {
  if (!input.workCenterId) return null;
  const { jobOperationId, itemId, quantity } = input;
  const ruleEval = await evaluateLinesForSurface({
    client: await getCarbonServiceRole(),
    companyId,
    userId,
    targetType: "workCenter",
    surface: input.surface,
    lines: [
      {
        lineId: jobOperationId,
        itemId,
        workCenterId: input.workCenterId,
        operation: {
          id: jobOperationId,
          itemId,
          quantity,
          workInstructionId: null
        },
        quantity
      }
    ]
  });
  if (
    ruleEval.violations.length === 0 ||
    !isBlocked(ruleEval.violations, input.acknowledged)
  ) {
    return null;
  }
  return {
    error: null,
    data: null,
    violations: ruleEval.violations,
    ruleNames: ruleEval.ruleNames
  };
}

/**
 * Issues an untracked material to a job operation, behind the gates every
 * caller shares: the operation is the company's, the operator's ability, and
 * the work center's rules (returned as violations until acknowledged).
 */
export async function issueMaterialToOperation(
  { companyId, userId }: Caller,
  input: {
    jobOperationId: string;
    itemId: string;
    materialId?: string;
    jobOperationStepId?: string;
    quantity: number;
    adjustmentType: "Set Quantity" | "Positive Adjmt." | "Negative Adjmt.";
    acknowledged?: boolean;
    /** Refuse an issue above what the job requires (an item scan). */
    refuseOverIssue?: boolean;
  }
) {
  const { jobOperationId, itemId, quantity, adjustmentType } = input;
  const serviceRole = await getCarbonServiceRole();

  const { data: jobOperation } = await serviceRole
    .from("jobOperation")
    .select("workCenterId")
    .eq("id", jobOperationId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!jobOperation) {
    logger.warning("Job operation not found for company", {
      companyId,
      jobOperationId
    });
    return refuse("Job operation not found");
  }

  const refusal = await abilityBlockRefusal(serviceRole, {
    operationId: jobOperationId,
    employeeId: userId,
    companyId
  });
  if (refusal) {
    logger.info("Material issue refused by operation ability", {
      companyId,
      jobOperationId,
      userId
    });
    return refuse(refusal);
  }

  const blocked = await workCenterRuleBlock(
    { companyId, userId },
    {
      jobOperationId,
      itemId,
      quantity,
      workCenterId: jobOperation.workCenterId,
      surface:
        adjustmentType === "Positive Adjmt."
          ? "materialReceive"
          : "materialIssue",
      acknowledged: input.acknowledged ?? false
    }
  );
  if (blocked) return blocked;

  const issued = await erpPosting(
    "issue",
    { companyId, userId },
    {
      id: jobOperationId,
      type: "partToOperation",
      itemId,
      materialId: input.materialId,
      jobOperationStepId: input.jobOperationStepId,
      quantity,
      adjustmentType,
      refuseOverIssue: input.refuseOverIssue
    }
  );
  if (issued.error) {
    const context = { companyId, jobOperationId, itemId, error: issued.error };
    if (issued.error.status < 500) {
      logger.warning("Material issue refused", context);
      return refuse(issued.error.message);
    }
    logger.error("Failed to issue material", context);
    return refuse("Failed to issue material");
  }

  return { success: true as const };
}

/**
 * Scanned item stickers on an operation screen. Each scan of a part is one
 * piece, so the operator scans once for each piece taken off the shelf;
 * `pieces` is how many scans of the item this call carries. A material or
 * consumable is issued by measure: all the job still needs. A batch part
 * takes the lots the picking order suggests at the job's location. The ERP
 * refuses an untracked issue above the requirement under the material's lock,
 * so a scan that lost a race issues nothing.
 *
 * The result holds numbers, not a sentence: the screen words the toast in the
 * operator's language. A refusal with `materialId` is one the Issue dialog
 * can settle (the operator chooses the unit, the lot, or acknowledges a rule).
 * One with `pickUnit` names no unit where one must be: the screen asks for it.
 */
export async function issueScannedItem(
  caller: Caller,
  input: {
    jobOperationId: string;
    itemId: string;
    pieces?: number;
    parentTrackedEntityId?: string;
  },
  deps: {
    client: Awaited<ReturnType<typeof getCarbonServiceRole>>;
    post: typeof erpPosting;
  } = { client: getCarbonServiceRole(), post: erpPosting }
): Promise<
  | {
      success: true;
      name: string;
      /** What this call issued. */
      quantity: number;
      /** What the operation has, and requires, of the item after it. */
      issued: number;
      required: number;
      batches: string[];
    }
  | (Refusal & { materialId?: string; pickUnit?: true })
> {
  const { companyId } = caller;
  const { jobOperationId, itemId } = input;
  const serviceRole = deps.client;

  const operation = await serviceRole
    .from("jobOperation")
    .select("jobMakeMethodId, workCenterId")
    .eq("id", jobOperationId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!operation.data?.jobMakeMethodId)
    return refuse("Job operation not found");

  const work = await resolveWorkUnit({
    client: serviceRole,
    companyId,
    operationId: jobOperationId,
    requestedUnitId: input.parentTrackedEntityId,
    mode: "require"
  });
  if (work.kind === "refuse") {
    return work.pickUnit
      ? { ...refuse(work.message), pickUnit: true }
      : refuse(work.message);
  }
  const parentTrackedEntityId =
    work.kind === "unit" ? work.unitId : input.parentTrackedEntityId;

  const materials = await serviceRole
    .from("jobMaterial")
    .select(
      "id, jobOperationId, quantity, estimatedQuantity, quantityIssued, itemType, methodType, requiresBatchTracking, requiresSerialTracking, item(readableIdWithRevision)"
    )
    .eq("jobMakeMethodId", operation.data.jobMakeMethodId)
    .eq("itemId", itemId)
    .eq("companyId", companyId);
  if (materials.error) {
    logger.error("Failed to read the job materials of a scanned item", {
      companyId,
      jobOperationId,
      itemId,
      error: materials.error
    });
    return refuse("Could not check this job's materials. Try again.");
  }

  const plan = planItemScanIssue(
    materials.data,
    jobOperationId,
    input.pieces ?? 1
  );
  if (plan.kind === "notUsed") return refuse("This job does not use that part");

  const name =
    materials.data[0]?.item?.readableIdWithRevision ?? "the scanned part";
  if (plan.kind === "full")
    return refuse(`This job already has all its ${name}`);

  const materialId = plan.material.id;
  const totals = itemScanTotals(materials.data, jobOperationId);
  const issuedResult = (quantity: number, batches: string[] = []) => ({
    success: true as const,
    name,
    quantity,
    issued: round(totals.issued + quantity),
    required: totals.required,
    batches
  });
  if (plan.kind === "dialog") {
    return { ...refuse(`Choose the ${name} to issue`), materialId };
  }

  if (plan.kind === "untracked") {
    const issued = await issueMaterialToOperation(caller, {
      jobOperationId,
      itemId,
      materialId,
      quantity: plan.quantity,
      adjustmentType: "Negative Adjmt.",
      refuseOverIssue: true
    });
    if ("violations" in issued) {
      return {
        ...refuse(`A rule applies to ${name}. Review it to issue.`),
        materialId
      };
    }
    return issued.success ? issuedResult(plan.quantity) : issued;
  }

  const refusal = await abilityBlockRefusal(serviceRole, {
    operationId: jobOperationId,
    employeeId: caller.userId,
    companyId
  });
  if (refusal) return refuse(refusal);

  // The same work-center rules the untracked issue runs.
  const blocked = await workCenterRuleBlock(caller, {
    jobOperationId,
    itemId,
    quantity: plan.quantity,
    workCenterId: operation.data.workCenterId,
    surface: "materialIssue",
    acknowledged: false
  });
  if (blocked) {
    return {
      ...refuse(`A rule applies to ${name}. Review it to issue.`),
      materialId
    };
  }

  // The lots the picking order takes first, only from the job's own location.
  const scope = await getJobOperationIssueScope(serviceRole, {
    jobOperationId,
    companyId
  });
  const lots = scope.locationId
    ? await getSuggestedAllocationForMaterial(serviceRole, {
        itemId,
        companyId,
        locationId: scope.locationId,
        quantity: plan.quantity,
        projectIds: scope.stripes
      })
    : [];
  const covered = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  if (!parentTrackedEntityId || covered < plan.quantity - EPSILON) {
    return {
      ...refuse(
        `Not enough ${name} in stock at this location. Choose the batch to issue.`
      ),
      materialId
    };
  }

  const issued = await deps.post("issue", caller, {
    type: "trackedEntitiesToOperation",
    materialId,
    parentTrackedEntityId,
    children: lots.map((lot) => ({
      trackedEntityId: lot.trackedEntityId,
      quantity: lot.quantity
    }))
  });
  if (issued.error) {
    const context = { companyId, jobOperationId, itemId, error: issued.error };
    if (issued.error.status < 500) {
      logger.warning("Scanned batch issue refused", context);
      return { ...refuse(issued.error.message), materialId };
    }
    logger.error("Failed to issue a scanned batch part", context);
    return refuse("Failed to issue material");
  }

  return issuedResult(
    plan.quantity,
    lots.map((lot) => lot.readableId).filter((id): id is string => !!id)
  );
}

/**
 * Gives parts consumed into a unit back (`x+/unconsume.tsx`). The parent is a
 * unit of the material's operation, done there or not (`member`), and every
 * part must have been consumed into it.
 */
export async function unconsumeFromUnit(
  { companyId, userId }: Caller,
  payload: unknown,
  deps: {
    client: Awaited<ReturnType<typeof getCarbonServiceRole>>;
    post: typeof erpPosting;
  }
) {
  const validation = issueTrackedEntityValidator.safeParse(payload);

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const { materialId, parentTrackedEntityId, children } = validation.data;
  const acknowledged = Boolean(
    (payload as { acknowledged?: boolean }).acknowledged
  );
  if (!materialId || !parentTrackedEntityId) {
    return data(
      {
        success: false,
        message: "materialId and parentTrackedEntityId required"
      },
      { status: 400 }
    );
  }

  const serviceRole = deps.client;

  // materialReceive surface — return-to-stock from a job operation. Resolve
  // workCenter via jobMaterial → jobOperation. Skip rule eval if material's
  // operation is unresolvable (consistent with permissive-fallback elsewhere).
  const { data: matRow } = await serviceRole
    .from("jobMaterial")
    .select("jobOperationId, itemId, quantity")
    .eq("id", materialId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (!matRow) {
    logger.warning("Job material not found for company", {
      companyId,
      materialId
    });
    return data(
      { success: false, message: "Material not found" },
      { status: 404 }
    );
  }

  if (matRow.jobOperationId) {
    const refusal = await abilityBlockRefusal(serviceRole, {
      operationId: matRow.jobOperationId,
      employeeId: userId,
      companyId
    });
    if (refusal) {
      return data({ success: false, message: refusal }, { status: 403 });
    }

    // `workInstructionId` is in the runtime row but absent from the generated
    // DB types (stale until next regen). Select only the typed column;
    // pick up `workInstructionId` via cast below.
    const { data: jobOpRow } = await serviceRole
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
        client: serviceRole,
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
        return data(
          {
            success: false,
            message:
              ruleEval.violations[0]?.message ??
              "Rule violation prevented material return",
            violations: ruleEval.violations,
            ruleNames: ruleEval.ruleNames
          },
          { status: 400 }
        );
      }
    }
  }

  // The parent must be this operation's unit, and every part given back must
  // have been consumed into it: the posting writes that lineage as sent.
  const parent = matRow.jobOperationId
    ? await resolveWorkUnit({
        client: serviceRole,
        companyId,
        operationId: matRow.jobOperationId,
        requestedUnitId: parentTrackedEntityId,
        mode: "member"
      })
    : null;
  if (parent?.kind === "refuse") {
    return data({ success: false, message: parent.message }, { status: 400 });
  }
  const consumed = await childrenConsumedInto(serviceRole, {
    companyId,
    parentTrackedEntityId,
    childIds: children.map((child) => child.trackedEntityId)
  });
  if (consumed.error) {
    logger.error("Could not read what the unit consumed", {
      companyId,
      parentTrackedEntityId,
      error: consumed.error
    });
    return data(
      { success: false, message: "Could not check these parts. Try again." },
      { status: 500 }
    );
  }
  if (!consumed.data) {
    return data(
      {
        success: false,
        message: "These parts were not consumed into this unit"
      },
      { status: 400 }
    );
  }

  const issued = await deps.post(
    "issue",
    { companyId, userId },
    {
      type: "unconsumeTrackedEntities",
      ...(validation.data.pairingId && {
        pairingId: validation.data.pairingId
      }),
      materialId,
      parentTrackedEntityId,
      children
    }
  );

  if (issued.error) {
    logger.error("Failed to issue material", { error: issued.error });
    return data(
      { success: false, message: issued.error.message },
      { status: 400 }
    );
  }

  return { success: true, message: "Material unconsumed successfully" };
}
