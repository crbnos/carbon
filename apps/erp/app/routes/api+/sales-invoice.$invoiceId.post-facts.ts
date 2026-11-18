// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { getSalesInvoicePostFacts } from "~/modules/invoicing/invoicing.service";
import type { SalesInvoicePostFacts } from "~/modules/invoicing/invoicing.utils";

const logger = getLogger("erp", "sales-invoice");

export type SalesInvoicePostFactsResponse = {
  facts: SalesInvoicePostFacts | null;
  /** The facts could not be read: the order checks did not run. */
  failed: boolean;
};

const answer = (body: SalesInvoicePostFactsResponse) => Response.json(body);

/**
 * What the Post Invoice modal's checks read beyond the invoice: its orders'
 * left-to-invoice quantities and unbilled charges, and today's rate. Read when
 * the modal opens, so the checks see other invoices posted since the page
 * loaded. A draft only; anything else answers no facts. A failed read says
 * so, and the modal tells the user the order checks did not run.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  // Employees only: the service-role read below is for the invoice screen,
  // not for an API key.
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing",
    role: "employee"
  });

  const { invoiceId } = params;
  if (!invoiceId) return answer({ facts: null, failed: false });

  // The invoice and its lines as the caller: their RLS is the gate. The bare
  // tables, not the `salesInvoices` / `salesInvoiceLines` views, since only a
  // few columns are read.
  const [invoice, lines] = await Promise.all([
    client
      .from("salesInvoice")
      .select("status, currencyCode")
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("salesInvoiceLine")
      .select("salesOrderId, salesOrderLineId")
      .eq("invoiceId", invoiceId)
      .eq("companyId", companyId)
  ]);
  if (invoice.error || lines.error) {
    logger.error("Failed to read the sales invoice for its post facts", {
      companyId,
      invoiceId,
      error: invoice.error ?? lines.error
    });
    return answer({ facts: null, failed: true });
  }
  if (invoice.data?.status !== "Draft") {
    return answer({ facts: null, failed: false });
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
    return answer({ facts: null, failed: true });
  }

  return answer({ facts: facts.data, failed: false });
}
