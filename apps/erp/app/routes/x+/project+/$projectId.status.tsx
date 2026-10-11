// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  canChangeProjectStatus,
  getProject,
  projectStatusValidator,
  stopWorkStatusRefusal,
  updateProjectStatus
} from "~/modules/projects";
import { ensureCapitalAssets } from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "project-status");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const back = requestReferrer(request) ?? path.to.project(projectId);

  const validation = await validator(projectStatusValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    throw redirect(back, await flash(request, error(null, "Invalid status")));
  }
  const { status } = validation.data;

  const project = await getProject(client, companyId, projectId);
  if (project.error || !project.data) {
    logger.error("Failed to load project", {
      companyId,
      projectId,
      error: project.error
    });
    throw redirect(
      back,
      await flash(request, error(project.error, "Failed to load project"))
    );
  }

  // C16: updateProjectStatus refuses this too (the MCP tool calls it). The
  // route asks first, so a stopped project creates no capital assets below.
  const stopped = stopWorkStatusRefusal(project.data.stopWorkDate, status);
  if (stopped) {
    throw redirect(back, await flash(request, error(null, stopped)));
  }

  if (!canChangeProjectStatus(project.data.status, status)) {
    throw redirect(
      back,
      await flash(
        request,
        error(
          null,
          `A ${project.data.status} project cannot change to ${status}`
        )
      )
    );
  }

  // A capital project needs its assets under construction before it takes
  // charges. Create them before the status changes: the call is safe to
  // repeat, so a failed status change leaves nothing wrong behind.
  if (status === "Released") {
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
      throw redirect(
        back,
        await flash(
          request,
          error(err, "Failed to create the assets under construction")
        )
      );
    }
  }

  const update = await updateProjectStatus(client, {
    id: projectId,
    companyId,
    status,
    updatedBy: userId
  });

  if (update.error) {
    throw redirect(
      back,
      await flash(
        request,
        error(
          update.error,
          update.error.message ?? "Failed to update the project status"
        )
      )
    );
  }

  throw redirect(back, await flash(request, success(`Project is ${status}`)));
}
