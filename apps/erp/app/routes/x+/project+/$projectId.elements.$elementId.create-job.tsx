// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  createJobFromMaterialValidator,
  newProjectJobValidator
} from "~/modules/projects/projects.models";
import { path } from "~/utils/path";

export type CreateJobFromMaterialResult = { error: { message: string } };

/**
 * Create Job, charged to the element, in two forms:
 * - a plan line's Create Job (`materialId` set,
 *   `projects.createJobFromMaterial`): a job for that Make to Order material,
 *   which then remembers the job;
 * - the task's New Job (`itemId` set, no plan line,
 *   `projects.createProjectElementJob`): a job for a Make part, with a plan
 *   line added for it, so the job's card shows on the task.
 * When one part CLIN of a project contract has the same item and bills this
 * element, the job builds that CLIN's part. The action redirects to the job.
 */
export async function action({
  request,
  params
}: ActionFunctionArgs): Promise<CreateJobFromMaterialResult> {
  assertIsPost(request);
  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const formData = await request.formData();
  const api = await carbon(request);

  if (formData.get("materialId")) {
    const validation = await validator(createJobFromMaterialValidator).validate(
      formData
    );
    if (validation.error) {
      return { error: { message: "Enter a quantity and a location" } };
    }
    const result = await api.projects.createJobFromMaterial({
      ...validation.data,
      projectId,
      projectElementId: elementId
    });
    if (result.error) return { error: { message: result.error.message } };
    throw redirect(path.to.job(result.data.jobId));
  }

  const validation = await validator(newProjectJobValidator).validate(formData);
  if (validation.error) {
    return { error: { message: "Enter a part, a quantity and a location" } };
  }
  const result = await api.projects.createProjectElementJob({
    ...validation.data,
    projectId,
    projectElementId: elementId
  });
  if (result.error) return { error: { message: result.error.message } };
  throw redirect(path.to.job(result.data.jobId));
}
