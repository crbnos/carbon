// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import { type ActionFunctionArgs, data } from "react-router";
import { readChangeRequestId } from "~/modules/projects/projects.service";
import { path } from "~/utils/path";

/**
 * Deletes an element and its descendants, then goes back to the element
 * list. A refusal (charges exist below it) stays on the page with its reason.
 * While a change request is open, the delete goes into it.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const changeRequestId = readChangeRequestId(
    request,
    await request.formData()
  );
  const api = await carbon(request);
  const result = await api.projects.deleteProjectElement({
    projectId,
    elementId,
    changeRequestId
  });
  if (result.error) {
    return data(
      { success: false, error: { message: result.error.message } },
      await flash(request, error(null, result.error.message))
    );
  }

  if (result.data.changeRequestId) {
    throw redirect(
      `${path.to.projectElements(projectId)}?cr=${result.data.changeRequestId}`,
      await flash(request, success("Element removed in the change request"))
    );
  }
  throw redirect(
    path.to.projectElements(projectId),
    await flash(request, success("Element deleted"))
  );
}
