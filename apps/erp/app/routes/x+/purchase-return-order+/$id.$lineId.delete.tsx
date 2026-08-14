import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deletePurchaseReturnOrderLine,
  getPurchaseReturnOrder,
  getPurchaseReturnOrderLine,
  isPurchaseReturnOrderLocked
} from "~/modules/purchasing";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id: orderId, lineId } = params;
  if (!orderId) throw notFound("Could not find orderId");
  if (!lineId) throw notFound("Could not find lineId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });

  const [purchaseReturnOrder, line] = await Promise.all([
    getPurchaseReturnOrder(viewClient, orderId),
    getPurchaseReturnOrderLine(viewClient, lineId)
  ]);

  await requireUnlocked({
    request,
    isLocked: isPurchaseReturnOrderLocked(purchaseReturnOrder.data?.status),
    redirectTo: path.to.purchaseReturnOrder(orderId),
    message: "Cannot delete lines on a completed or cancelled return order."
  });

  if (Number(line.data?.quantityShipped) > 0) {
    throw redirect(
      requestReferrer(request) ?? path.to.purchaseReturnOrder(orderId),
      await flash(
        request,
        error(null, "Cannot delete a line with shipped quantity")
      )
    );
  }

  const { client } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { error: deleteLineError } = await deletePurchaseReturnOrderLine(
    client,
    lineId
  );
  if (deleteLineError) {
    throw redirect(
      requestReferrer(request) ?? path.to.purchaseReturnOrder(orderId),
      await flash(
        request,
        error(deleteLineError, "Failed to delete return order line")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.purchaseReturnOrder(orderId),
    await flash(request, success("Successfully deleted return order line"))
  );
}
