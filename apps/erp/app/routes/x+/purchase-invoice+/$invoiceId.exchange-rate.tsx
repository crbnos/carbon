import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import {
  getPurchaseInvoice,
  isPurchaseInvoiceLocked,
  updatePurchaseInvoiceExchangeRate
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

  // Check if PI is locked
  const { client: viewClient } = await requirePermissions(request, {
    view: "invoicing"
  });

  const purchaseInvoice = await getPurchaseInvoice(viewClient, invoiceId);
  if (purchaseInvoice.error) {
    throw redirect(
      path.to.purchaseInvoiceDetails(invoiceId),
      await flash(
        request,
        error(purchaseInvoice.error, "Failed to load purchase invoice")
      )
    );
  }

  await requireUnlocked({
    request,
    isLocked: isPurchaseInvoiceLocked(purchaseInvoice.data?.status),
    redirectTo: path.to.purchaseInvoiceDetails(invoiceId),
    message: "Cannot modify a confirmed purchase invoice."
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

  const update = await updatePurchaseInvoiceExchangeRate(client, {
    id: invoiceId,
    exchangeRate: currency.data.exchangeRate,
    updatedBy: userId
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    requestReferrer(request) ?? path.to.purchaseInvoiceDetails(invoiceId),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
