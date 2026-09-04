import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import {
  getSupplierQuote,
  isSupplierQuoteLocked,
  updateSupplierQuoteExchangeRate
} from "~/modules/purchasing";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });
  const quote = await getSupplierQuote(viewClient, id);
  await requireUnlocked({
    request,
    isLocked: isSupplierQuoteLocked(quote.data?.status),
    redirectTo: path.to.supplierQuote(id),
    message: "Cannot modify a locked supplier quote. Reopen it first."
  });

  const currencyCode = quote.data?.currencyCode;
  if (!currencyCode) throw new Error("Could not find currencyCode");

  const exchangeRate = await getExchangeRate(client, companyId, currencyCode);
  if (exchangeRate.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.supplierQuoteDetails(id),
      await flash(
        request,
        error(exchangeRate.error, "Failed to get exchange rate")
      )
    );
  }

  const update = await updateSupplierQuoteExchangeRate(client, {
    id: id,
    exchangeRate: exchangeRate.data
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    requestReferrer(request) ?? path.to.supplierQuoteDetails(id),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
