import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyStepMaterialValidator,
  upsertAssemblyInstructionStepMaterial
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { materialId } = params;
  if (!materialId) throw new Error("materialId is not found");

  const validation = await validator(assemblyStepMaterialValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await upsertAssemblyInstructionStepMaterial(client, {
    ...validation.data,
    id: materialId,
    companyId,
    createdBy: userId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to update material"))
    );
  }

  return { success: true };
}
