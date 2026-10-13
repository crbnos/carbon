// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { updateProjectTemplate } from "~/modules/projects";

const logger = getLogger("erp", "project-template");

/** Turns a project's Template flag on or off. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const result = await updateProjectTemplate(client, {
    id: projectId,
    companyId,
    isTemplate: formData.get("isTemplate") === "true",
    updatedBy: userId
  });
  if (result.error) {
    logger.error("Failed to change the project's template flag", {
      companyId,
      projectId,
      error: result.error
    });
    return { success: false, message: "Failed to change the template flag" };
  }
  return { success: true };
}
