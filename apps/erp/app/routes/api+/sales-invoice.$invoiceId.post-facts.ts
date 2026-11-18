// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import {
  getSalesInvoice,
  getSalesInvoiceLines,
  getSalesInvoicePostFacts
} from "~/modules/invoicing/invoicing.service";
import type { SalesInvoicePostFacts } from "~/modules/invoicing/invoicing.utils";

const logger = getLogger("erp", "sales-invoice");

export type SalesInvoicePostFactsResponse = {
  facts: SalesInvoicePostFacts | null;
};

/**
 * What the Post Invoice modal's checks read beyond the invoice: its orders'
 * left-to-invoice quantities and unbilled charges, and today's rate. Read when
 * the modal opens, so the checks see other invoices posted since the page
 * loaded. A draft only; anything else, or a failed read, answers no facts, and
 * the checks that need them stay quiet rather than guess.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) {
    return Response.json({
      facts: null
    } satisfies SalesInvoicePostFactsResponse);
  }

  // The invoice and its lines as the caller: their RLS is the gate.
  const [invoice, lines] = await Promise.all([
    getSalesInvoice(client, invoiceId),
    getSalesInvoiceLines(client, invoiceId)
  ]);
  if (invoice.error || lines.error || invoice.data?.status !== "Draft") {
    if (invoice.error || lines.error) {
      logger.error("Failed to read the sales invoice for its post facts", {
        companyId,
        invoiceId,
        error: invoice.error ?? lines.error
      });
    }
    return Response.json({
      facts: null
    } satisfies SalesInvoicePostFactsResponse);
  }

  // The service role reads the order tables an invoicing user may not see;
  // only the orders this invoice's own lines link to, scoped to the company.
  const facts = await getSalesInvoicePostFacts(
    getCarbonServiceRole(),
    companyId,
    invoiceId,
    invoice.data.currencyCode ?? null,
    lines.data ?? []
  );
  if (facts.error) {
    logger.error("Failed to read the sales invoice post facts", {
      companyId,
      invoiceId,
      error: facts.error
    });
  }

  return Response.json({
    facts: facts.data
  } satisfies SalesInvoicePostFactsResponse);
}
