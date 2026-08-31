import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { resolveCurrencyAndRate } from "~/modules/accounting";
import {
  getSupplierQuote,
  isSupplierQuoteLocked,
  updateSupplierQuoteExchangeRate
} from "~/modules/purchasing";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId } = await requirePermissions(request, {
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

  // The currency comes from the document, never from the request: this route
  // refreshes a rate, and trusting a client-supplied code lets a crafted POST
  // stamp another currency's rate onto a document that keeps its own code.
  const currencyCode = quote.data?.currencyCode;
  if (!currencyCode)
    throw new Error("Document has no currency to refresh a rate for");

  const resolved = await resolveCurrencyAndRate(
    client,
    companyGroupId,
    currencyCode
  );
  if (resolved.error) throw new Error(resolved.error.message);

  const update = await updateSupplierQuoteExchangeRate(client, {
    id: id,
    exchangeRate: resolved.data.exchangeRate
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    requestReferrer(request) ?? path.to.supplierQuoteDetails(id),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
