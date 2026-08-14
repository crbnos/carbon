import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  getPurchaseReturnOrder,
  getPurchaseReturnOrderLine,
  getPurchaseReturnOrderLineTrackedEntities,
  getReturnableEntitiesForSupplier,
  isPurchaseReturnOrderLocked,
  purchaseReturnOrderLineValidator,
  setPurchaseReturnOrderLineTrackedEntities,
  upsertPurchaseReturnOrderLine
} from "~/modules/purchasing";
import { PurchaseReturnOrderLineForm } from "~/modules/purchasing/ui/PurchaseReturnOrders";
import type { PurchaseReturnOrderLine } from "~/modules/purchasing/ui/PurchaseReturnOrders/types";
// returnReason is shared reference data; its list read lives in the sales module
import { getReturnReasonsList } from "~/modules/sales";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { id: orderId, lineId } = params;
  if (!orderId) throw notFound("orderId not found");
  if (!lineId) throw notFound("lineId not found");

  const [purchaseReturnOrder, line, returnReasons] = await Promise.all([
    getPurchaseReturnOrder(client, orderId),
    getPurchaseReturnOrderLine(client, lineId),
    getReturnReasonsList(client, companyId)
  ]);

  if (line.error) {
    throw redirect(
      path.to.purchaseReturnOrderDetails(orderId),
      await flash(
        request,
        error(line.error, "Failed to load return order line")
      )
    );
  }

  const [trackedEntities, returnableEntities] = await Promise.all([
    getPurchaseReturnOrderLineTrackedEntities(client, [lineId]),
    purchaseReturnOrder.data?.supplierId
      ? getReturnableEntitiesForSupplier(
          client,
          companyId,
          purchaseReturnOrder.data.supplierId,
          line.data.itemId
        )
      : Promise.resolve({ data: [], error: null })
  ]);

  // Resolve readable ids for the linked source documents (single-row lookups)
  let receiptReadableId: string | null = null;
  let purchaseOrderReadableId: string | null = null;
  let purchaseInvoiceReadableId: string | null = null;

  if (line.data.receiptLineId) {
    const receiptLine = await client
      .from("receiptLine")
      .select("receiptId")
      .eq("id", line.data.receiptLineId)
      .maybeSingle();
    if (receiptLine.data?.receiptId) {
      const receipt = await client
        .from("receipt")
        .select("receiptId")
        .eq("id", receiptLine.data.receiptId)
        .maybeSingle();
      receiptReadableId = receipt.data?.receiptId ?? null;
    }
  }

  if (line.data.purchaseOrderLineId) {
    const purchaseOrderLine = await client
      .from("purchaseOrderLine")
      .select("purchaseOrderId")
      .eq("id", line.data.purchaseOrderLineId)
      .maybeSingle();
    if (purchaseOrderLine.data?.purchaseOrderId) {
      const purchaseOrder = await client
        .from("purchaseOrder")
        .select("purchaseOrderId")
        .eq("id", purchaseOrderLine.data.purchaseOrderId)
        .maybeSingle();
      purchaseOrderReadableId = purchaseOrder.data?.purchaseOrderId ?? null;
    }
  }

  if (line.data.purchaseInvoiceLineId) {
    const purchaseInvoiceLine = await client
      .from("purchaseInvoiceLine")
      .select("invoiceId")
      .eq("id", line.data.purchaseInvoiceLineId)
      .maybeSingle();
    if (purchaseInvoiceLine.data?.invoiceId) {
      const purchaseInvoice = await client
        .from("purchaseInvoice")
        .select("invoiceId")
        .eq("id", purchaseInvoiceLine.data.invoiceId)
        .maybeSingle();
      purchaseInvoiceReadableId = purchaseInvoice.data?.invoiceId ?? null;
    }
  }

  return {
    line: line.data,
    returnReasons: returnReasons.data ?? [],
    trackedEntityIds: (trackedEntities.data ?? []).map(
      (entity) => entity.trackedEntityId
    ),
    returnableEntities: returnableEntities.data ?? [],
    linkage: {
      receiptReadableId,
      purchaseOrderReadableId,
      purchaseInvoiceReadableId
    }
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { id: orderId, lineId } = params;
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });

  const purchaseReturnOrder = await getPurchaseReturnOrder(viewClient, orderId);
  await requireUnlocked({
    request,
    isLocked: isPurchaseReturnOrderLocked(purchaseReturnOrder.data?.status),
    redirectTo: path.to.purchaseReturnOrderLine(orderId, lineId),
    message: "Cannot modify a completed or cancelled return order."
  });

  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(purchaseReturnOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, trackedEntityIds, ...d } = validation.data;

  const updateLine = await upsertPurchaseReturnOrderLine(client, {
    ...d,
    id: lineId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateLine.error) {
    throw redirect(
      path.to.purchaseReturnOrderLine(orderId, lineId),
      await flash(
        request,
        error(updateLine.error, "Failed to update return order line")
      )
    );
  }

  const setEntities = await setPurchaseReturnOrderLineTrackedEntities(
    client,
    lineId,
    companyId,
    trackedEntityIds ?? [],
    userId
  );
  if (setEntities.error) {
    throw redirect(
      path.to.purchaseReturnOrderLine(orderId, lineId),
      await flash(
        request,
        error(setEntities.error, "Failed to set tracked entities")
      )
    );
  }

  throw redirect(path.to.purchaseReturnOrderLine(orderId, lineId));
}

export default function PurchaseReturnOrderLineDetailsRoute() {
  const { line, returnReasons, trackedEntityIds, returnableEntities, linkage } =
    useLoaderData<typeof loader>();
  const { id: orderId, lineId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  const routeData = useRouteData<{
    lines: PurchaseReturnOrderLine[];
  }>(path.to.purchaseReturnOrder(orderId));

  // The layout loader's lines carry the item embed (readable id, tracking type)
  const fullLine = routeData?.lines?.find((l) => l.id === lineId);

  const initialValues = {
    id: line.id,
    purchaseReturnOrderId: line.purchaseReturnOrderId,
    itemId: line.itemId ?? "",
    quantity: line.quantity ?? 1,
    unitOfMeasureCode: line.unitOfMeasureCode ?? "",
    unitPrice: line.unitPrice ?? 0,
    restockFeePercent: line.restockFeePercent ?? 0,
    returnReasonId: line.returnReasonId ?? undefined,
    purchaseOrderLineId: line.purchaseOrderLineId ?? undefined,
    receiptLineId: line.receiptLineId ?? undefined,
    purchaseInvoiceLineId: line.purchaseInvoiceLineId ?? undefined,
    trackedEntityIds,
    ...getCustomFields(line.customFields)
  };

  return (
    <PurchaseReturnOrderLineForm
      key={lineId}
      initialValues={initialValues}
      line={fullLine}
      returnReasons={returnReasons}
      returnableEntities={returnableEntities}
      linkage={linkage}
    />
  );
}
