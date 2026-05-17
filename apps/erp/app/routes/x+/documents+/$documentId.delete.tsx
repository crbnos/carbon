import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getCompanyPrivateBucket } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteDocument, getDocument } from "~/modules/documents";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "documents"
  });

  const { documentId } = params;
  if (!documentId) throw notFound("documentId not found");

  const document = await getDocument(client, documentId);

  if (document.error || !document.data) {
    throw redirect(
      path.to.documents,
      await flash(
        request,
        error(document.error, "Failed to load document before delete")
      )
    );
  }

  const documentCompanyId = document.data.companyId ?? companyId;
  const documentPath = document.data.path;

  if (!documentPath) {
    throw redirect(
      path.to.documents,
      await flash(
        request,
        error(
          { message: "Document path is missing" },
          "Failed to delete document"
        )
      )
    );
  }

  const serviceRole = await getCarbonServiceRole();
  let storageDeleted = false;
  let storageDeleteError: string | undefined;

  for (const physicalBucket of [getCompanyPrivateBucket(documentCompanyId)]) {
    const result = await serviceRole.storage
      .from(physicalBucket)
      .remove([documentPath]);

    if (!result.error) {
      storageDeleted = true;
    } else {
      storageDeleteError = result.error.message;
    }
  }

  if (!storageDeleted) {
    throw redirect(
      path.to.documents,
      await flash(
        request,
        error(
          { message: storageDeleteError ?? "Failed to delete document file" },
          "Failed to delete document"
        )
      )
    );
  }

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
