import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assertMethodOperationIsDraft,
  upsertMethodOperationStepSlide
} from "~/modules/items";
import { operationStepSlideValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(operationStepSlideValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const step = await client
    .from("methodOperationStep")
    .select("operationId")
    .eq("id", validation.data.stepId)
    .single();

  if (step.error || !step.data) {
    throw new Error("Step not found");
  }

  await assertMethodOperationIsDraft(client, step.data.operationId);

  // Same route handles create (upload) and edit (caption/size/annotations): an `id` means
  // update the existing slide, otherwise insert a new one. Passing createdBy unconditionally
  // would force the insert branch and PK-conflict on every edit.
  //
  // On update we send ONLY the fields that were actually submitted: upsert runs sanitize(),
  // which turns any `undefined` into `null`, so including an omitted optional field (e.g. on
  // a caption-only save) would wipe size/annotations. stepId is always present; the slide's
  // content is imagePath (image slide) XOR modelUploadId (3D model slide).
  const {
    id,
    stepId,
    imagePath,
    modelUploadId,
    caption,
    sortOrder,
    size,
    annotations
  } = validation.data;
  const upsert = await upsertMethodOperationStepSlide(
    client,
    id
      ? {
          id,
          stepId,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
          ...(imagePath !== undefined ? { imagePath } : {}),
          ...(modelUploadId !== undefined ? { modelUploadId } : {}),
          ...(caption !== undefined ? { caption } : {}),
          ...(sortOrder !== undefined ? { sortOrder } : {}),
          ...(size !== undefined ? { size } : {}),
          ...(annotations !== undefined ? { annotations } : {})
        }
      : {
          stepId,
          imagePath,
          modelUploadId,
          caption,
          sortOrder,
          size,
          annotations,
          companyId,
          createdBy: userId
        }
  );
  if (upsert.error) {
    return data(
      { id: null },
      await flash(
        request,
        error(upsert.error, "Failed to save operation step slide")
      )
    );
  }

  return { id: upsert.data?.id ?? null };
}
