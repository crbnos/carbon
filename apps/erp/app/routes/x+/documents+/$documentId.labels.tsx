import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  documentLabelsValidator,
  updateDocumentLabels
} from "~/modules/documents";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    view: "documents"
  });
  const validation = await validator(documentLabelsValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { documentId, labels } = validation.data;

  const updateLabels = await updateDocumentLabels({
    documentId,
    labels: labels ?? [],
    userId
  });

  if (updateLabels.error) {
    throw redirect(
      path.to.documents,
      await flash(
        request,
        error(updateLabels.error, "Failed to update document labels")
      )
    );
  }

  throw redirect(path.to.documents);
}
