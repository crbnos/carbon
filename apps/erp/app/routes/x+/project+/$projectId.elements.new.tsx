// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getProject, projectElementValidator } from "~/modules/projects";
import {
  addElementToChangeRequest,
  insertProjectElement,
  readChangeRequestId,
  requireEditablePlanRoute
} from "~/modules/projects/projects.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-element-new");

/** Creates an element. The quick-add rows of every layout post here. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const changeRequestId = readChangeRequestId(request, formData);
  // A locked plan takes plan-layer changes only through a change request.
  const locked = await requireEditablePlanRoute(request, {
    client,
    projectId,
    companyId,
    changeRequestId,
    withFlash: false
  });
  if (locked) return locked;
  const validation = await validator(projectElementValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const project = await getProject(client, companyId, projectId);
  if (project.error || !project.data) {
    logger.error("Failed to load project", {
      companyId,
      projectId,
      error: project.error
    });
    return data(
      { error: { message: "Failed to load the project" } },
      { status: 400 }
    );
  }
  if (project.data.status === "Closed") {
    return data(
      { error: { message: "A Closed project cannot take new elements" } },
      { status: 400 }
    );
  }

  const { id: _id, ...element } = validation.data;
  try {
    // While a change request is open, the element goes into it instead.
    const created = changeRequestId
      ? await addElementToChangeRequest(getDatabaseClient(), {
          companyId,
          userId,
          projectId,
          changeRequestId,
          element
        })
      : await insertProjectElement(getDatabaseClient(), {
          ...element,
          projectId,
          companyId,
          userId
        });
    return data(
      { id: created.id, readableId: created.readableId },
      { status: 201 }
    );
  } catch (err) {
    logger.error("Failed to create element", {
      companyId,
      projectId,
      error: err
    });
    return data(
      {
        error: {
          message:
            err instanceof Error ? err.message : "Failed to create the element"
        }
      },
      { status: 400 }
    );
  }
}
