import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  isPurchaseOrderLocked,
  purchaseOrderDeliveryValidator
} from "~/modules/purchasing";
import {
  getPurchaseOrder,
  upsertPurchaseOrderDelivery
} from "~/modules/purchasing/purchasing.service.server";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  // First check with view permission to get PO status
  await requirePermissions(request, {
    view: "purchasing"
  });

  const purchaseOrder = await getPurchaseOrder(orderId);
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

  const { userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(purchaseOrderDeliveryValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePurchaseOrderDelivery = await upsertPurchaseOrderDelivery({
    ...validation.data,
    id: orderId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updatePurchaseOrderDelivery.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(
        request,
        error(
          updatePurchaseOrderDelivery.error,
          "Failed to update purchase order delivery"
        )
      )
    );
  }

  throw redirect(
    path.to.purchaseOrderDetails(orderId),
    await flash(request, success("Updated purchase order delivery"))
  );
}
