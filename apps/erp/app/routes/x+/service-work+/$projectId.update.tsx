// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import type { ProjectElementEditableField } from "~/modules/projects";
import {
  projectElementFieldUpdateValidator,
  setProjectElementLabels,
  updateProjectElementField
} from "~/modules/projects";
import {
  requireServiceWork,
  ServiceOrderError
} from "~/modules/service/service.server";

const logger = getLogger("erp", "service-work-update");

/** The fields a service element shows: no milestone, WBS, budget or flags. */
const SERVICE_FIELDS = new Set<ProjectElementEditableField>([
  "name",
  "description",
  "stateId",
  "ownerId",
  "priority",
  "startDate",
  "targetDate",
  "estimatedHours",
  "isChargeable",
  "itemId",
  "trackedEntityId"
]);

/**
 * Saves one field on one or more elements of a service order's or a service
 * template's work: the service twin of the project's `elements.update`. The
 * list's pills and the element page post here. `labelIds` replaces the labels
 * of one element.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const ids = formData
    .getAll("ids")
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  try {
    await requireServiceWork(client, { companyId, projectId, elementIds: ids });
  } catch (err) {
    if (err instanceof ServiceOrderError) {
      return { error: { message: err.message } };
    }
    logger.error("Failed to load the service work", {
      companyId,
      projectId,
      error: err
    });
    return { error: { message: "Failed to save the change" } };
  }

  if (formData.get("field") === "labelIds") {
    if (ids.length !== 1) {
      return {
        error: { message: "Change the labels of one element at a time" }
      };
    }
    const value = formData.get("value");
    const result = await setProjectElementLabels(client, {
      projectElementId: ids[0]!,
      labelIds:
        typeof value === "string" && value.length > 0 ? value.split(",") : [],
      companyId,
      createdBy: userId
    });
    if (result.error) {
      logger.error("Failed to set service element labels", {
        companyId,
        projectId,
        error: result.error
      });
      return { error: { message: "Failed to save the labels" } };
    }
    return { success: true };
  }

  const validation = await validator(
    projectElementFieldUpdateValidator
  ).validate(formData);
  if (validation.error || !SERVICE_FIELDS.has(validation.data.field)) {
    return { error: { message: "Invalid form data" } };
  }

  const { field, value } = validation.data;
  const result = await updateProjectElementField(client, {
    ids: validation.data.ids,
    field,
    value,
    companyId,
    updatedBy: userId
  });
  if (result.error) {
    logger.error("Failed to update a service element field", {
      companyId,
      projectId,
      field,
      error: result.error
    });
    return {
      error: { message: result.error.message ?? "Failed to save the change" }
    };
  }
  return { success: true };
}
