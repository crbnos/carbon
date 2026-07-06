import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { duplicatePurchaseOrder } from "~/modules/purchasing/purchasing.service";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing",
      bypassRls: true
    });

  const { orderId } = params;
  if (!orderId) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error(null, "Failed to duplicate purchase order: missing id")
      )
    );
  }

  const result = await duplicatePurchaseOrder(client, {
    sourcePurchaseOrderId: orderId,
    companyId,
    companyGroupId,
    userId
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error(result.error, "Failed to duplicate purchase order")
      )
    );
  }

  throw redirect(path.to.purchaseOrder(result.data.id));
}
