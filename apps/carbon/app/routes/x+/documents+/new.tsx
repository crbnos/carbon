import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { upsertDocument } from "~/modules/documents";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path, requestReferrer } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});
  const formData = await request.formData();

  const documentPath = formData.get("path");
  const name = formData.get("name");
  const sourceDocument = formData.get("sourceDocument");
  const sourceDocumentId = formData.get("sourceDocumentId");

  if (typeof documentPath !== "string") throw new Error("Invalid path");
  if (typeof name !== "string") throw new Error("Invalid name");

  const size = Number(formData.get("size"));

  let source = {};
  if (sourceDocument && sourceDocumentId) {
    source = {
      sourceDocument,
      sourceDocumentId,
    };
  }

  const createDocument = await upsertDocument(client, {
    path: documentPath,
    name,
    size,
    ...source,
    readGroups: [userId],
    writeGroups: [userId],
    createdBy: userId,
    companyId,
  });
  if (createDocument.error) {
    throw redirect(
      path.to.documents,
      await flash(
        request,
        error(createDocument.error, "Failed to create document")
      )
    );
  }

  throw redirect(requestReferrer(request) ?? path.to.documents);
}
