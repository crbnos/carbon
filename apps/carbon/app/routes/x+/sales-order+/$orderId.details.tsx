import { validationError, validator } from "@carbon/form";
import { useLoaderData, useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import { getPaymentTermsList } from "~/modules/accounting";
import { getShippingMethodsList } from "~/modules/inventory";
import type { Opportunity, SalesOrder } from "~/modules/sales";
import {
  getSalesOrderPayment,
  getSalesOrderShipment,
  OpportunityDocuments,
  SalesOrderForm,
  SalesOrderPaymentForm,
  SalesOrderShipmentForm,
  salesOrderValidator,
  upsertSalesOrder,
} from "~/modules/sales";

import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
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

  const [
    salesOrderShipment,
    salesOrderPayment,

    // shippingTerms,
  ] = await Promise.all([
    getSalesOrderShipment(client, orderId),
    getSalesOrderPayment(client, orderId),
    getPaymentTermsList(client, companyId),
    getShippingMethodsList(client, companyId),
    // getShippingTermsList(client, companyId),
  ]);

  if (salesOrderShipment.error) {
    // TODO: insert a salesOrderShipment record
    throw redirect(
      path.to.salesOrders,
      await flash(
        request,
        error(salesOrderShipment.error, "Failed to load sales order shipment")
      )
    );
  }

  if (salesOrderPayment.error) {
    // TODO: insert a salesOrderPayment record
    throw redirect(
      path.to.salesOrders,
      await flash(
        request,
        error(salesOrderPayment.error, "Failed to load sales order payment")
      )
    );
  }

  // if (shippingTerms.error) {
  //   throw redirect(
  //     path.to.salesOrders,
  //     await flash(
  //       request,
  //       error(shippingTerms.error, "Failed to load shipping terms")
  //     )
  //   );
  // }

  return json({
    salesOrderShipment: salesOrderShipment.data,
    salesOrderPayment: salesOrderPayment.data,
    // shippingTerms: shippingTerms.data ?? [],
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

export default function SalesOrderRoute() {
  const {
    salesOrderShipment,
    salesOrderPayment,
    // shippingTerms,
  } = useLoaderData<typeof loader>();
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const orderData = useRouteData<{
    salesOrder: SalesOrder;
    opportunity: Opportunity;
    files: FileObject[];
  }>(path.to.salesOrder(orderId));
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

  const paymentInitialValues = {
    ...salesOrderPayment,
    invoiceCustomerId: salesOrderPayment.invoiceCustomerId ?? "",
    invoiceCustomerLocationId:
      salesOrderPayment.invoiceCustomerLocationId ?? "",
    invoiceCustomerContactId: salesOrderPayment.invoiceCustomerContactId ?? "",
    paymentTermId: salesOrderPayment.paymentTermId ?? "",
    currencyCode: salesOrderPayment.currencyCode as "USD",
    ...getCustomFields(salesOrderPayment.customFields),
  };

  return (
    <>
      <SalesOrderForm key={initialValues.id} initialValues={initialValues} />
      <OpportunityDocuments
        opportunity={orderData?.opportunity!}
        attachments={orderData?.files ?? []}
        id={orderId}
        type="Sales Order"
      />
      <SalesOrderShipmentForm
        key={initialValues.id}
        initialValues={shipmentInitialValues}

        // shippingTerms={shippingTerms as ListItem[]}
      />

      <SalesOrderPaymentForm
        key={initialValues.id}
        initialValues={paymentInitialValues}
      />
    </>
  );
}
