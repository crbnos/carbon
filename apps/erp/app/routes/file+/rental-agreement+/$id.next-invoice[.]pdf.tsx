// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  loadUnsavedSalesInvoiceDocument,
  renderSalesInvoicePdf
} from "@carbon/lib/sales-invoice-document.server";
import { datetime, getPreferenceHeaders, round } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { computeInvoiceDateDue } from "~/modules/invoicing/invoicing.service";
import {
  getRentalAgreement,
  getRentalNextInvoice
} from "~/modules/sales/sales.service";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";

/** The invoice the next billing run will draft for an agreement, as a PDF.
 *  Nothing is saved: the invoice is planned in memory and rendered. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { view: ["sales", "invoicing"] }
  );

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const agreement = await getRentalAgreement(client, id, companyId);
  if (agreement.error || agreement.data?.companyId !== companyId) {
    throw new Response("The rental agreement could not be found.", {
      status: 404
    });
  }

  const timeZone = await getCompanyTimeZone(client, companyId);
  const next = await getRentalNextInvoice(getDatabaseClient(), {
    companyId,
    rentalAgreementId: id,
    today: datetime.today(timeZone).toString()
  });
  const role = new URL(request.url).searchParams.get("invoice");
  const invoice =
    next?.invoices.find((planned) => planned.role === role) ??
    next?.invoices[0];
  if (!next || !invoice) {
    throw new Response("This agreement has no upcoming invoice.", {
      status: 404
    });
  }

  const dateDue = await computeInvoiceDateDue(client, {
    dateIssued: next.asOf,
    paymentTermId: agreement.data.paymentTermId,
    companyId
  });

  const exchangeRate = agreement.data.exchangeRate ?? 1;
  const { locale } = getPreferenceHeaders(request);
  const { pdfProps, fileName } = await loadUnsavedSalesInvoiceDocument({
    client,
    companyId,
    companyGroupId,
    locale,
    invoice: {
      invoiceId: "Preview",
      customerId: agreement.data.customerId!,
      customerLocationId: agreement.data.customerLocationId ?? null,
      customerContactId: agreement.data.customerContactId ?? null,
      paymentTermId: agreement.data.paymentTermId ?? null,
      currencyCode: agreement.data.currencyCode!,
      exchangeRate,
      dateIssued: next.asOf,
      dateDue,
      subtotal: invoice.subtotal,
      totalTax: invoice.totalTax,
      totalAmount: invoice.totalAmount,
      lines: invoice.lines.map((line, index) => ({
        id: `preview-${index + 1}`,
        invoiceLineType: "Rental",
        description: line.description,
        unitPrice: line.unitPrice,
        convertedUnitPrice: round(line.unitPrice * exchangeRate),
        taxPercent: line.taxPercent
      }))
    }
  });

  const body = await renderSalesInvoicePdf(pdfProps);
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`
    }
  });
}
