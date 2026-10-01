// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { path } from "~/utils/path";

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
      sourceDocumentId
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
    companyId
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

  return { document: createDocument.data };
}
