// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { evaluateLinesForSurface, isBlocked } from "@carbon/ee/rules.server";
import { getLogger } from "@carbon/logger";
import { EPSILON } from "@carbon/utils";
import { planItemScanIssue } from "~/utils/itemScan";
import { erpPosting } from "./erp";
import {
  getJobOperationIssueScope,
  getSuggestedAllocationForMaterial
} from "./inventory.service";
import { abilityBlockRefusal } from "./operations.service";

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
      adjustmentType
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
 * A scanned item sticker on an operation screen: issues everything the job
 * still needs of that item. A batch part takes the lots the picking order
 * suggests at the job's location. Safe to repeat: the untracked issue sets
 * the issued quantity to what is required, and the posting refuses a batch
 * issue above the requirement, so a second scan issues nothing.
 *
 * A refusal with `materialId` is one the Issue dialog can settle (the
 * operator chooses the unit, the lot, or acknowledges a rule).
 */
export async function issueScannedItem(
  caller: Caller,
  input: {
    jobOperationId: string;
    itemId: string;
    parentTrackedEntityId?: string;
  }
): Promise<
  { success: true; message: string } | (Refusal & { materialId?: string })
> {
  const { companyId } = caller;
  const { jobOperationId, itemId } = input;
  const serviceRole = await getCarbonServiceRole();

  const operation = await serviceRole
    .from("jobOperation")
    .select("jobMakeMethodId, workCenterId")
    .eq("id", jobOperationId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!operation.data?.jobMakeMethodId)
    return refuse("Job operation not found");

  const materials = await serviceRole
    .from("jobMaterial")
    .select(
      "id, jobOperationId, quantity, estimatedQuantity, quantityIssued, methodType, requiresBatchTracking, requiresSerialTracking, item(readableIdWithRevision)"
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

  const plan = planItemScanIssue(materials.data, jobOperationId);
  if (plan.kind === "notUsed") return refuse("This job does not use that part");

  const name =
    materials.data[0]?.item?.readableIdWithRevision ?? "the scanned part";
  if (plan.kind === "full")
    return refuse(`This job already has all its ${name}`);

  const materialId = plan.material.id;
  if (plan.kind === "dialog") {
    return { ...refuse(`Choose the ${name} to issue`), materialId };
  }

  if (plan.kind === "untracked") {
    const issued = await issueMaterialToOperation(caller, {
      jobOperationId,
      itemId,
      materialId,
      quantity: plan.required,
      adjustmentType: "Set Quantity"
    });
    if ("violations" in issued) {
      return {
        ...refuse(`A rule applies to ${name}. Review it to issue.`),
        materialId
      };
    }
    return issued.success
      ? { success: true, message: `Issued ${name}` }
      : issued;
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
  if (!input.parentTrackedEntityId || covered < plan.quantity - EPSILON) {
    return {
      ...refuse(
        `Not enough ${name} in stock at this location. Choose the batch to issue.`
      ),
      materialId
    };
  }

  const issued = await erpPosting("issue", caller, {
    type: "trackedEntitiesToOperation",
    materialId,
    parentTrackedEntityId: input.parentTrackedEntityId,
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

  const batches = lots
    .map((lot) => lot.readableId)
    .filter(Boolean)
    .join(", ");
  return {
    success: true,
    message: batches ? `Issued ${name} from ${batches}` : `Issued ${name}`
  };
}
