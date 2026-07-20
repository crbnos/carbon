import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyStepRequirementValidator,
  upsertAssemblyInstructionStepRequirement
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { requirementId } = params;
  if (!requirementId) throw new Error("requirementId is not found");

  const validation = await validator(assemblyStepRequirementValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await upsertAssemblyInstructionStepRequirement(client, {
    ...validation.data,
    id: requirementId,
    companyId,
    createdBy: userId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update requirement"))
    );
  }

  return { success: true };
}
