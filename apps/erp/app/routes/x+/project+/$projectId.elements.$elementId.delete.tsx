// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  deleteElementInChangeRequest,
  readChangeRequestId,
  requireEditablePlanRoute
} from "~/modules/projects/projects.server";
import {
  deleteProjectElement,
  getProject
} from "~/modules/projects/projects.service";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-element-delete");

/**
 * Deletes an element and its descendants, then goes back to the element
 * list. A refusal (charges exist below it) stays on the page with its reason.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "projects"
  });

  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const project = await getProject(client, companyId, projectId);
  if (project.error || !project.data) {
    logger.error("Failed to load project", {
      companyId,
      projectId,
      error: project.error
    });
    return data(
      { success: false },
      await flash(request, error(project.error, "Failed to load the project"))
    );
  }
  if (project.data.status === "Closed") {
    return data(
      { success: false },
      await flash(request, error(null, "A Closed project cannot change"))
    );
  }

  // While a change request is open, the delete goes into it. The apply step
  // refuses it if the element or one below it has charges.
  const changeRequestId = readChangeRequestId(
    request,
    await request.formData()
  );
  // A locked plan takes plan-layer changes only through a change request.
  const locked = await requireEditablePlanRoute(request, {
    client,
    projectId,
    companyId,
    changeRequestId
  });
  if (locked) return locked;
  if (changeRequestId) {
    try {
      await deleteElementInChangeRequest(getDatabaseClient(), {
        companyId,
        userId,
        projectId,
        changeRequestId,
        elementId
      });
    } catch (err) {
      logger.error("Failed to delete an element in a change request", {
        companyId,
        projectId,
        changeRequestId,
        elementId,
        error: err
      });
      return data(
        { success: false },
        await flash(
          request,
          error(err, err instanceof Error ? err.message : "Failed to delete")
        )
      );
    }
    throw redirect(
      `${path.to.projectElements(projectId)}?cr=${changeRequestId}`,
      await flash(request, success("Element removed in the change request"))
    );
  }

  const result = await deleteProjectElement(client, elementId, companyId);
  if (result.error) {
    logger.error("Failed to delete element", {
      companyId,
      projectId,
      elementId,
      error: result.error
    });
    return data(
      { success: false },
      await flash(
        request,
        error(result.error, result.error.message ?? "Failed to delete")
      )
    );
  }

  throw redirect(
    path.to.projectElements(projectId),
    await flash(request, success("Element deleted"))
  );
}
