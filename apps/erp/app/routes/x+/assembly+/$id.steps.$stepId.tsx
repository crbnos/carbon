// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { assemblyInstructionStepValidator } from "~/modules/production/production.models";
import { upsertAssemblyInstructionStep } from "~/modules/production/production.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { stepId } = params;
  if (!stepId) throw notFound("step id is not found");

  const formData = await request.formData();
  const validation = await validator(assemblyInstructionStepValidator).validate(
    formData
  );

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to update step"))
    );
  }

  const update = await upsertAssemblyInstructionStep(client, {
    ...validation.data,
    id: stepId,
    companyId,
    createdBy: userId,
    updatedBy: userId
  });
  if (update.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(update.error, "Failed to update assembly instruction step")
      )
    );
  }

  return { success: true };
}
