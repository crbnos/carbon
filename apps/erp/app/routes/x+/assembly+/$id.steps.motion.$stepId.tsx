// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { assemblyInstructionStepMotionValidator } from "~/modules/production/production.models";
import { updateAssemblyStepMotion } from "~/modules/production/production.service";
import { getDatabaseClient } from "~/services/database.server";

// Autosave target for the 3D editor: patches only a step's motion, camera and
// orientation, leaving the rest untouched.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { stepId } = params;
  if (!stepId) throw notFound("step id is not found");

  const formData = await request.formData();
  const validation = await validator(
    assemblyInstructionStepMotionValidator
  ).validate(formData);

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to update motion"))
    );
  }

  const update = await updateAssemblyStepMotion(getDatabaseClient(), {
    id: stepId,
    motion: validation.data.motion,
    camera: validation.data.camera,
    orientation: validation.data.orientation,
    reset: validation.data.reset,
    companyId,
    updatedBy: userId
  });
  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update motion"))
    );
  }

  return { success: true };
}
