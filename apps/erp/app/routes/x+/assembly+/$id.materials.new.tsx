import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyStepMaterialValidator,
  upsertAssemblyInstructionStepMaterial
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { id: assemblyInstructionId } = params;
  if (!assemblyInstructionId) throw new Error("id is not found");

  const validation = await validator(assemblyStepMaterialValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to add material"))
    );
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is never set on create
  const { id, ...rest } = validation.data;

  const create = await upsertAssemblyInstructionStepMaterial(client, {
    ...rest,
    companyId,
    createdBy: userId
  });
  if (create.error) {
    return data(
      { success: false },
      await flash(request, error(create.error, "Failed to insert material"))
    );
  }

  return { success: true, id: create.data?.id };
}
