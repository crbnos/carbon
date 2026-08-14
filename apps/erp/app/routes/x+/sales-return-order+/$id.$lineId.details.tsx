import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  getReturnReasonsList,
  getSalesReturnOrder,
  getSalesReturnOrderLine,
  getSalesReturnOrderLineTrackedEntities,
  getShippedTrackedEntitiesForCustomer,
  isSalesReturnOrderLocked,
  salesReturnOrderLineValidator,
  setSalesReturnOrderLineTrackedEntities,
  upsertSalesReturnOrderLine
} from "~/modules/sales";
import { SalesReturnOrderLineForm } from "~/modules/sales/ui/SalesReturnOrders";
import type { SalesReturnOrderLine } from "~/modules/sales/ui/SalesReturnOrders/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id: orderId, lineId } = params;
  if (!orderId) throw notFound("orderId not found");
  if (!lineId) throw notFound("lineId not found");

  const [salesReturnOrder, line, returnReasons] = await Promise.all([
    getSalesReturnOrder(client, orderId),
    getSalesReturnOrderLine(client, lineId),
    getReturnReasonsList(client, companyId)
  ]);

  if (line.error) {
    throw redirect(
      path.to.salesReturnOrderDetails(orderId),
      await flash(
        request,
        error(line.error, "Failed to load return order line")
      )
    );
  }

  const [trackedEntities, shippedEntities] = await Promise.all([
    getSalesReturnOrderLineTrackedEntities(client, [lineId]),
    salesReturnOrder.data?.customerId
      ? getShippedTrackedEntitiesForCustomer(
          client,
          companyId,
          salesReturnOrder.data.customerId,
          line.data.itemId
        )
      : Promise.resolve({ data: [], error: null })
  ]);

  // Resolve readable ids for the linked source documents (single-row lookups)
  let shipmentReadableId: string | null = null;
  let salesOrderReadableId: string | null = null;
  let salesInvoiceReadableId: string | null = null;

  if (line.data.shipmentLineId) {
    const shipmentLine = await client
      .from("shipmentLine")
      .select("shipmentId")
      .eq("id", line.data.shipmentLineId)
      .maybeSingle();
    if (shipmentLine.data?.shipmentId) {
      const shipment = await client
        .from("shipment")
        .select("shipmentId")
        .eq("id", shipmentLine.data.shipmentId)
        .maybeSingle();
      shipmentReadableId = shipment.data?.shipmentId ?? null;
    }
  }

  if (line.data.salesOrderLineId) {
    const salesOrderLine = await client
      .from("salesOrderLine")
      .select("salesOrderId")
      .eq("id", line.data.salesOrderLineId)
      .maybeSingle();
    if (salesOrderLine.data?.salesOrderId) {
      const salesOrder = await client
        .from("salesOrder")
        .select("salesOrderId")
        .eq("id", salesOrderLine.data.salesOrderId)
        .maybeSingle();
      salesOrderReadableId = salesOrder.data?.salesOrderId ?? null;
    }
  }

  if (line.data.salesInvoiceLineId) {
    const salesInvoiceLine = await client
      .from("salesInvoiceLine")
      .select("invoiceId")
      .eq("id", line.data.salesInvoiceLineId)
      .maybeSingle();
    if (salesInvoiceLine.data?.invoiceId) {
      const salesInvoice = await client
        .from("salesInvoice")
        .select("invoiceId")
        .eq("id", salesInvoiceLine.data.invoiceId)
        .maybeSingle();
      salesInvoiceReadableId = salesInvoice.data?.invoiceId ?? null;
    }
  }

  return {
    line: line.data,
    returnReasons: returnReasons.data ?? [],
    trackedEntityIds: (trackedEntities.data ?? []).map(
      (entity) => entity.trackedEntityId
    ),
    shippedEntities: shippedEntities.data ?? [],
    linkage: {
      shipmentReadableId,
      salesOrderReadableId,
      salesInvoiceReadableId
    }
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id: orderId, lineId } = params;
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });

  const salesReturnOrder = await getSalesReturnOrder(viewClient, orderId);
  await requireUnlocked({
    request,
    isLocked: isSalesReturnOrderLocked(salesReturnOrder.data?.status),
    redirectTo: path.to.salesReturnOrderLine(orderId, lineId),
    message: "Cannot modify a completed or cancelled return order."
  });

  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(salesReturnOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, trackedEntityIds, ...d } = validation.data;

  const updateLine = await upsertSalesReturnOrderLine(client, {
    ...d,
    id: lineId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateLine.error) {
    throw redirect(
      path.to.salesReturnOrderLine(orderId, lineId),
      await flash(
        request,
        error(updateLine.error, "Failed to update return order line")
      )
    );
  }

  const setEntities = await setSalesReturnOrderLineTrackedEntities(
    client,
    lineId,
    companyId,
    trackedEntityIds ?? [],
    userId
  );
  if (setEntities.error) {
    throw redirect(
      path.to.salesReturnOrderLine(orderId, lineId),
      await flash(
        request,
        error(setEntities.error, "Failed to set tracked entities")
      )
    );
  }

  throw redirect(path.to.salesReturnOrderLine(orderId, lineId));
}

export default function SalesReturnOrderLineDetailsRoute() {
  const { line, returnReasons, trackedEntityIds, shippedEntities, linkage } =
    useLoaderData<typeof loader>();
  const { id: orderId, lineId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  const routeData = useRouteData<{
    lines: SalesReturnOrderLine[];
  }>(path.to.salesReturnOrder(orderId));

  // The layout loader's lines carry the item embed (readable id, tracking type)
  const fullLine = routeData?.lines?.find((l) => l.id === lineId);

  const initialValues = {
    id: line.id,
    salesReturnOrderId: line.salesReturnOrderId,
    itemId: line.itemId ?? "",
    quantity: line.quantity ?? 1,
    unitOfMeasureCode: line.unitOfMeasureCode ?? "",
    unitPrice: line.unitPrice ?? 0,
    restockFeePercent: line.restockFeePercent ?? 0,
    returnReasonId: line.returnReasonId ?? undefined,
    salesOrderLineId: line.salesOrderLineId ?? undefined,
    shipmentLineId: line.shipmentLineId ?? undefined,
    salesInvoiceLineId: line.salesInvoiceLineId ?? undefined,
    trackedEntityIds,
    ...getCustomFields(line.customFields)
  };

  return (
    <SalesReturnOrderLineForm
      key={lineId}
      initialValues={initialValues}
      line={fullLine}
      returnReasons={returnReasons}
      shippedEntities={shippedEntities}
      linkage={linkage}
    />
  );
}
