// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { erpPosting } from "~/services/erp";
import { scrapTrackedEntityValidator } from "~/services/models";
import {
  abilityBlockRefusal,
  getTrackedEntity
} from "~/services/operations.service";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { trackedEntityId, materialId } = params;
  if (!materialId) throw new Error("Could not find materialId");
  if (!trackedEntityId) throw new Error("Could not find trackedEntityId");

  // Get optional parentId from query params
  const url = new URL(request.url);
  const parentTrackedEntityId = url.searchParams.get("parentId") || undefined;

  const formData = await request.formData();
  const validation = await validator(scrapTrackedEntityValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();
  const material = await serviceRole
    .from("jobMaterial")
    .select("jobOperationId")
    .eq("id", materialId)
    .eq("companyId", companyId)
    .maybeSingle();
  const refusal = material.data?.jobOperationId
    ? await abilityBlockRefusal(serviceRole, {
        operationId: material.data.jobOperationId,
        employeeId: userId,
        companyId
      })
    : null;
  if (refusal) {
    return data({ success: false, message: refusal }, { status: 403 });
  }

  const trackedEntity = await getTrackedEntity(client, trackedEntityId);
  if (trackedEntity.error) {
    return data(
      { success: false, message: "Failed to get tracked entity" },
      { status: 400 }
    );
  }
  const issued = await erpPosting(
    "issue",
    { companyId, userId },
    {
      trackedEntityId,
      materialId,
      parentTrackedEntityId: parentTrackedEntityId!,
      type: "scrapTrackedEntity",
      scrapReasonId: validation.data.scrapReasonId,
      makeReplacement: validation.data.makeReplacement
    }
  );

  if (issued.error) {
    return data(
      { success: false, message: "Failed to scrap entity" },
      { status: 400 }
    );
  }

  return { success: true, message: "Entity scrapped successfully" };
}
