import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteDocument } from "~/modules/documents/documents.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "documents"
  });

  const { documentId } = params;
  if (!documentId) throw notFound("documentId not found");

  const moveToTrash = await deleteDocument(documentId);

  if (moveToTrash.error) {
    throw redirect(
      path.to.documents,
      await flash(
        request,
        error(moveToTrash.error, "Failed to delete document")
      )
    );
  }

  throw redirect(path.to.documents);
}
