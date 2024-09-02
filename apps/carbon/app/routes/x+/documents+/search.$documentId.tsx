import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  DocumentForm,
  documentValidator,
  getDocument,
  upsertDocument,
} from "~/modules/documents";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "documents",
  });

  const validation = await validator(documentValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, extension, ...document } = validation.data;
  if (!id) throw new Error("Could not find documentId");

  const updateDocument = await upsertDocument(client, {
    id,
    ...document,
    name: `${document.name}.${extension}`,
    updatedBy: userId,
  });

  if (updateDocument.error) {
    throw redirect(
      path.to.documents,
      await flash(
        request,
        error(updateDocument.error, "Failed to update document")
      )
    );
  }

  throw redirect(
    path.to.documents,
    await flash(request, success("Updated document"))
  );
}

export default function EditDocumentRoute() {
  const { document } = useLoaderData<typeof loader>();

  let name = document.name;
  if (name) name = name.split(".").slice(0, -1).join(".");

  const initialValues = {
    id: document.id ?? "",
    name: name ?? "",
    description: document.description ?? "",
    type: document.type ?? "",
    extension: document.extension ?? "",
    size: document.size ?? 0,
    readGroups: document.readGroups ?? [],
    writeGroups: document.writeGroups ?? [],
  };

  return (
    <DocumentForm
      key={initialValues.id}
      initialValues={initialValues}
      ownerId={document.createdBy ?? ""}
    />
  );
}
