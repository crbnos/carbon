// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { purchaseReturnOrderLineValidator } from "~/modules/purchasing/purchasing.models";
import {
  getPurchaseReturnOrder,
  getPurchaseReturnOrderLine,
  getPurchaseReturnOrderLineTrackedEntities,
  getReturnableEntitiesForSupplier
} from "~/modules/purchasing/purchasing.service";
import { PurchaseReturnOrderLineForm } from "~/modules/purchasing/ui/PurchaseReturnOrders";
import type { PurchaseReturnOrderLine } from "~/modules/purchasing/ui/PurchaseReturnOrders/types";
import { getReturnReasonsList } from "~/modules/sales/sales.service";
// returnReason is shared reference data; its list read lives in the sales module
import { getCustomFields, setCustomFields } from "~/utils/form";
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

  // Resolve the linked source documents' ids + readable ids — one embedded
  // select per link, run in parallel. The internal id lets the line header
  // link straight to the source document.
  let receiptId: string | null = null;
  let receiptReadableId: string | null = null;
  let purchaseOrderId: string | null = null;
  let purchaseOrderReadableId: string | null = null;
  let purchaseInvoiceId: string | null = null;
  let purchaseInvoiceReadableId: string | null = null;
  const readableIdLookups: PromiseLike<void>[] = [];
  if (line.data.receiptLineId) {
    readableIdLookups.push(
      client
        .from("receiptLine")
        .select("receipt(id, receiptId)")
        .eq("id", line.data.receiptLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then((result) => {
          receiptId = result.data?.receipt?.id ?? null;
          receiptReadableId = result.data?.receipt?.receiptId ?? null;
        })
    );
  }
  if (line.data.purchaseOrderLineId) {
    readableIdLookups.push(
      client
        .from("purchaseOrderLine")
        .select("purchaseOrder(id, purchaseOrderId)")
        .eq("id", line.data.purchaseOrderLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then((result) => {
          purchaseOrderId = result.data?.purchaseOrder?.id ?? null;
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
            purchaseInvoiceId = invoiceLine.data.invoiceId;
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
      receiptId,
      receiptReadableId,
      purchaseOrderId,
      purchaseOrderReadableId,
      purchaseInvoiceId,
      purchaseInvoiceReadableId
    }
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseReturnOrderLineValidator).request(
    args,
    { params: ["id", "lineId"] }
  );
  if ("invalid" in input) return input.invalid;
  const { id: orderId, lineId } = input.params;
  const { id: _id, ...line } = input.data;
  const api = await carbon(args.request);
  // The line must be on the URL's order, never re-parented to the form's.
  const result = await api.purchasing.updateReturnOrderLine({
    ...line,
    purchaseReturnOrderId: orderId,
    lineId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(
    path.to.purchaseReturnOrderLine(orderId, lineId),
    { message: "Return order line updated" }
  );
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
