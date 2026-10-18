// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { FileObject } from "@supabase/storage-js";
import { useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { useRouteData, useUser } from "~/hooks";
import { purchaseOrderValidator } from "~/modules/purchasing/purchasing.models";
import {
  getPurchaseOrder,
  getPurchaseOrderPayment
} from "~/modules/purchasing/purchasing.service";
import type {
  PurchaseOrder,
  PurchaseOrderDelivery,
  PurchaseOrderLine,
  SupplierInteraction
} from "~/modules/purchasing/types";
import {
  PurchaseOrderDeliveryForm,
  PurchaseOrderPaymentForm,
  PurchaseOrderSummary
} from "~/modules/purchasing/ui/PurchaseOrder";
import type { PurchaseOrderDeliveryFormRef } from "~/modules/purchasing/ui/PurchaseOrder/PurchaseOrderDeliveryForm";
import {
  SupplierInteractionDocuments,
  SupplierInteractionNotes
} from "~/modules/purchasing/ui/SupplierInteraction";
import SupplierInteractionState from "~/modules/purchasing/ui/SupplierInteraction/SupplierInteractionState";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [purchaseOrder, purchaseOrderPayment] = await Promise.all([
    getPurchaseOrder(client, orderId),
    getPurchaseOrderPayment(client, orderId)
  ]);

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

  return {
    purchaseOrderPayment: purchaseOrderPayment.data,
    internalNotes: (purchaseOrder.data?.internalNotes ?? {}) as JSONContent,
    externalNotes: (purchaseOrder.data?.externalNotes ?? {}) as JSONContent
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseOrderValidator).request(args, {
    params: ["orderId"]
  });
  if ("invalid" in input) return input.invalid;
  const { data, params } = input;
  const api = await carbon(args.request);
  const result = await api.purchasing.updatePurchaseOrder({
    id: params.orderId,
    supplierId: data.supplierId,
    currencyCode: data.currencyCode,
    orderDate: data.orderDate,
    supplierContactId: data.supplierContactId || null,
    supplierLocationId: data.supplierLocationId || null,
    supplierReference: data.supplierReference,
    purchaseOrderType: data.purchaseOrderType,
    notes: data.notes,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(
    path.to.purchaseOrder(params.orderId),
    { message: "Updated purchase order" }
  );
}

export default function PurchaseOrderBasicRoute() {
  const { purchaseOrderPayment, internalNotes, externalNotes } =
    useLoaderData<typeof loader>();

  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const orderData = useRouteData<{
    purchaseOrder: PurchaseOrder;
    purchaseOrderDelivery: PurchaseOrderDelivery;
    lines: PurchaseOrderLine[];
    files: Promise<FileObject[]>;
    interaction: SupplierInteraction & {
      purchasingRfq?: { id: string; rfqId: string; status: string } | null;
    };
  }>(path.to.purchaseOrder(orderId));
  if (!orderData) throw new Error("Could not find order data");

  const deliveryFormRef = useRef<PurchaseOrderDeliveryFormRef>(null);

  const handleEditShippingCost = () => {
    deliveryFormRef.current?.focusShippingCost();
  };

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
    ...getCustomFields(orderData?.purchaseOrder?.customFields)
  };

  const deliveryInitialValues = {
    id: orderData?.purchaseOrderDelivery.id,
    locationId: orderData?.purchaseOrderDelivery.locationId ?? "",
    supplierShippingCost:
      orderData?.purchaseOrderDelivery.supplierShippingCost ?? 0,
    shippingMethodId: orderData?.purchaseOrderDelivery.shippingMethodId ?? "",
    shippingTermId: orderData?.purchaseOrderDelivery.shippingTermId ?? "",
    trackingNumber: orderData?.purchaseOrderDelivery.trackingNumber ?? "",
    receiptRequestedDate:
      orderData?.purchaseOrderDelivery.receiptRequestedDate ?? "",
    receiptPromisedDate:
      orderData?.purchaseOrderDelivery.receiptPromisedDate ?? "",
    deliveryDate: orderData?.purchaseOrderDelivery.deliveryDate ?? "",
    notes: orderData?.purchaseOrderDelivery.notes ?? "",
    dropShipment: orderData?.purchaseOrderDelivery.dropShipment ?? false,
    customerId: orderData?.purchaseOrderDelivery.customerId ?? "",
    customerLocationId:
      orderData?.purchaseOrderDelivery.customerLocationId ?? "",
    incoterm: orderData?.purchaseOrderDelivery.incoterm ?? undefined,
    incotermLocation: orderData?.purchaseOrderDelivery.incotermLocation ?? "",
    ...getCustomFields(orderData?.purchaseOrderDelivery.customFields)
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
    ...getCustomFields(purchaseOrderPayment.customFields)
  };

  const { company } = useUser();

  return (
    <>
      <SupplierInteractionState interaction={orderData.interaction} />
      <PurchaseOrderSummary onEditShippingCost={handleEditShippingCost} />
      <SupplierInteractionNotes
        key={`notes-${initialValues.id}`}
        id={orderData.purchaseOrder.id}
        title="Notes"
        table="purchaseOrder"
        internalNotes={internalNotes}
        externalNotes={externalNotes}
      />
      <DeferredFiles key={`documents-${orderId}`} resolve={orderData.files}>
        {(resolvedFiles) => (
          <SupplierInteractionDocuments
            attachments={resolvedFiles}
            id={orderId}
            interactionId={orderData.purchaseOrder.supplierInteractionId!}
            type="Purchase Order"
          />
        )}
      </DeferredFiles>
      <PurchaseOrderDeliveryForm
        key={`delivery-${orderId}`}
        ref={deliveryFormRef}
        initialValues={deliveryInitialValues}
        currencyCode={initialValues.currencyCode || company.baseCurrencyCode}
        defaultCollapsed={false}
      />

      <PurchaseOrderPaymentForm
        key={`payment-${orderId}`}
        initialValues={paymentInitialValues}
      />
    </>
  );
}
