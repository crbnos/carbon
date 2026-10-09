// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  clearSuspectLink,
  deleteProjectElementLink,
  getProject,
  projectElementLinkValidator,
  upsertProjectElementLink
} from "~/modules/projects";
import { saveParameterFormula } from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-element-links");

/**
 * Trace links of a project's elements. `intent` picks the change: `upsert`
 * adds a link, `delete` removes one, `clearSuspect` marks one reviewed and
 * `saveFormula` saves a Parameter's formula with its `feeds` links.
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
  const intent = formData.get("intent");
  const id = formData.get("id");

  switch (intent) {
    case "upsert": {
      const validation = await validator(projectElementLinkValidator).validate(
        formData
      );
      if (validation.error) {
        return { error: { message: "Choose an element and a link type" } };
      }
      const result = await upsertProjectElementLink(client, {
        ...validation.data,
        projectId,
        companyId,
        createdBy: userId
      });
      if (result.error) {
        logger.error("Failed to add a trace link", {
          companyId,
          projectId,
          error: result.error
        });
        return {
          error: { message: result.error.message ?? "Failed to add the link" }
        };
      }
      return { success: true };
    }
    case "delete":
    case "clearSuspect": {
      if (typeof id !== "string" || !id) {
        return { error: { message: "No link selected" } };
      }
      const result =
        intent === "delete"
          ? await deleteProjectElementLink(client, id, companyId)
          : await clearSuspectLink(client, { id, companyId, userId });
      if (result.error) {
        logger.error("Failed to change a trace link", {
          companyId,
          projectId,
          intent,
          error: result.error
        });
        return {
          error: {
            message: result.error.message ?? "Failed to change the link"
          }
        };
      }
      return { success: true };
    }
    case "saveFormula": {
      const elementId = formData.get("elementId");
      const formula = formData.get("formula");
      if (typeof elementId !== "string" || typeof formula !== "string") {
        return { error: { message: "Enter a formula" } };
      }
      try {
        const result = await saveParameterFormula(getDatabaseClient(), {
          companyId,
          userId,
          elementId,
          formula,
          projectId
        });
        if ("error" in result) return { error: { message: result.error } };
        return { success: true };
      } catch (err) {
        logger.error("Failed to save a formula", {
          companyId,
          projectId,
          elementId,
          error: err
        });
        return { error: { message: "Failed to save the formula" } };
      }
    }
    default:
      return { error: { message: "Unknown action" } };
  }
}
