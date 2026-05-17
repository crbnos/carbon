import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getCompanyPrivateBucket } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getDocument } from "~/modules/documents";
import DocumentView from "~/modules/documents/ui/Documents/DocumentView";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
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
    companyId,
    document: document.data
  };
}

export default function ViewDocumentRoute() {
  const { companyId, document } = useLoaderData<typeof loader>();

  let name = document.name;
  if (name) name = name.split(".").slice(0, -1).join(".");

  return (
    <DocumentView
      key={document.id}
      bucket={getCompanyPrivateBucket(document.companyId ?? companyId)}
      document={document}
    />
  );
}
