// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import type { ActionFunctionArgs } from "react-router";

/** Turns a project's Template flag on or off. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const api = await carbon(request);
  const result = await api.projects.updateProjectTemplate({
    projectId,
    isTemplate: formData.get("isTemplate") === "true"
  });
  if (result.error) {
    return { success: false, message: result.error.message };
  }
  return { success: true };
}
