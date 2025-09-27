import { json } from "@remix-run/react";

import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { qualityDocumentStepValidator } from "~/modules/quality/quality.models";
import { upsertQualityDocumentStep } from "~/modules/quality/quality.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const { stepId } = params;
  if (!stepId) throw notFound("step id is not found");

  const validation = await validator(qualityDocumentStepValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json(
      { success: false },
      await flash(request, error(validation.error, "Failed to update step"))
    );
  }

  const update = await upsertQualityDocumentStep(client, {
    id: stepId,
    ...validation.data,
    updatedBy: userId,
  });
  if (update.error) {
    return json(
      { success: false },
      await flash(
        request,
        error(update.error, "Failed to update procedure step")
      )
    );
  }

  return json({ success: true });
}
