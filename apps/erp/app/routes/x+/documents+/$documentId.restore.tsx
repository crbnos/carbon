// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { restoreDocument } from "~/modules/documents";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    delete: "documents"
  });

  const { documentId } = params;
  if (!documentId) throw notFound("documentId not found");

  const removeFromTrash = await restoreDocument(client, documentId, userId);

  if (removeFromTrash.error) {
    throw redirect(
      path.to.documents,
      await flash(
        request,
        error(removeFromTrash.error, "Failed to restore document")
      )
    );
  }

  throw redirect(path.to.documentsTrash);
}
