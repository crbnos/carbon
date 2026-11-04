// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { type ActionFunctionArgs, data } from "react-router";
import { projectChangeRequestValidator } from "~/modules/projects/projects.models";
import { path } from "~/utils/path";

/**
 * Opens a Draft change request, then goes to the Elements page with it
 * active (`?cr=`), so the plan-layer edits go into it.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const validation = await validator(projectChangeRequestValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const api = await carbon(request);
  const created = await api.projects.createProjectChangeRequest({
    ...validation.data,
    projectId
  });
  if (created.error) {
    return data(
      { success: false },
      await flash(request, error(null, created.error.message))
    );
  }
  throw redirect(
    `${path.to.projectElements(projectId)}?cr=${created.data.id}`,
    await flash(request, success(`${created.data.readableId} opened`))
  );
}
