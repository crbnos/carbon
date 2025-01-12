import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner } from "@carbon/react";
import { Await, useLoaderData, useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { Suspense } from "react";
import { useRouteData } from "~/hooks";
import type { PurchaseOrder, PurchaseOrderLine } from "~/modules/purchasing";
import {
  getPurchaseOrder,
  getPurchaseOrderDelivery,
  getPurchaseOrderPayment,
  purchaseOrderValidator,
  upsertPurchaseOrder,
} from "~/modules/purchasing";
import {
  PurchaseOrderDeliveryForm,
  PurchaseOrderPaymentForm,
  PurchaseOrderSummary,
} from "~/modules/purchasing/ui/PurchaseOrder";
import {
  SupplierInteractionDocuments,
  SupplierInteractionNotes,
} from "~/modules/purchasing/ui/SupplierInteraction";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [purchaseOrder, purchaseOrderDelivery, purchaseOrderPayment] =
    await Promise.all([
      getPurchaseOrder(client, orderId),
      getPurchaseOrderDelivery(client, orderId),
      getPurchaseOrderPayment(client, orderId),
    ]);

  if (purchaseOrderDelivery.error) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error(
          purchaseOrderDelivery.error,
          "Failed to load purchase order delivery"
        )
      )
    );
  }

  if (purchaseOrderPayment.error) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error(
          purchaseOrderPayment.error,
          "Failed to load purchase order payment"
        )
      )
    );
  }

  return json({
    purchaseOrderDelivery: purchaseOrderDelivery.data,
    purchaseOrderPayment: purchaseOrderPayment.data,
    internalNotes: (purchaseOrder.data?.internalNotes ?? {}) as JSONContent,
    externalNotes: (purchaseOrder.data?.externalNotes ?? {}) as JSONContent,
  });
}

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
  const {
    purchaseOrderDelivery,
    purchaseOrderPayment,
    internalNotes,
    externalNotes,
  } = useLoaderData<typeof loader>();

  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const orderData = useRouteData<{
    purchaseOrder: PurchaseOrder;
    lines: PurchaseOrderLine[];
    files: Promise<FileObject[]>;
  }>(path.to.purchaseOrder(orderId));
  if (!orderData) throw new Error("Could not find order data");

  const initialValues = {
    id: orderData?.purchaseOrder?.id ?? "",
    purchaseOrderId: orderData?.purchaseOrder?.purchaseOrderId ?? "",
    supplierId: orderData?.purchaseOrder?.supplierId ?? "",
    supplierContactId: orderData?.purchaseOrder?.supplierContactId ?? "",
    supplierLocationId: orderData?.purchaseOrder?.supplierLocationId ?? "",
    supplierReference: orderData?.purchaseOrder?.supplierReference ?? "",
    orderDate: orderData?.purchaseOrder?.orderDate ?? "",
    type: "Purchase",
    status: orderData?.purchaseOrder?.status ?? ("Draft" as "Draft"),
    receiptRequestedDate: orderData?.purchaseOrder?.receiptRequestedDate ?? "",
    receiptPromisedDate: orderData?.purchaseOrder?.receiptPromisedDate ?? "",
    currencyCode: orderData?.purchaseOrder?.currencyCode ?? "",
    ...getCustomFields(orderData?.purchaseOrder?.customFields),
  };

  const deliveryInitialValues = {
    id: purchaseOrderDelivery.id,
    locationId: purchaseOrderDelivery.locationId ?? "",
    shippingMethodId: purchaseOrderDelivery.shippingMethodId ?? "",
    shippingTermId: purchaseOrderDelivery.shippingTermId ?? "",
    trackingNumber: purchaseOrderDelivery.trackingNumber ?? "",
    receiptRequestedDate: purchaseOrderDelivery.receiptRequestedDate ?? "",
    receiptPromisedDate: purchaseOrderDelivery.receiptPromisedDate ?? "",
    deliveryDate: purchaseOrderDelivery.deliveryDate ?? "",
    notes: purchaseOrderDelivery.notes ?? "",
    dropShipment: purchaseOrderDelivery.dropShipment ?? false,
    customerId: purchaseOrderDelivery.customerId ?? "",
    customerLocationId: purchaseOrderDelivery.customerLocationId ?? "",
    ...getCustomFields(purchaseOrderDelivery.customFields),
  };
  const paymentInitialValues = {
    id: purchaseOrderPayment.id,
    invoiceSupplierId: purchaseOrderPayment.invoiceSupplierId ?? "",
    invoiceSupplierLocationId:
      purchaseOrderPayment.invoiceSupplierLocationId ?? undefined,
    invoiceSupplierContactId:
      purchaseOrderPayment.invoiceSupplierContactId ?? undefined,
    paymentTermId: purchaseOrderPayment.paymentTermId ?? undefined,
    paymentComplete: purchaseOrderPayment.paymentComplete ?? undefined,
    ...getCustomFields(purchaseOrderPayment.customFields),
  };

  return (
    <>
      <PurchaseOrderSummary />
      <SupplierInteractionNotes
        key={`notes-${initialValues.id}`}
        id={orderData.purchaseOrder.id}
        title="Notes"
        table="purchaseOrder"
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
            <SupplierInteractionDocuments
              attachments={resolvedFiles}
              id={orderId}
              interactionId={orderData.purchaseOrder.supplierInteractionId!}
              type="Purchase Order"
            />
          )}
        </Await>
      </Suspense>
      <PurchaseOrderDeliveryForm
        key={`delivery-${orderId}`}
        initialValues={deliveryInitialValues}
      />

      <PurchaseOrderPaymentForm
        key={`payment-${orderId}`}
        initialValues={paymentInitialValues}
      />
    </>
  );
}
