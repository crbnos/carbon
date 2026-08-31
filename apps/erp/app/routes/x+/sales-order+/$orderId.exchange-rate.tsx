import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { resolveCurrencyAndRate } from "~/modules/accounting";
import {
  getSalesOrder,
  isSalesOrderLocked,
  updateSalesOrderExchangeRate
} from "~/modules/sales";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "sales"
  });
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const salesOrder = await getSalesOrder(client, orderId);
  await requireUnlocked({
    request,
    isLocked: isSalesOrderLocked(salesOrder.data?.status),
    redirectTo: path.to.salesOrderDetails(orderId),
    message: "Cannot modify a locked sales order. Reopen it first."
  });

  // The currency comes from the document, never from the request: this route
  // refreshes a rate, and trusting a client-supplied code lets a crafted POST
  // stamp another currency's rate onto a document that keeps its own code.
  const currencyCode = salesOrder.data?.currencyCode;
  if (!currencyCode)
    throw new Error("Document has no currency to refresh a rate for");

  const resolved = await resolveCurrencyAndRate(
    client,
    companyGroupId,
    currencyCode
  );
  if (resolved.error) throw new Error(resolved.error.message);

  const update = await updateSalesOrderExchangeRate(client, {
    id: orderId,
    exchangeRate: resolved.data.exchangeRate
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    path.to.salesOrderDetails(orderId),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
