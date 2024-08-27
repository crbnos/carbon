import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import {
  getShippingMethodsList,
  getShippingTermsList,
} from "~/modules/inventory";
import type { SalesOrder } from "~/modules/sales";
import {
  getSalesOrderShipment,
  SalesOrderForm,
  SalesOrderShipmentForm,
  salesOrderValidator,
  upsertSalesOrder,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { ListItem } from "~/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [salesOrderShipment, shippingMethods, shippingTerms] =
    await Promise.all([
      getSalesOrderShipment(client, orderId),
      getShippingMethodsList(client, companyId),
      getShippingTermsList(client, companyId),
    ]);

  if (salesOrderShipment.error) {
    throw redirect(
      path.to.salesOrder(orderId),
      await flash(
        request,
        error(salesOrderShipment.error, "Failed to load sales order shipment")
      )
    );
  }

  if (shippingMethods.error) {
    throw redirect(
      path.to.salesOrders,
      await flash(
        request,
        error(shippingMethods.error, "Failed to load shipping methods")
      )
    );
  }

  if (shippingTerms.error) {
    throw redirect(
      path.to.salesOrders,
      await flash(
        request,
        error(shippingTerms.error, "Failed to load shipping terms")
      )
    );
  }

  return json({
    salesOrderShipment: salesOrderShipment.data,
    shippingMethods: shippingMethods.data ?? [],
    shippingTerms: shippingTerms.data ?? [],
  });
}

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
  const { salesOrderShipment, shippingMethods, shippingTerms } =
    useLoaderData<typeof loader>();
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

  const shipmentInitialValues = {
    id: salesOrderShipment.id,
    locationId: salesOrderShipment.locationId ?? "",
    shippingMethodId: salesOrderShipment.shippingMethodId ?? "",
    shippingTermId: salesOrderShipment.shippingTermId ?? "",
    trackingNumber: salesOrderShipment.trackingNumber ?? "",
    receiptRequestedDate: salesOrderShipment.receiptRequestedDate ?? "",
    receiptPromisedDate: salesOrderShipment.receiptPromisedDate ?? "",
    deliveryDate: salesOrderShipment.deliveryDate ?? "",
    notes: salesOrderShipment.notes ?? "",
    dropShipment: salesOrderShipment.dropShipment ?? false,
    customerId: salesOrderShipment.customerId ?? "",
    customerLocationId: salesOrderShipment.customerLocationId ?? "",
    ...getCustomFields(salesOrderShipment.customFields),
  };

  return (
    <>
      <SalesOrderForm key={initialValues.id} initialValues={initialValues} />

      <SalesOrderShipmentForm
        key={initialValues.id}
        initialValues={shipmentInitialValues}
        shippingMethods={shippingMethods as ListItem[]}
        shippingTerms={shippingTerms as ListItem[]}
      />
    </>
  );
}
