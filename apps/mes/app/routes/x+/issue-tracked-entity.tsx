// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { erpPosting } from "~/services/erp";
import { issueTrackedEntityValidator } from "~/services/models";
import { abilityBlockRefusal } from "~/services/operations.service";
import { resolveTravelerMaterial } from "~/services/traveler.server";

const log = getLogger("mes");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const payload = await request.json();
  const validation = issueTrackedEntityValidator.safeParse(payload);

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const {
    jobOperationId,
    batchId,
    parentTrackedEntityId,
    jobOperationStepId,
    unitNumber,
    overrideExpired,
    overrideReason,
    travelerScan
  } = validation.data;
  let { materialId, itemId, children } = validation.data;

  if (
    travelerScan &&
    (!jobOperationId || !parentTrackedEntityId || children.length !== 1)
  ) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  if (batchId ? !itemId : !parentTrackedEntityId) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  if (!batchId && jobOperationId) {
    const refusal = await abilityBlockRefusal(await getCarbonServiceRole(), {
      operationId: jobOperationId,
      employeeId: userId,
      companyId
    });
    if (refusal) {
      return data({ success: false, message: refusal }, { status: 403 });
    }
  }

  // Traveler scan: the scanned unit decides the material and quantity, so a
  // wrong item, or one the unit already has, is refused before the posting.
  if (travelerScan && jobOperationId && parentTrackedEntityId) {
    const resolved = await resolveTravelerMaterial(
      await getCarbonServiceRole(),
      {
        companyId,
        jobOperationId,
        trackedEntityId: children[0].trackedEntityId,
        parentTrackedEntityId
      }
    );
    if ("refusal" in resolved) {
      return data(
        { success: false, message: resolved.refusal },
        { status: 400 }
      );
    }
    materialId = resolved.materialId;
    itemId = undefined;
    children = [{ ...children[0], quantity: resolved.quantity }];
  }

  // Batch mode: one pick for the whole operation batch. The posting splits the
  // picked lots pro-rata by each member's remaining requirement and records
  // per-member consumption, so costing and genealogy stay per job.
  const issued = await erpPosting(
    "issue",
    { companyId, userId },
    batchId
      ? {
          type: "trackedEntitiesToBatch",
          batchId,
          itemId: itemId!,
          children,
          overrideExpired,
          overrideReason
        }
      : {
          type: "trackedEntitiesToOperation",
          materialId,
          jobOperationId,
          itemId,
          parentTrackedEntityId: parentTrackedEntityId!,
          children,
          jobOperationStepId,
          unitNumber,
          overrideExpired,
          overrideReason,
          // The posting re-checks the requirement under a lock for a scan.
          travelerScan
        }
  );

  if (issued.error) {
    log.error("Failed to issue material", { error: issued.error });
    const message = issued.error.message || "Failed to issue material";
    return data({ success: false, message }, { status: 400 });
  }

  const splitEntities = issued.data?.splitEntities || [];
  const warning = issued.data?.warning as string | undefined;

  // No label print on issue: the split child is CONSUMED (it departed into the
  // job) and consumed portions get no label; the surviving lineside entity
  // keeps its existing label.

  return {
    success: true,
    message: "Material issued successfully",
    splitEntities,
    warning
  };
}
