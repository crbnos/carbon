// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { assertIsPost, error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { projectStatusValidator } from "~/modules/projects/projects.models";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

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

  const api = await carbon(request);
  const result = await api.projects.updateProjectStatus({ projectId, status });
  return respond(request, result).redirect(back, {
    message: `Project is ${status}`
  });
}
