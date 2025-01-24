import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from "@carbon/react";
import { Await, useLoaderData, useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { JSONContent } from "@tiptap/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { Suspense, useRef } from "react";
import { useRouteData } from "~/hooks";
import type { Opportunity, SalesOrder, SalesOrderLine } from "~/modules/sales";
import {
  getSalesOrder,
  getSalesOrderPayment,
  getSalesOrderShipment,
  salesOrderValidator,
  upsertSalesOrder,
} from "~/modules/sales";
import {
  OpportunityDocuments,
  OpportunityNotes,
  OpportunityState,
} from "~/modules/sales/ui/Opportunity";
import {
  SalesOrderPaymentForm,
  SalesOrderShipmentForm,
  SalesOrderSummary,
} from "~/modules/sales/ui/SalesOrder";
import type { SalesOrderShipmentFormRef } from "~/modules/sales/ui/SalesOrder/SalesOrderShipmentForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

type LoaderData = {
  internalNotes: JSONContent;
  externalNotes: JSONContent;
  payment: Database["public"]["Tables"]["salesOrderPayment"]["Row"];
  shipment: Database["public"]["Tables"]["salesOrderShipment"]["Row"];
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [order, payment, shipment] = await Promise.all([
    getSalesOrder(client, orderId),
    getSalesOrderPayment(client, orderId),
    getSalesOrderShipment(client, orderId),
  ]);

  if (order.error) {
    throw redirect(
      path.to.salesOrders,
      await flash(request, error(order.error, "Failed to load order"))
    );
  }

  if (payment.error) {
    throw redirect(
      path.to.salesOrders,
      await flash(request, error(payment.error, "Failed to load order payment"))
    );
  }

  if (shipment.error) {
    throw redirect(
      path.to.salesOrders,
      await flash(
        request,
        error(shipment.error, "Failed to load order shipment")
      )
    );
  }

  return json<LoaderData>({
    internalNotes: (order.data?.internalNotes ?? {}) as JSONContent,
    externalNotes: (order.data?.externalNotes ?? {}) as JSONContent,
    payment: payment.data || null,
    shipment: shipment.data || null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const { orderId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(salesOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { salesOrderId, ...data } = validation.data;
  if (!salesOrderId) throw new Error("Could not find salesOrderId");

  const update = await upsertSalesOrder(client, {
    id,
    salesOrderId,
    ...data,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.salesOrder(id),
      await flash(request, error(update.error, "Failed to update order"))
    );
  }

  throw redirect(
    path.to.salesOrder(id),
    await flash(request, success("Updated order"))
  );
}

export default function SalesOrderDetailsRoute() {
  const { internalNotes, externalNotes, payment, shipment } =
    useLoaderData<typeof loader>();
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const orderData = useRouteData<{
    salesOrder: SalesOrder;
    lines: SalesOrderLine[];
    opportunity: Opportunity;
    files: Promise<FileObject[]>;
  }>(path.to.salesOrder(orderId));

  if (!orderData) throw new Error("Could not find order data");

  const shipmentFormRef = useRef<SalesOrderShipmentFormRef>(null);

  const handleEditShippingCost = () => {
    shipmentFormRef.current?.focusShippingCost();
  };

  const shipmentInitialValues = {
    id: shipment.id,
    locationId: shipment?.locationId ?? "",
    shippingMethodId: shipment?.shippingMethodId ?? "",
    shippingTermId: shipment?.shippingTermId ?? "",
    trackingNumber: shipment?.trackingNumber ?? "",
    receiptRequestedDate: shipment?.receiptRequestedDate ?? "",
    receiptPromisedDate: shipment?.receiptPromisedDate ?? "",
    deliveryDate: shipment?.deliveryDate ?? "",
    notes: shipment?.notes ?? "",
    dropShipment: shipment?.dropShipment ?? false,
    customerId: shipment?.customerId ?? "",
    customerLocationId: shipment?.customerLocationId ?? "",
    shippingCost: shipment?.shippingCost ?? 0,
    ...getCustomFields(shipment?.customFields),
  };

  const paymentInitialValues = {
    id: payment.id,
    invoiceCustomerId: payment?.invoiceCustomerId ?? "",
    invoiceCustomerLocationId: payment?.invoiceCustomerLocationId ?? "",
    invoiceCustomerContactId: payment?.invoiceCustomerContactId ?? "",
    paymentTermId: payment?.paymentTermId ?? "",
    paymentComplete: payment?.paymentComplete ?? undefined,
    ...getCustomFields(payment?.customFields),
  };

  return (
    <>
      <OpportunityState
        key={`state-${orderId}`}
        opportunity={orderData?.opportunity!}
      />
      <SalesOrderSummary onEditShippingCost={handleEditShippingCost} />
      <SalesOrderJobsSummary />
      <OpportunityNotes
        key={`notes-${orderId}`}
        id={orderData.salesOrder.id}
        table="salesOrder"
        title="Notes"
        internalNotes={internalNotes}
        externalNotes={externalNotes}
      />
      <Suspense
        key={`documents-${orderId}`}
        fallback={
          <div className="flex w-full min-h-[480px] h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
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
        ref={shipmentFormRef}
        initialValues={shipmentInitialValues}
      />

      <SalesOrderPaymentForm
        key={`payment-${orderId}`}
        initialValues={paymentInitialValues}
      />
    </>
  );
}

function SalesOrderJobsSummary() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Jobs</CardTitle>
      </CardHeader>
      <CardContent>
        <div>
          <p>Jobs</p>
        </div>
      </CardContent>
    </Card>
  );
}
