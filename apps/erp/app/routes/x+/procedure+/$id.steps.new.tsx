import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { procedureStepValidator } from "~/modules/production/production.models";
import { upsertProcedureStep } from "~/modules/production/production.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { id: procedureId } = params;
  if (!procedureId) throw new Error("id is not found");

  const validation = await validator(procedureStepValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to create step"))
    );
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const create = await upsertProcedureStep({
    ...rest,
    companyId,
    createdBy: userId
  });
  if (create.error) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(create.error, "Failed to insert procedure step")
      )
    );
  }

  return { success: true };
}
