import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
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

  const formData = await request.formData();
  const currencyCode = formData.get("currencyCode") as string;
  if (!currencyCode) throw new Error("Could not find currencyCode");

  const currency = await getCurrencyByCode(
    client,
    companyGroupId,
    currencyCode
  );
  if (currency.error || !currency.data.exchangeRate)
    throw new Error("Could not find currency");

  const update = await updateSalesInvoiceExchangeRate(client, {
    id: invoiceId,
    exchangeRate: currency.data.exchangeRate,
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
