// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getDocument } from "~/modules/documents";
import DocumentView from "~/modules/documents/ui/Documents/DocumentView";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "documents"
  });

  const { documentId } = params;
  if (!documentId) throw notFound("documentId not found");

  const document = await getDocument(client, documentId);

  if (document.error) {
    throw redirect(
      path.to.documents,
      await flash(request, error(document.error, "Failed to get document"))
    );
  }

  return {
    document: document.data
  };
}

export default function ViewDocumentRoute() {
  const { document } = useLoaderData<typeof loader>();

  let name = document.name;
  if (name) name = name.split(".").slice(0, -1).join(".");

  return (
    <DocumentView key={document.id} bucket={"private"} document={document} />
  );
}
