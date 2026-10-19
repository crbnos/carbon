// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { insertDocumentExtraction } from "~/modules/documents/documents.service";

// Each document type must be gated by the page that owns it,
// and paired with the source document the client claims to be extracting.
const DOCUMENT_TYPES = {
  salesRfq: { page: "sales.rfqs", sourceDocument: "Request for Quote" },
  purchaseInvoice: {
    page: "invoicing.purchaseInvoices",
    sourceDocument: "Purchase Invoice"
  }
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

  // Gate on the page that owns this document type: Sales RFQs or Purchase
  // Invoices.
  const { client, companyId, userId } = await authorize(request, {
    [documentConfig.page]: "View"
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
