import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyInstructionStepValidator,
  upsertAssemblyInstructionStep
} from "~/modules/production";
import {
  logAssemblyStep,
  readAndLogFormData
} from "~/modules/production/assembly-debug.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { stepId } = params;
  if (!stepId) throw notFound("step id is not found");

  const formData = await readAndLogFormData(request, "update.action");
  const validation = await validator(assemblyInstructionStepValidator).validate(
    formData
  );

  if (validation.error) {
    logAssemblyStep("update.validationError", {
      stepId,
      error: validation.error
    });
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
  logAssemblyStep("update.result", {
    stepId,
    hasMotion: validation.data.motion !== undefined,
    componentNodeIds: validation.data.componentNodeIds,
    title: validation.data.title ?? null,
    error: update.error?.message ?? null,
    updatedId: update.data?.id ?? null
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
