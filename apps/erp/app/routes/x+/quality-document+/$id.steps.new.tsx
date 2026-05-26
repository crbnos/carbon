import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { qualityDocumentStepValidator } from "~/modules/quality/quality.models";
import { upsertQualityDocumentStep } from "~/modules/quality/quality.service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });

  const { id: qualityDocumentId } = params;
  if (!qualityDocumentId) throw new Error("id is not found");

  const validation = await validator(qualityDocumentStepValidator).validate(
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

  const create = await upsertQualityDocumentStep({
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
        error(create.error, "Failed to insert quality document step")
      )
    );
  }

  return { success: true };
}
