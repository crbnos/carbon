// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type { JSONContent } from "@tiptap/react";
import { useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { useRouteData } from "~/hooks";
import { salesOrderValidator } from "~/modules/sales/sales.models";
import {
  getSalesOrder,
  getSalesOrderPayment,
  getSalesOrderShipment
} from "~/modules/sales/sales.service";
import type {
  Opportunity,
  SalesOrder,
  SalesOrderLine
} from "~/modules/sales/types";
import {
  OpportunityDocuments,
  OpportunityNotes,
  OpportunityState
} from "~/modules/sales/ui/Opportunity";
import {
  SalesOrderPaymentForm,
  SalesOrderShipmentForm,
  SalesOrderSummary
} from "~/modules/sales/ui/SalesOrder";
import type { SalesOrderShipmentFormRef } from "~/modules/sales/ui/SalesOrder/SalesOrderShipmentForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [order, payment, shipment] = await Promise.all([
    getSalesOrder(client, orderId),
    getSalesOrderPayment(client, orderId),
    getSalesOrderShipment(client, orderId)
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

  return {
    internalNotes: (order.data?.internalNotes ?? {}) as JSONContent,
    externalNotes: (order.data?.externalNotes ?? {}) as JSONContent,
    payment: payment.data || null,
    shipment: shipment.data || null
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesOrderValidator).request(args, {
    params: ["orderId"]
  });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;

  const api = await carbon(args.request);
  const result = await api.sales.updateSalesOrderDetails({
    ...input.data,
    id: orderId,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  return respond(args.request, result).redirect(path.to.salesOrder(orderId), {
    message: "Updated order"
  });
}

export default function SalesOrderDetailsRoute() {
  const { t } = useLingui();
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
    incoterm: shipment?.incoterm ?? undefined,
    incotermLocation: shipment?.incotermLocation ?? "",
    ...getCustomFields(shipment?.customFields)
  };

  const paymentInitialValues = {
    id: payment.id,
    invoiceCustomerId: payment?.invoiceCustomerId ?? "",
    invoiceCustomerLocationId: payment?.invoiceCustomerLocationId ?? "",
    invoiceCustomerContactId: payment?.invoiceCustomerContactId ?? "",
    paymentTermId: payment?.paymentTermId ?? "",
    paymentComplete: payment?.paymentComplete ?? undefined,
    ...getCustomFields(payment?.customFields)
  };

  return (
    <>
      <OpportunityState
        key={`state-${orderId}`}
        opportunity={orderData?.opportunity!}
      />
      <SalesOrderSummary onEditShippingCost={handleEditShippingCost} />

      <OpportunityNotes
        key={`notes-${orderId}`}
        id={orderData.salesOrder.id}
        table="salesOrder"
        title={t`Notes`}
        internalNotes={internalNotes}
        externalNotes={externalNotes}
      />
      <DeferredFiles key={`documents-${orderId}`} resolve={orderData.files}>
        {(resolvedFiles) => (
          <OpportunityDocuments
            opportunity={orderData.opportunity}
            attachments={resolvedFiles}
            id={orderId}
            type="Sales Order"
          />
        )}
      </DeferredFiles>

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
