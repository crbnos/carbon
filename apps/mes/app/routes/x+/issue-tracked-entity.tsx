// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { erpPosting } from "~/services/erp";
import { issueTrackedEntityValidator } from "~/services/models";
import { abilityBlockRefusal } from "~/services/operations.service";
import { resolveWorkUnit } from "~/services/work-unit.server";

const log = getLogger("mes");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await authorize(request, {});

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
    allowOverIssue
  } = validation.data;
  const { materialId, itemId, children } = validation.data;

  if (batchId ? !itemId : !parentTrackedEntityId || !jobOperationId) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  let parentId = parentTrackedEntityId;
  if (!batchId && jobOperationId) {
    const serviceRole = getCarbonServiceRole();
    const work = await resolveWorkUnit({
      client: serviceRole,
      companyId,
      operationId: jobOperationId,
      requestedUnitId: parentTrackedEntityId,
      mode: "require"
    });
    if (work.kind === "refuse") {
      return data(
        { success: false, message: work.message, pickUnit: work.pickUnit },
        { status: 409 }
      );
    }
    if (work.kind === "unit") parentId = work.unitId;

    const refusal = await abilityBlockRefusal(serviceRole, {
      operationId: jobOperationId,
      employeeId: userId,
      companyId
    });
    if (refusal) {
      return data({ success: false, message: refusal }, { status: 403 });
    }
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
          parentTrackedEntityId: parentId!,
          children,
          jobOperationStepId,
          unitNumber,
          overrideExpired,
          overrideReason,
          allowOverIssue
        }
  );

  if (issued.error) {
    log.error("Failed to issue material", { error: issued.error });
    const message = issued.error.message || "Failed to issue material";
    // The requirement is already filled: the dialog asks before issuing more.
    const overIssue = issued.error.body.overIssue === true;
    return data({ success: false, message, overIssue }, { status: 400 });
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
