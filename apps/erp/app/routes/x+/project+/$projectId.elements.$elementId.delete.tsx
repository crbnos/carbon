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
import { deleteProjectElement, getProject } from "~/modules/projects";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-element-delete");

/**
 * Deletes an element and its descendants, then goes back to the element
 * list. A refusal (charges exist below it) stays on the page with its reason.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
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
