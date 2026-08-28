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

  if (line.data.purchaseReturnOrderId !== orderId) {
    throw redirect(
      path.to.purchaseReturnOrderDetails(orderId),
      await flash(
        request,
        error(null, "This line does not belong to this return order")
      )
    );
  }

  // Resolve readable ids for the linked source documents — one embedded
  // select per link, run in parallel.
  let receiptReadableId: string | null = null;
  let purchaseOrderReadableId: string | null = null;
  let purchaseInvoiceReadableId: string | null = null;
  const readableIdLookups: PromiseLike<void>[] = [];
  if (line.data.receiptLineId) {
    readableIdLookups.push(
      client
        .from("receiptLine")
        .select("receipt(receiptId)")
        .eq("id", line.data.receiptLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then((result) => {
          receiptReadableId = result.data?.receipt?.receiptId ?? null;
        })
    );
  }
  if (line.data.purchaseOrderLineId) {
    readableIdLookups.push(
      client
        .from("purchaseOrderLine")
        .select("purchaseOrder(purchaseOrderId)")
        .eq("id", line.data.purchaseOrderLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then((result) => {
          purchaseOrderReadableId =
            result.data?.purchaseOrder?.purchaseOrderId ?? null;
        })
    );
  }
  if (line.data.purchaseInvoiceLineId) {
    // The purchaseInvoice embed trips TS2589, so this one stays two-step
    readableIdLookups.push(
      client
        .from("purchaseInvoiceLine")
        .select("invoiceId")
        .eq("id", line.data.purchaseInvoiceLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then(async (invoiceLine) => {
          if (invoiceLine.data?.invoiceId) {
            const invoice = await client
              .from("purchaseInvoice")
              .select("invoiceId")
              .eq("id", invoiceLine.data.invoiceId)
              .eq("companyId", companyId)
              .maybeSingle();
            purchaseInvoiceReadableId = invoice.data?.invoiceId ?? null;
          }
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
    // Serial/batch labels for the picked entities — the returnable-entities
    // list only covers currently returnable stock, so a pick that has since
    // shipped (or otherwise changed status) still needs its readable id.
    pickedEntityLabels: Object.fromEntries(
      (trackedEntities.data ?? [])
        .filter((entity) => entity.trackedEntity?.readableId)
        .map((entity) => [
          entity.trackedEntityId,
          entity.trackedEntity!.readableId as string
        ])
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

  // The lock guard above checked the URL's order — verify the line actually
  // belongs to it, and never re-parent it to the form's copy of the id.
  const existingLine = await client
    .from("purchaseReturnOrderLine")
    .select("purchaseReturnOrderId, quantity")
    .eq("id", lineId)
    .eq("companyId", companyId)
    .single();
  if (
    existingLine.error ||
    existingLine.data.purchaseReturnOrderId !== orderId
  ) {
    throw redirect(
      path.to.purchaseReturnOrderLine(orderId, lineId),
      await flash(
        request,
        error(null, "This line does not belong to this return order")
      )
    );
  }
  d.purchaseReturnOrderId = orderId;

  // Quantities are validated against source-line caps at Confirm; once the
  // order is confirmed a quantity edit would bypass that validation.
  if (
    purchaseReturnOrder.data?.status !== "Draft" &&
    Number(d.quantity) !== Number(existingLine.data.quantity)
  ) {
    throw redirect(
      path.to.purchaseReturnOrderLine(orderId, lineId),
      await flash(
        request,
        error(null, "Quantities are locked after confirmation")
      )
    );
  }

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
  const {
    line,
    returnReasons,
    trackedEntityIds,
    pickedEntityLabels,
    returnableEntities,
    linkage
  } = useLoaderData<typeof loader>();
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
      pickedEntityLabels={pickedEntityLabels}
      linkage={linkage}
    />
  );
}
