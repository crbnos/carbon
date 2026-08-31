import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { resolveCurrencyAndRate } from "~/modules/accounting";
import {
  getSalesInvoice,
  isSalesInvoiceLocked,
  updateSalesInvoiceExchangeRate
} from "~/modules/invoicing";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  // Check if SI is locked
  const { client: viewClient } = await requirePermissions(request, {
    view: "invoicing"
  });

  const invoice = await getSalesInvoice(viewClient, invoiceId);
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

  // The currency comes from the document, never from the request: this route
  // refreshes a rate, and trusting a client-supplied code lets a crafted POST
  // stamp another currency's rate onto a document that keeps its own code.
  const currencyCode = invoice.data?.currencyCode;
  if (!currencyCode)
    throw new Error("Document has no currency to refresh a rate for");

  const resolved = await resolveCurrencyAndRate(
    client,
    companyGroupId,
    currencyCode
  );
  if (resolved.error) throw new Error(resolved.error.message);

  const update = await updateSalesInvoiceExchangeRate(client, {
    id: invoiceId,
    exchangeRate: resolved.data.exchangeRate,
    updatedBy: userId
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    requestReferrer(request) ?? path.to.salesInvoiceDetails(invoiceId),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
