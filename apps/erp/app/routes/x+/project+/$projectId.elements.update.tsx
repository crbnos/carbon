// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  isPlanLayerField,
  projectElementFieldUpdateValidator
} from "~/modules/projects/projects.models";
import {
  ensureCapitalAssets,
  readChangeRequestId,
  requireEditablePlanRoute,
  updateElementFieldInChangeRequest
} from "~/modules/projects/projects.server";
import {
  getProject,
  setProjectElementLabels,
  updateProjectElementBilling,
  updateProjectElementField
} from "~/modules/projects/projects.service";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-element-update");

/**
 * Saves one field on one or more elements: the pills of the List and Board
 * layouts, the cells of the Table layout and the element sidebar post here.
 * `labelIds` replaces the labels of one element (a comma-separated list).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const project = await getProject(client, companyId, projectId);
  if (project.error || !project.data) {
    logger.error("Failed to load project", {
      companyId,
      projectId,
      error: project.error
    });
    return { error: { message: "Failed to load the project" } };
  }
  if (project.data.status === "Closed") {
    return { error: { message: "A Closed project cannot change" } };
  }

  const formData = await request.formData();

  if (formData.get("field") === "labelIds") {
    const ids = formData.getAll("ids").filter((id) => typeof id === "string");
    if (ids.length !== 1) {
      return {
        error: { message: "Change the labels of one element at a time" }
      };
    }
    const value = formData.get("value");
    const labelIds =
      typeof value === "string" && value.length > 0 ? value.split(",") : [];
    const result = await setProjectElementLabels(client, {
      projectElementId: ids[0] as string,
      labelIds,
      companyId,
      createdBy: userId
    });
    if (result.error) {
      logger.error("Failed to set element labels", {
        companyId,
        projectId,
        error: result.error
      });
      return { error: { message: "Failed to save the labels" } };
    }
    return { success: true };
  }

  // The billing flag is not a plan-layer field and has its own rules (one
  // billing element per branch), so it writes live through its own update.
  if (formData.get("field") === "isBilling") {
    const ids = formData.getAll("ids").filter((id) => typeof id === "string");
    if (ids.length === 0) {
      return { error: { message: "Choose an element" } };
    }
    const value = formData.get("value");
    const isBilling = value === "true" || value === "on";
    if (isBilling && project.data.costTreatment !== "Contract") {
      return {
        error: {
          message: "Only a Contract project has billing elements"
        }
      };
    }
    const result = await updateProjectElementBilling(client, {
      ids: ids as string[],
      isBilling,
      companyId,
      updatedBy: userId
    });
    if (result.error) {
      logger.error("Failed to update the billing element", {
        companyId,
        projectId,
        error: result.error
      });
      return {
        error: {
          message: result.error.message ?? "Failed to save the change"
        }
      };
    }
    return { success: true };
  }

  const validation = await validator(
    projectElementFieldUpdateValidator
  ).validate(formData);
  if (validation.error) {
    return { error: { message: "Invalid form data" } };
  }

  const { ids, field, value } = validation.data;

  // A plan-layer field goes into the open change request; a progress field
  // always writes live.
  const changeRequestId = readChangeRequestId(request, formData);
  if (isPlanLayerField("projectElement", field)) {
    // A locked plan takes plan-layer changes only through a change request.
    const locked = await requireEditablePlanRoute(request, {
      client,
      projectId,
      companyId,
      changeRequestId,
      withFlash: false
    });
    if (locked) return locked;
  }
  if (changeRequestId && isPlanLayerField("projectElement", field)) {
    try {
      await updateElementFieldInChangeRequest(getDatabaseClient(), {
        companyId,
        userId,
        projectId,
        changeRequestId,
        ids,
        field,
        value
      });
      return { success: true };
    } catch (err) {
      logger.error("Failed to change an element in a change request", {
        companyId,
        projectId,
        changeRequestId,
        field,
        error: err
      });
      return {
        error: {
          message:
            err instanceof Error ? err.message : "Failed to save the change"
        }
      };
    }
  }

  const result = await updateProjectElementField(client, {
    ids,
    field,
    value,
    companyId,
    updatedBy: userId
  });
  if (result.error) {
    logger.error("Failed to update element field", {
      companyId,
      projectId,
      field,
      error: result.error
    });
    return {
      error: { message: result.error.message ?? "Failed to save the change" }
    };
  }

  // A new final asset on a released project gets its asset under
  // construction now, so its costs can post.
  if (
    field === "isFinalAsset" &&
    (value === "true" || value === "on") &&
    project.data.status !== "Draft"
  ) {
    try {
      await ensureCapitalAssets(getDatabaseClient(), {
        companyId,
        userId,
        projectId
      });
    } catch (err) {
      logger.error("Failed to create the capital assets", {
        companyId,
        projectId,
        error: err
      });
      return {
        error: {
          message:
            err instanceof Error
              ? err.message
              : "Failed to create the asset under construction"
        }
      };
    }
  }

  return { success: true };
}
