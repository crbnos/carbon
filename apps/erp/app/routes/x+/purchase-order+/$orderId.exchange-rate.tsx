import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import {
  getPurchaseOrder,
  isPurchaseOrderLocked,
  updatePurchaseOrderExchangeRate
} from "~/modules/purchasing";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyGroupId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  // Check if PO is locked
  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });

  const purchaseOrder = await getPurchaseOrder(viewClient, orderId);
  if (purchaseOrder.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(purchaseOrder.error, "Failed to load purchase order")
      )
    );
  }

  await requireUnlocked({
    request,
    isLocked: isPurchaseOrderLocked(purchaseOrder.data?.status),
    redirectTo: path.to.purchaseOrderDetails(orderId),
    message: "Cannot modify a confirmed purchase order."
  });

  const formData = await request.formData();
  const currencyCode = formData.get("currencyCode") as string;
  if (!currencyCode) throw new Error("Could not find currencyCode");

  const currency = await getCurrencyByCode(companyGroupId, currencyCode);
  if (currency.error || !currency.data.exchangeRate)
    throw new Error("Could not find currency");

  const update = await updatePurchaseOrderExchangeRate({
    id: orderId,
    exchangeRate: currency.data.exchangeRate
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    path.to.purchaseOrderDetails(orderId),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
