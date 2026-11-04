// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SUPABASE_URL } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type {
  DocumentEdit,
  DocumentEditType
} from "@carbon/documents/template";
import {
  loadSalesInvoiceDocument,
  renderSalesInvoicePdf
} from "@carbon/lib/sales-invoice-document.server";
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
  }
): Promise<Response> {
  const { documentType, documentId: id, companyId, companyGroupId } = args;
  const { locale, edit } = args;

  switch (documentType) {
    case "purchaseOrder":
      return pdfResponse(
        await renderPurchaseOrderPdf(client, {
          companyId,
          companyGroupId,
          purchaseOrderId: id,
          locale,
          edit
        })
      );
    case "purchaseReturnOrder":
      return pdfResponse(
        await renderPurchaseReturnOrderPdf(client, {
          companyId,
          companyGroupId,
          purchaseReturnOrderId: id,
          locale,
          edit
        })
      );
    case "purchasingRfq":
      return pdfResponse(
        await renderPurchasingRfqPdf(client, {
          companyId,
          purchasingRfqId: id,
          locale,
          edit
        })
      );
    case "quote":
      return renderQuotePdf(client, {
        id,
        companyId,
        companyGroupId,
        locale,
        edit
      });
    case "salesOrder":
      return renderSalesOrderPdf(client, {
        id,
        companyId,
        companyGroupId,
        locale,
        edit
      });
    case "salesReturnOrder":
      return renderSalesReturnOrderPdf(client, {
        id,
        companyId,
        companyGroupId,
        locale,
        edit
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
        body: await renderSalesInvoicePdf(pdfProps),
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
        edit
      });
    case "stockTransfer":
      return renderStockTransferPdf(client, {
        companyId,
        stockTransferId: id,
        locale,
        edit
      });
    case "jobTraveler":
      // The traveler routes read as the service role, scoped to the company.
      return pdfResponse(
        await renderJobTravelerPdf(getCarbonServiceRole(), {
          companyId,
          jobId: id,
          locale,
          edit
        })
      );
    case "issue":
      return renderIssuePdf(client, { companyId, issueId: id, locale, edit });
  }
}
