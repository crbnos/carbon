// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { projectElementValidator } from "~/modules/projects";
import { insertProjectElement } from "~/modules/projects/projects.server";
import { serviceNodeTypes } from "~/modules/service";
import {
  requireServiceWork,
  ServiceOrderError
} from "~/modules/service/service.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "service-work-new");

/**
 * Adds an element to a service order's or a service template's work: the
 * service twin of the project's `elements.new`, under the service permission.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const validation = await validator(projectElementValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);
  const { id: _id, ...element } = validation.data;
  if (!(serviceNodeTypes as readonly string[]).includes(element.type)) {
    return data(
      { error: { message: "Add a System, Task or Folder" } },
      { status: 400 }
    );
  }

  try {
    await requireServiceWork(client, {
      companyId,
      projectId,
      elementIds: element.parentId ? [element.parentId] : []
    });
    const created = await insertProjectElement(getDatabaseClient(), {
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
    if (!(err instanceof ServiceOrderError)) {
      logger.error("Failed to add a service element", {
        companyId,
        projectId,
        error: err
      });
    }
    return data(
      {
        error: {
          message:
            err instanceof Error ? err.message : "Failed to add the element"
        }
      },
      { status: 400 }
    );
  }
}
