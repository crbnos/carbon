import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import {
  getQuote,
  isQuoteLocked,
  updateQuoteExchangeRate
} from "~/modules/sales";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "sales"
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });
  const quote = await getQuote(viewClient, quoteId);
  await requireUnlocked({
    request,
    isLocked: isQuoteLocked(quote.data?.status),
    redirectTo: path.to.quote(quoteId),
    message: "Cannot modify a locked quote. Reopen it first."
  });

  const currencyCode = quote.data?.currencyCode;
  if (!currencyCode) throw new Error("Could not find currencyCode");

  const exchangeRate = await getExchangeRate(client, companyId, currencyCode);
  if (exchangeRate.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.quoteDetails(quoteId),
      await flash(
        request,
        error(exchangeRate.error, "Failed to get exchange rate")
      )
    );
  }

  const update = await updateQuoteExchangeRate(client, {
    id: quoteId,
    exchangeRate: exchangeRate.data
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    requestReferrer(request) ?? path.to.quoteDetails(quoteId),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
