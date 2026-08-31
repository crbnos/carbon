import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { resolveCurrencyAndRate } from "~/modules/accounting";
import {
  getPurchaseOrder,
  isPurchaseOrderLocked,
  updatePurchaseOrderExchangeRate
} from "~/modules/purchasing";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId } = await requirePermissions(request, {
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

  // The currency comes from the document, never from the request: this route
  // refreshes a rate, and trusting a client-supplied code lets a crafted POST
  // stamp another currency's rate onto a document that keeps its own code.
  const currencyCode = purchaseOrder.data?.currencyCode;
  if (!currencyCode)
    throw new Error("Document has no currency to refresh a rate for");

  const resolved = await resolveCurrencyAndRate(
    client,
    companyGroupId,
    currencyCode
  );
  if (resolved.error) throw new Error(resolved.error.message);

  const update = await updatePurchaseOrderExchangeRate(client, {
    id: orderId,
    exchangeRate: resolved.data.exchangeRate
  });

  if (update.error) {
    throw new Error("Could not update exchange rate");
  }

  return redirect(
    path.to.purchaseOrderDetails(orderId),
    await flash(request, success("Successfully updated exchange rate"))
  );
}
