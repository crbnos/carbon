import { json } from "@remix-run/react";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { qualityDocumentStepValidator } from "~/modules/quality/quality.models";
import { upsertQualityDocumentStep } from "~/modules/quality/quality.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality",
  });

  const { id: qualityDocumentId } = params;
  if (!qualityDocumentId) throw new Error("id is not found");

  const validation = await validator(qualityDocumentStepValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json(
      { success: false },
      await flash(request, error(validation.error, "Failed to create step"))
    );
  }

  const { id, ...data } = validation.data;

  const create = await upsertQualityDocumentStep(client, {
    ...data,
    companyId,
    createdBy: userId,
  });
  if (create.error) {
    return json(
      {
        success: false,
      },
      await flash(
        request,
        error(create.error, "Failed to insert quality document step")
      )
    );
  }

  return json({ success: true });
}
