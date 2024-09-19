import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteDocument } from "~/modules/documents";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "documents",
  });

  const { documentId } = params;
  if (!documentId) throw notFound("documentId not found");

  const moveToTrash = await deleteDocument(client, documentId);

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
