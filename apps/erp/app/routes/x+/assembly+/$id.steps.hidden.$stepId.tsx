import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyInstructionStepHiddenComponentsValidator,
  updateAssemblyStepHiddenComponents
} from "~/modules/production";

// Autosave target for the per-step hide controls; touches only the hidden list.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id, stepId } = params;
  if (!id) throw notFound("id is not found");
  if (!stepId) throw notFound("step id is not found");

  const validation = await validator(
    assemblyInstructionStepHiddenComponentsValidator
  ).validate(await request.formData());

  if (validation.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(validation.error, "Failed to update hidden components")
      )
    );
  }

  const update = await updateAssemblyStepHiddenComponents(client, {
    id: stepId,
    assemblyInstructionId: id,
    hiddenComponentNodeIds: validation.data.hiddenComponentNodeIds,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(update.error, "Failed to update hidden components")
      )
    );
  }

  return { success: true };
}
