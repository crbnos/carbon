import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getExchangeRate } from "~/modules/accounting";
import {
  getSalesOrder,
  isSalesOrderLocked,
  updateSalesOrderExchangeRate
} from "~/modules/sales";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
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

  const currencyCode = salesOrder.data?.currencyCode;
  if (!currencyCode) throw new Error("Could not find currencyCode");

  const exchangeRate = await getExchangeRate(client, companyId, currencyCode);
  if (exchangeRate.error) {
    throw redirect(
      path.to.salesOrderDetails(orderId),
      await flash(
        request,
        error(exchangeRate.error, "Failed to get exchange rate")
      )
    );
  }

  const update = await updateSalesOrderExchangeRate(client, {
    id: orderId,
    exchangeRate: exchangeRate.data
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    path.to.salesOrderDetails(orderId),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
