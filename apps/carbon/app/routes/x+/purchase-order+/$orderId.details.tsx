import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { PurchaseOrder } from "~/modules/purchasing";
import {
  PurchaseOrderForm,
  purchaseOrderValidator,
  upsertPurchaseOrder,
} from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const formData = await request.formData();
  const validation = await validator(purchaseOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { purchaseOrderId, ...data } = validation.data;
  if (!purchaseOrderId) throw new Error("Could not find purchaseOrderId");

  const updatePurchaseOrder = await upsertPurchaseOrder(client, {
    id: orderId,
    purchaseOrderId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updatePurchaseOrder.error) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(updatePurchaseOrder.error, "Failed to update purchase order")
      )
    );
  }

  throw redirect(
    path.to.purchaseOrder(orderId),
    await flash(request, success("Updated purchase order"))
  );
}

export default function PurchaseOrderBasicRoute() {
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const orderData = useRouteData<{ purchaseOrder: PurchaseOrder }>(
    path.to.purchaseOrder(orderId)
  );
  if (!orderData) throw new Error("Could not find order data");

  const initialValues = {
    id: orderData?.purchaseOrder?.id ?? "",
    purchaseOrderId: orderData?.purchaseOrder?.purchaseOrderId ?? "",
    supplierId: orderData?.purchaseOrder?.supplierId ?? "",
    supplierContactId: orderData?.purchaseOrder?.supplierContactId ?? "",
    supplierLocationId: orderData?.purchaseOrder?.supplierLocationId ?? "",
    supplierReference: orderData?.purchaseOrder?.supplierReference ?? "",
    orderDate: orderData?.purchaseOrder?.orderDate ?? "",
    type: orderData?.purchaseOrder?.type ?? ("Purchase" as "Purchase"),
    status: orderData?.purchaseOrder?.status ?? ("Draft" as "Draft"),
    receiptRequestedDate: orderData?.purchaseOrder?.receiptRequestedDate ?? "",
    receiptPromisedDate: orderData?.purchaseOrder?.receiptPromisedDate ?? "",
    notes: orderData?.purchaseOrder?.notes ?? "",
    ...getCustomFields(orderData?.purchaseOrder?.customFields),
  };

  return (
    <PurchaseOrderForm key={initialValues.id} initialValues={initialValues} />
  );
}
