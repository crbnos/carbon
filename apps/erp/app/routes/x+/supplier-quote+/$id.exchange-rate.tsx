import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import {
  getSupplierQuote,
  isSupplierQuoteLocked,
  updateSupplierQuoteExchangeRate
} from "~/modules/purchasing";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyGroupId } = await requirePermissions(request, {
    create: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  await requirePermissions(request, {
    view: "purchasing"
  });
  const quote = await getSupplierQuote(id);
  await requireUnlocked({
    request,
    isLocked: isSupplierQuoteLocked(quote.data?.status),
    redirectTo: path.to.supplierQuote(id),
    message: "Cannot modify a locked supplier quote. Reopen it first."
  });

  const formData = await request.formData();
  const currencyCode = formData.get("currencyCode") as string;
  if (!currencyCode) throw new Error("Could not find currencyCode");

  const currency = await getCurrencyByCode(companyGroupId, currencyCode);
  if (currency.error || !currency.data.exchangeRate)
    throw new Error("Could not find currency");

  const update = await updateSupplierQuoteExchangeRate({
    id: id,
    exchangeRate: currency.data.exchangeRate
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    requestReferrer(request) ?? path.to.supplierQuoteDetails(id),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
