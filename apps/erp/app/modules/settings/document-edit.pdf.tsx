// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SUPABASE_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { DOCUMENT_PDFS } from "@carbon/documents/pdf";
import type {
  DocumentEdit,
  DocumentEditType,
  DocumentTemplateType,
  ValueCollector
} from "@carbon/documents/template";
import { isDocumentEditType } from "@carbon/documents/template";
import {
  loadSalesInvoiceDocument,
  renderSalesInvoicePdf
} from "@carbon/lib/sales-invoice-document.server";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderPackingSlip } from "~/modules/inventory/packing-slip.pdf";
import { renderStockTransferPdf } from "~/modules/inventory/stock-transfer.pdf";
import { renderJobTravelerPdf } from "~/modules/production/production.pdf";
import {
  renderPurchaseOrderPdf,
  renderPurchaseReturnOrderPdf,
  renderPurchasingRfqPdf
} from "~/modules/purchasing/purchasing.pdf";
import { renderIssuePdf } from "~/modules/quality/quality.pdf";
import {
  renderQuotePdf,
  renderSalesOrderPdf,
  renderSalesReturnOrderPdf
} from "~/modules/sales/sales.pdf";
import {
  buildPreviewProps,
  getCompany,
  getDocumentEditRecord
} from "./settings.service";
import { DOCUMENT_EDIT_RECORDS } from "./settings.utils";

const logger = getLogger("erp", "document-edit");

/**
 * The checks every route that prints a draft shares: the document exists in the
 * caller's company, and the caller may edit it.
 */
export async function requireDocumentEditRecord(
  request: Request,
  params: { type?: string; id?: string }
) {
  const { type, id } = params;
  if (!type || !isDocumentEditType(type) || !id) {
    throw new Response("Document not found", { status: 404 });
  }
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { update: DOCUMENT_EDIT_RECORDS[type].module }
  );

  const key = { companyId, documentType: type, documentId: id };
  const record = await getDocumentEditRecord(client, companyId, type, id);
  if (record.error) {
    logger.error("Failed to read the document", {
      ...key,
      error: record.error
    });
    throw new Response("The document could not be read.", { status: 500 });
  }
  if (!record.data) throw new Response("Document not found", { status: 404 });

  return { client, companyGroupId, key, record: record.data };
}

/**
 * What a template preview prints on: the picked record, else the sample with the
 * real company branding. A draft can reword or hide anything, so printing it on a
 * real record is editing, not viewing.
 */
export async function templatePreviewProps(
  request: Request,
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    documentType: DocumentTemplateType;
    previewId: string | null;
    locale: string;
  }
): Promise<Record<string, unknown>> {
  const { companyId, documentType, previewId, locale } = args;
  if (previewId) {
    await requirePermissions(request, { update: "settings" });
    const real = await buildPreviewProps(
      client,
      companyId,
      documentType,
      previewId,
      locale
    );
    if (real) return real;
  }
  const { sample } = DOCUMENT_PDFS[documentType];
  const company = await getCompany(client, companyId);
  return { ...sample, company: company.data ?? sample.company, locale };
}

function pdfResponse({ body, fileName }: { body: Buffer; fileName: string }) {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`
    })
  });
}

/**
 * One document of a record, printed with the given edits instead of its saved
 * ones: the preview of the "Edit document" modal. Each type goes through the
 * same renderer its file route uses, so the preview matches the real PDF.
 */
export async function renderDocumentWithEdit(
  client: SupabaseClient<Database>,
  args: {
    documentType: DocumentEditType;
    documentId: string;
    companyId: string;
    companyGroupId: string;
    locale: string;
    edit: DocumentEdit | null;
    valueCollector?: ValueCollector;
  }
): Promise<Response> {
  const { documentType, documentId: id, companyId, companyGroupId } = args;
  const { locale, edit, valueCollector } = args;

  switch (documentType) {
    case "purchaseOrder":
      return pdfResponse(
        await renderPurchaseOrderPdf(client, {
          companyId,
          companyGroupId,
          purchaseOrderId: id,
          locale,
          edit,
          valueCollector
        })
      );
    case "purchaseReturnOrder":
      return pdfResponse(
        await renderPurchaseReturnOrderPdf(client, {
          companyId,
          companyGroupId,
          purchaseReturnOrderId: id,
          locale,
          edit,
          valueCollector
        })
      );
    case "purchasingRfq":
      return pdfResponse(
        await renderPurchasingRfqPdf(client, {
          companyId,
          purchasingRfqId: id,
          locale,
          edit,
          valueCollector
        })
      );
    case "quote":
      return renderQuotePdf(client, {
        id,
        companyId,
        companyGroupId,
        locale,
        edit,
        valueCollector
      });
    case "salesOrder":
      return renderSalesOrderPdf(client, {
        id,
        companyId,
        companyGroupId,
        locale,
        edit,
        valueCollector
      });
    case "salesReturnOrder":
      return renderSalesReturnOrderPdf(client, {
        id,
        companyId,
        companyGroupId,
        locale,
        edit,
        valueCollector
      });
    case "salesInvoice": {
      const { pdfProps, fileName } = await loadSalesInvoiceDocument({
        client,
        companyId,
        companyGroupId,
        invoiceId: id,
        locale,
        storageUrl: SUPABASE_URL ?? "",
        edit
      });
      return pdfResponse({
        body: await renderSalesInvoicePdf({ ...pdfProps, valueCollector }),
        fileName
      });
    }
    case "packingSlip":
      return renderPackingSlip({
        client,
        serviceRole: getCarbonServiceRole(),
        companyId,
        shipmentId: id,
        locale,
        edit,
        valueCollector
      });
    case "stockTransfer":
      return renderStockTransferPdf(client, {
        companyId,
        stockTransferId: id,
        locale,
        edit,
        valueCollector
      });
    case "jobTraveler":
      // The traveler routes read as the service role, scoped to the company.
      return pdfResponse(
        await renderJobTravelerPdf(getCarbonServiceRole(), {
          companyId,
          jobId: id,
          locale,
          edit,
          valueCollector
        })
      );
    case "issue":
      return renderIssuePdf(client, {
        companyId,
        issueId: id,
        locale,
        edit,
        valueCollector
      });
  }
}
