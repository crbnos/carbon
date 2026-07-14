import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { insertDocumentExtraction } from "~/modules/documents/documents.service";

// Each document type must be gated by the permission for the module that owns it,
// and paired with the source document the client claims to be extracting.
const DOCUMENT_TYPES = {
  salesRfq: { module: "sales", sourceDocument: "Request for Quote" },
  purchaseInvoice: { module: "purchasing", sourceDocument: "Purchase Invoice" }
} as const;

type DocumentType = keyof typeof DOCUMENT_TYPES;

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const formData = await request.formData();
  const storagePath = formData.get("storagePath") as string;
  const documentType = formData.get("documentType") as DocumentType;
  const sourceDocument = formData.get("sourceDocument") as string;
  const sourceDocumentId =
    (formData.get("sourceDocumentId") as string) || undefined;

  if (!storagePath || !documentType || !sourceDocument) {
    return data({ error: "Missing required fields" }, { status: 400 });
  }

  const documentConfig = DOCUMENT_TYPES[documentType];
  if (!documentConfig || documentConfig.sourceDocument !== sourceDocument) {
    return data({ error: "Invalid document type" }, { status: 400 });
  }

  // Gate on the module that owns this document type — an RFQ is a sales document,
  // an invoice is a purchasing document.
  const { client, companyId, userId } = await requirePermissions(request, {
    view: documentConfig.module
  });

  const result = await insertDocumentExtraction(client, {
    storagePath,
    documentType,
    sourceDocument,
    sourceDocumentId,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to start extraction"))
    );
  }

  return data({ extractionId: result.data?.id });
}
