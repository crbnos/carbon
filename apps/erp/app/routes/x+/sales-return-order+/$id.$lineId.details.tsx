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

  if (line.data.salesReturnOrderId !== orderId) {
    throw redirect(
      path.to.salesReturnOrderDetails(orderId),
      await flash(
        request,
        error(null, "This line does not belong to this return order")
      )
    );
  }

  // Resolve readable ids for the linked source documents — one embedded
  // select per link, run in parallel.
  let shipmentReadableId: string | null = null;
  let salesOrderReadableId: string | null = null;
  let salesInvoiceReadableId: string | null = null;
  const readableIdLookups: PromiseLike<void>[] = [];
  if (line.data.shipmentLineId) {
    readableIdLookups.push(
      client
        .from("shipmentLine")
        .select("shipment(shipmentId)")
        .eq("id", line.data.shipmentLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then((result) => {
          shipmentReadableId = result.data?.shipment?.shipmentId ?? null;
        })
    );
  }
  if (line.data.salesOrderLineId) {
    readableIdLookups.push(
      client
        .from("salesOrderLine")
        .select("salesOrder(salesOrderId)")
        .eq("id", line.data.salesOrderLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then((result) => {
          salesOrderReadableId = result.data?.salesOrder?.salesOrderId ?? null;
        })
    );
  }
  if (line.data.salesInvoiceLineId) {
    readableIdLookups.push(
      client
        .from("salesInvoiceLine")
        .select("salesInvoice(invoiceId)")
        .eq("id", line.data.salesInvoiceLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then((result) => {
          salesInvoiceReadableId = result.data?.salesInvoice?.invoiceId ?? null;
        })
    );
  }
  await Promise.all(readableIdLookups);

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

  // The lock guard above checked the URL's order — verify the line actually
  // belongs to it, and never re-parent it to the form's copy of the id.
  const existingLine = await client
    .from("salesReturnOrderLine")
    .select("salesReturnOrderId, quantity")
    .eq("id", lineId)
    .eq("companyId", companyId)
    .single();
  if (existingLine.error || existingLine.data.salesReturnOrderId !== orderId) {
    throw redirect(
      path.to.salesReturnOrderLine(orderId, lineId),
      await flash(
        request,
        error(null, "This line does not belong to this return order")
      )
    );
  }
  d.salesReturnOrderId = orderId;

  // Quantities are validated against source-line caps at Confirm; once the
  // order is confirmed a quantity edit would bypass that validation.
  if (
    salesReturnOrder.data?.status !== "Draft" &&
    Number(d.quantity) !== Number(existingLine.data.quantity)
  ) {
    throw redirect(
      path.to.salesReturnOrderLine(orderId, lineId),
      await flash(
        request,
        error(null, "Quantities are locked after confirmation")
      )
    );
  }

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
