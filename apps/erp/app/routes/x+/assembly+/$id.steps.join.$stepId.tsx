// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyInstructionStepJoinValidator,
  updateAssemblyStepJoin
} from "~/modules/production";

// Autosave target for a step's "Build off to the side" select; touches only
// the step's join link (parentStepId).
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id, stepId } = params;
  if (!id) throw notFound("id is not found");
  if (!stepId) throw notFound("step id is not found");

  const validation = await validator(
    assemblyInstructionStepJoinValidator
  ).validate(await request.formData());

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to update step"))
    );
  }

  const update = await updateAssemblyStepJoin(client, {
    assemblyInstructionId: id,
    stepId,
    joinStepId: validation.data.joinStepId || null,
    companyId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, update.error.message))
    );
  }

  return { success: true };
}
