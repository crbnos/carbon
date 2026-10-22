// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { assertIsPost, error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { projectChangeRequestStatusValidator } from "~/modules/projects/projects.models";
import { path } from "~/utils/path";

/**
 * Moves a change request through its lifecycle (`intent`: submit, approve,
 * reject, cancel, reopen); `updateProjectChangeRequestStatus` does the step.
 * Back to the change request with the result as the flash.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId, crId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!crId) throw new Error("Could not find crId");

  const back = path.to.projectChangeRequest(projectId, crId);
  const form = projectChangeRequestStatusValidator.safeParse(
    Object.fromEntries(await request.formData())
  );
  if (!form.success) {
    throw redirect(back, await flash(request, error(null, "Unknown action")));
  }

  const api = await carbon(request);
  const result = await api.projects.updateProjectChangeRequestStatus({
    ...form.data,
    projectId,
    changeRequestId: crId
  });
  return respond(request, result).redirect(back, {
    message: result.data?.message
  });
}
