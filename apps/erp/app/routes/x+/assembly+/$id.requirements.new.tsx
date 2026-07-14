import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyStepRequirementValidator,
  upsertAssemblyInstructionStepRequirement
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { id: assemblyInstructionId } = params;
  if (!assemblyInstructionId) throw new Error("id is not found");

  const validation = await validator(assemblyStepRequirementValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(validation.error, "Failed to create requirement")
      )
    );
  }

  // Media uploads must live under this company's path for this instruction
  const { filePath } = validation.data;
  if (filePath) {
    const expectedPrefix = `${companyId}/assembly/${assemblyInstructionId}/`;
    if (!filePath.startsWith(expectedPrefix) || filePath.includes("..")) {
      return data(
        { success: false },
        await flash(request, error(null, "Invalid file path"))
      );
    }
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is never set on create
  const { id, ...rest } = validation.data;

  const create = await upsertAssemblyInstructionStepRequirement(client, {
    ...rest,
    companyId,
    createdBy: userId
  });
  if (create.error) {
    return data(
      { success: false },
      await flash(request, error(create.error, "Failed to insert requirement"))
    );
  }

  return { success: true, id: create.data?.id };
}
