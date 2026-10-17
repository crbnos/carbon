// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getSalesInvoice, isSalesInvoiceLocked } from "~/modules/invoicing";
import { recalculateSalesDocumentTaxes } from "~/modules/sales/sales.server";
import { getDatabaseClient } from "~/services/database.server";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const invoice = await getSalesInvoice(client, invoiceId);
  if (invoice.error) {
    throw redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(request, error(invoice.error, "Failed to load sales invoice"))
    );
  }

  await requireUnlocked({
    request,
    isLocked: isSalesInvoiceLocked(invoice.data?.status),
    redirectTo: path.to.salesInvoiceDetails(invoiceId),
    message: "Cannot modify a locked sales invoice. Reopen it first."
  });

  const result = await recalculateSalesDocumentTaxes(
    client,
    getDatabaseClient(),
    { companyId, userId, document: "salesInvoice", documentId: invoiceId }
  );

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesInvoiceDetails(invoiceId),
      await flash(request, error(result.error, "Failed to recalculate taxes"))
    );
  }

  return redirect(
    requestReferrer(request) ?? path.to.salesInvoiceDetails(invoiceId),
    await flash(request, success("Recalculated taxes"))
  );
}
