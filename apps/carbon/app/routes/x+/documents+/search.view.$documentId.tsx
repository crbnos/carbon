import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDocument } from "~/modules/documents";
import DocumentView from "~/modules/documents/ui/Documents/DocumentView";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "documents",
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

  return json({
    document: document.data,
  });
}

export default function ViewDocumentRoute() {
  const { document } = useLoaderData<typeof loader>();

  let name = document.name;
  if (name) name = name.split(".").slice(0, -1).join(".");

  return (
    <DocumentView key={document.id} bucket={"private"} document={document} />
  );
}
