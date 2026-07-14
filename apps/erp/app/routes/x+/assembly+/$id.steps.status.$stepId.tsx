import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyInstructionStepStatusValidator,
  updateAssemblyInstructionStepStatus
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { stepId } = params;
  if (!stepId) throw new Error("stepId is not found");

  const validation = await validator(
    assemblyInstructionStepStatusValidator
  ).validate(await request.formData());

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateAssemblyInstructionStepStatus(client, stepId, {
    status: validation.data.status,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update step status"))
    );
  }

  return { success: true };
}
