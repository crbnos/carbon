// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getProject, projectChangeRequestValidator } from "~/modules/projects";
import { createChangeRequest } from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-change-request-new");

/**
 * Opens a Draft change request, then goes to the Elements page with it
 * active (`?cr=`), so the plan-layer edits go into it.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const validation = await validator(projectChangeRequestValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const project = await getProject(client, companyId, projectId);
  if (project.error || !project.data) {
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

  try {
    const created = await createChangeRequest(getDatabaseClient(), {
      companyId,
      userId,
      projectId,
      title: validation.data.title,
      reason: validation.data.reason
    });
    throw redirect(
      `${path.to.projectElements(projectId)}?cr=${created.id}`,
      await flash(request, success(`${created.readableId} opened`))
    );
  } catch (err) {
    if (err instanceof Response) throw err;
    logger.error("Failed to open a change request", {
      companyId,
      projectId,
      error: err
    });
    return data(
      { success: false },
      await flash(request, error(err, "Failed to open the change request"))
    );
  }
}
