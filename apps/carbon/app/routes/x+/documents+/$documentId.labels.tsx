import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  documentLabelsValidator,
  updateDocumentLabels,
} from "~/modules/documents";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    view: "documents",
  });
  const validation = await validator(documentLabelsValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { documentId, labels } = validation.data;

  const updateLabels = await updateDocumentLabels(client, {
    documentId,
    labels: labels ?? [],
    userId,
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
