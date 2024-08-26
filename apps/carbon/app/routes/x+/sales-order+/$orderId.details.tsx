import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { SalesOrder } from "~/modules/sales";
import {
  SalesOrderForm,
  salesOrderValidator,
  upsertSalesOrder,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const formData = await request.formData();
  const validation = await validator(salesOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { salesOrderId, ...data } = validation.data;
  if (!salesOrderId) throw new Error("Could not find salesOrderId");

  const updateSalesOrder = await upsertSalesOrder(client, {
    id: orderId,
    salesOrderId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateSalesOrder.error) {
    throw redirect(
      path.to.salesOrder(orderId),
      await flash(
        request,
        error(updateSalesOrder.error, "Failed to update sales order")
      )
    );
  }

  throw redirect(
    path.to.salesOrder(orderId),
    await flash(request, success("Updated sales order"))
  );
}

export default function SalesOrderBasicRoute() {
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const orderData = useRouteData<{ salesOrder: SalesOrder }>(
    path.to.salesOrder(orderId)
  );
  if (!orderData) throw new Error("Could not find order data");

  const initialValues = {
    id: orderData?.salesOrder?.id ?? "",
    salesOrderId: orderData?.salesOrder?.salesOrderId ?? "",
    customerId: orderData?.salesOrder?.customerId ?? "",
    customerContactId: orderData?.salesOrder?.customerContactId ?? "",
    customerLocationId: orderData?.salesOrder?.customerLocationId ?? "",
    customerReference: orderData?.salesOrder?.customerReference ?? "",
    orderDate: orderData?.salesOrder?.orderDate ?? "",
    status: orderData?.salesOrder?.status ?? ("Draft" as "Draft"),
    receiptRequestedDate: orderData?.salesOrder?.receiptRequestedDate ?? "",
    receiptPromisedDate: orderData?.salesOrder?.receiptPromisedDate ?? "",
    notes: orderData?.salesOrder?.notes ?? "",
    ...getCustomFields(orderData?.salesOrder?.customFields),
  };

  return (
    <>
      <SalesOrderForm key={initialValues.id} initialValues={initialValues} />
    </>
  );
}
