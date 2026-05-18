import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deletePurchaseOrderLine,
  getPurchaseOrder,
  getPurchaseOrderLine,
  isPurchaseOrderLocked
} from "~/modules/purchasing";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    delete: "purchasing"
  });
  const { lineId, orderId } = params;
  if (!lineId) throw notFound("lineId not found");
  if (!orderId) throw notFound("orderId not found");

  const purchaseOrder = await getPurchaseOrder(orderId);
  await requireUnlocked({
    request,
    isLocked: isPurchaseOrderLocked(purchaseOrder.data?.status),
    redirectTo: path.to.purchaseOrderDetails(orderId),
    message: "Cannot delete lines on a confirmed purchase order."
  });

  const purchaseOrderLine = await getPurchaseOrderLine(lineId);
  if (purchaseOrderLine.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(purchaseOrderLine.error, "Failed to get purchase order line")
      )
    );
  }

  return { purchaseOrderLine: purchaseOrderLine.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "purchasing"
  });

  const { lineId, orderId } = params;
  if (!lineId) throw notFound("Could not find lineId");
  if (!orderId) throw notFound("Could not find orderId");

  const purchaseOrder = await getPurchaseOrder(orderId);
  await requireUnlocked({
    request,
    isLocked: isPurchaseOrderLocked(purchaseOrder.data?.status),
    redirectTo: path.to.purchaseOrderDetails(orderId),
    message: "Cannot delete lines on a confirmed purchase order."
  });

  const { error: deleteTypeError } = await deletePurchaseOrderLine(lineId);
  if (deleteTypeError) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(deleteTypeError, "Failed to delete purchase order line")
      )
    );
  }

  throw redirect(
    path.to.purchaseOrderDetails(orderId),
    await flash(request, success("Successfully deleted purchase order line"))
  );
}
