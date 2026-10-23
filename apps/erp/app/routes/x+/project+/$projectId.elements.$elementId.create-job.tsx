// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { createJobFromMaterialValidator } from "~/modules/projects/projects.models";
import { path } from "~/utils/path";

export type CreateJobFromMaterialResult = { error: { message: string } };

/**
 * Create Job: a job for a Make to Order plan-line material, charged to its
 * element (`projects.createJobFromMaterial`). The action redirects to the job.
 */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<CreateJobFromMaterialResult> {
  assertIsPost(request);
  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const validation = await validator(createJobFromMaterialValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return { error: { message: "Enter a quantity and a location" } };
  }

  const api = await carbon(request);
  const result = await api.projects.createJobFromMaterial({
    ...validation.data,
    projectId,
    projectElementId: elementId
  });
  if (result.error) return { error: { message: result.error.message } };

  throw redirect(path.to.job(result.data.jobId));
}
