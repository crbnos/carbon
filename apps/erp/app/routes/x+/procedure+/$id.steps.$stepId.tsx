import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { procedureStepValidator } from "~/modules/production/production.models";
import { upsertProcedureStep } from "~/modules/production/production.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "production"
  });

  const { stepId } = params;
  if (!stepId) throw notFound("step id is not found");

  const validation = await validator(procedureStepValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to update step"))
    );
  }

  const update = await upsertProcedureStep({
    id: stepId,
    ...validation.data,
    updatedBy: userId
  });
  if (update.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(update.error, "Failed to update procedure step")
      )
    );
  }

  return { success: true };
}
