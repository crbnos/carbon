// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validationError, validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import { projectElementValidator } from "~/modules/projects/projects.models";
import { readChangeRequestId } from "~/modules/projects/projects.service";

/**
 * Creates an element. The quick-add rows of every layout post here. While a
 * change request is open, the element goes into it instead.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");

  const formData = await request.formData();
  const changeRequestId = readChangeRequestId(request, formData);
  const validation = await validator(projectElementValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const api = await carbon(request);
  const result = await api.projects.createProjectElement({
    ...validation.data,
    projectId,
    changeRequestId
  });
  if (result.error) {
    return data({ error: { message: result.error.message } }, { status: 400 });
  }
  return data(
    { id: result.data.id, readableId: result.data.readableId },
    { status: 201 }
  );
}
