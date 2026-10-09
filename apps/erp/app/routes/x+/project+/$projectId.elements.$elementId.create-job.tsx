// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { datetime, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getUnreleasedChangeOrderIssue } from "~/modules/items/items.server";
import { insertJob, makeToAssetItemError } from "~/modules/production";
import { createJobFromMaterialValidator } from "~/modules/projects";
import {
  chargeNumberError,
  getJobChargeTarget
} from "~/modules/projects/projects.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-create-job");

export type CreateJobFromMaterialResult = { error: { message: string } };

/**
 * Create Job: a job for a Make to Order plan-line material, charged to its
 * element. An Expense or Contract project consumes the job; a Capitalize
 * project builds the element's asset under construction. The material
 * remembers the job, and the action redirects to it.
 */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<CreateJobFromMaterialResult> {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
    view: "projects",
    role: "employee"
  });

  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const validation = await validator(createJobFromMaterialValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return { error: { message: "Enter a quantity and a location" } };
  }
  const { materialId, quantity, dueDate, locationId } = validation.data;

  const material = await client
    .from("projectElementMaterial")
    .select(
      "id, itemId, methodType, unitOfMeasureCode, jobId, item:item!projectElementMaterial_itemId_fkey(unitOfMeasureCode, itemTrackingType)"
    )
    .eq("id", materialId)
    .eq("projectId", projectId)
    .eq("projectElementId", elementId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (material.error || !material.data) {
    logger.error("Failed to load the plan-line material", {
      companyId,
      projectId,
      materialId,
      error: material.error
    });
    return { error: { message: "The material is not on this element" } };
  }
  if (material.data.methodType !== "Make to Order") {
    return { error: { message: "Only a Make to Order material makes a job" } };
  }
  if (material.data.jobId) {
    return { error: { message: "This material already has a job" } };
  }

  // insertJob runs with the service role, so the location is proven to
  // belong to this company first. The item came from this company's row.
  const serviceRole = getCarbonServiceRole();
  const db = getDatabaseClient();
  await requireCompanyRecord(serviceRole, "location", companyId, {
    id: locationId
  });

  const unreleasedIssue = await getUnreleasedChangeOrderIssue(serviceRole, {
    itemId: material.data.itemId,
    companyId
  });
  if (unreleasedIssue) {
    return {
      error: { message: `${unreleasedIssue} A job cannot be made for it.` }
    };
  }

  const target = await getJobChargeTarget(db, {
    companyId,
    projectId,
    projectElementId: elementId
  });
  if (!target) {
    return { error: { message: "The project does not exist" } };
  }
  const isCapital = target.costTreatment === "Capitalize";
  if (isCapital && !target.fixedAssetId) {
    return {
      error: {
        message:
          "Release the project first: its assets under construction are created on release"
      }
    };
  }
  const consumeToProject =
    target.costTreatment === "Expense" || target.costTreatment === "Contract";
  const fixedAssetId = isCapital ? target.fixedAssetId : null;

  const chargeError = await chargeNumberError(serviceRole, companyId, {
    projectId,
    projectElementId: elementId,
    consumeToProject
  });
  if (chargeError) return { error: { message: chargeError.message } };

  const itemError = makeToAssetItemError({
    fixedAssetId,
    itemTrackingType: material.data.item?.itemTrackingType,
    quantity
  });
  if (itemError) return { error: { message: itemError } };

  const job = await insertJob(
    serviceRole,
    db,
    {
      itemId: material.data.itemId,
      quantity,
      dueDate: dueDate || undefined,
      deadlineType: dueDate ? "Soft Deadline" : "No Deadline",
      locationId,
      unitOfMeasureCode:
        material.data.unitOfMeasureCode ??
        material.data.item?.unitOfMeasureCode ??
        undefined,
      projectId,
      projectElementId: elementId,
      consumeToProject,
      fixedAssetId,
      companyId,
      createdBy: userId
    },
    { source: "erp" }
  );
  if (job.error || !job.data) {
    logger.error("Failed to create a job from a plan-line material", {
      companyId,
      projectId,
      materialId,
      error: job.error
    });
    return { error: { message: "Failed to create the job" } };
  }

  // The service role: creating a job needs no right to edit the plan.
  const stamp = await serviceRole
    .from("projectElementMaterial")
    .update({
      jobId: job.data.id,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", materialId)
    .eq("companyId", companyId);
  if (stamp.error) {
    // The job exists; only the plan line's pointer to it failed.
    logger.error("Failed to link the job to its plan-line material", {
      companyId,
      projectId,
      materialId,
      jobId: job.data.id,
      error: stamp.error
    });
  }

  throw redirect(path.to.job(job.data.id));
}
