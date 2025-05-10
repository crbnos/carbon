import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { getCurrencyByCode } from "~/modules/accounting";
import { updatePurchaseInvoiceExchangeRate } from "~/modules/invoicing";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "invoicing",
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const formData = await request.formData();
  const currencyCode = formData.get("currencyCode") as string;
  if (!currencyCode) throw new Error("Could not find currencyCode");

  const currency = await getCurrencyByCode(client, companyId, currencyCode);
  if (currency.error || !currency.data.exchangeRate)
    throw new Error("Could not find currency");

  const update = await updatePurchaseInvoiceExchangeRate(client, {
    id: invoiceId,
    exchangeRate: currency.data.exchangeRate,
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    requestReferrer(request) ?? path.to.purchaseInvoiceDetails(invoiceId),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
