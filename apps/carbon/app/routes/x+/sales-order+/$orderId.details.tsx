import { validationError, validator } from "@carbon/form";
import { Await, useLoaderData, useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import { getPaymentTermsList } from "~/modules/accounting";
import { getShippingMethodsList } from "~/modules/inventory";
import type { Opportunity, SalesOrder } from "~/modules/sales";
import {
  getOpportunityBySalesOrder,
  getQuote,
  getSalesOrderPayment,
  getSalesOrderShipment,
  OpportunityDocuments,
  OpportunityNotes,
  OpportunityState,
  SalesOrderPaymentForm,
  SalesOrderShipmentForm,
  salesOrderValidator,
  upsertSalesOrder,
} from "~/modules/sales";

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Spinner, type JSONContent } from "@carbon/react";
import { Suspense } from "react";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

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

  const opportunity = await getOpportunityBySalesOrder(client, orderId);
  const originatedFromQuote = opportunity.data?.quoteId !== null;
  const quote = opportunity.data?.quoteId
    ? await getQuote(client, opportunity.data.quoteId)
    : null;

  return json({
    salesOrderShipment: salesOrderShipment.data,
    salesOrderPayment: salesOrderPayment.data,
    originatedFromQuote,
    quote,
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
  const { salesOrderShipment, salesOrderPayment } =
    useLoaderData<typeof loader>();

  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const orderData = useRouteData<{
    salesOrder: SalesOrder;
    opportunity: Opportunity;
    files: Promise<FileObject[]>;
  }>(path.to.salesOrder(orderId));
  if (!orderData) throw new Error("Could not find order data");

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
    ...getCustomFields(salesOrderPayment.customFields),
  };

  return (
    <>
      <OpportunityState opportunity={orderData.opportunity} />
      <OpportunityNotes
        key={`notes-${orderId}`}
        id={orderData.salesOrder.id}
        table="salesOrder"
        title={orderData.salesOrder.salesOrderId ?? ""}
        internalNotes={orderData.salesOrder.internalNotes as JSONContent}
        externalNotes={orderData.salesOrder.externalNotes as JSONContent}
      />
      <Suspense
        key={`documents-${orderId}`}
        fallback={
          <div className="flex w-full min-h-[480px]  h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
            <Spinner className="h-10 w-10" />
          </div>
        }
      >
        <Await resolve={orderData.files}>
          {(resolvedFiles) => (
            <OpportunityDocuments
              opportunity={orderData.opportunity}
              attachments={resolvedFiles}
              id={orderId}
              type="Sales Order"
            />
          )}
        </Await>
      </Suspense>

      <SalesOrderShipmentForm
        key={`shipment-${orderId}`}
        initialValues={shipmentInitialValues}
      />

      <SalesOrderPaymentForm
        key={`payment-${orderId}`}
        initialValues={paymentInitialValues}
      />
    </>
  );
}
