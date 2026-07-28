import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertJobOperationStepSlide } from "~/modules/production";
import { operationStepSlideValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  // Same route handles create (no `id`) and update (`id` present). Gate each branch on the
  // matching permission so a create-only user can't edit an existing slide by passing an `id`.
  const formData = await request.formData();
  const isUpdate = Boolean(formData.get("id"));
  const { client, companyId, userId } = await requirePermissions(
    request,
    isUpdate ? { update: "production" } : { create: "production" }
  );

  const validation = await validator(operationStepSlideValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // Same route handles create (upload) and edit (caption/size/annotations): an `id` means
  // update the existing slide, otherwise insert. On update we send ONLY the fields actually
  // submitted — upsert runs sanitize() (undefined → null), so a caption-only save never
  // wipes size/annotations. stepId (a jobOperationStep id) is always present; the slide's
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
  const upsert = await upsertJobOperationStepSlide(
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
        error(upsert.error, "Failed to save job operation step slide")
      )
    );
  }

  return { id: upsert.data?.id ?? null };
}
