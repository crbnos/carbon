import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import {
  getSalesOrder,
  isSalesOrderLocked,
  updateSalesOrderExchangeRate
} from "~/modules/sales";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyGroupId } = await requirePermissions(request, {
    view: "sales"
  });
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const salesOrder = await getSalesOrder(orderId);
  await requireUnlocked({
    request,
    isLocked: isSalesOrderLocked(salesOrder.data?.status),
    redirectTo: path.to.salesOrderDetails(orderId),
    message: "Cannot modify a locked sales order. Reopen it first."
  });

  const formData = await request.formData();
  const currencyCode = formData.get("currencyCode") as string;
  if (!currencyCode) throw new Error("Could not find currencyCode");

  const currency = await getCurrencyByCode(companyGroupId, currencyCode);
  if (currency.error || !currency.data.exchangeRate)
    throw new Error("Could not find currency");

  const update = await updateSalesOrderExchangeRate({
    id: orderId,
    exchangeRate: currency.data.exchangeRate
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    path.to.salesOrderDetails(orderId),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
