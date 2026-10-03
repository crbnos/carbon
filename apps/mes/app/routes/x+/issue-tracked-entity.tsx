// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { issueTrackedEntityValidator } from "~/services/models";

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
  } = validation.data;

  if (batchId ? !itemId : !parentTrackedEntityId) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  // Batch mode: one pick for the whole operation batch. The server fn splits the
  // picked lots pro-rata by each member's remaining requirement and records
  // per-member consumption, so costing and genealogy stay per job.
  const issued = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke(
      "issue",
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
            overrideReason
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
