import { assertIsPost, error } from "@carbon/auth";
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
    create: "production"
  });

  const { id: assemblyInstructionId } = params;
  if (!assemblyInstructionId) throw new Error("id is not found");

  const formData = await readAndLogFormData(request, "new.action");
  const validation = await validator(assemblyInstructionStepValidator).validate(
    formData
  );

  if (validation.error) {
    logAssemblyStep("new.validationError", { error: validation.error });
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to create step"))
    );
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is never set on create
  const { id, ...rest } = validation.data;

  const create = await upsertAssemblyInstructionStep(client, {
    ...rest,
    companyId,
    createdBy: userId
  });
  logAssemblyStep("new.result", {
    createdId: create.data?.id ?? null,
    componentNodeIds: rest.componentNodeIds,
    error: create.error?.message ?? null
  });
  if (create.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(create.error, "Failed to insert assembly instruction step")
      )
    );
  }

  return { success: true, id: create.data?.id };
}
