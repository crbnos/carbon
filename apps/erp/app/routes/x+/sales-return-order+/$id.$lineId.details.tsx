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
import { salesReturnOrderLineValidator } from "~/modules/sales/sales.models";
import {
  getReturnReasonsList,
  getSalesReturnOrderLine
} from "~/modules/sales/sales.service";
import { SalesReturnOrderLineForm } from "~/modules/sales/ui/SalesReturnOrders";
import type { SalesReturnOrderLine } from "~/modules/sales/ui/SalesReturnOrders/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id: orderId, lineId } = params;
  if (!orderId) throw notFound("orderId not found");
  if (!lineId) throw notFound("lineId not found");

  const [line, returnReasons] = await Promise.all([
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

  if (line.data.salesReturnOrderId !== orderId) {
    throw redirect(
      path.to.salesReturnOrderDetails(orderId),
      await flash(
        request,
        error(null, "This line does not belong to this return order")
      )
    );
  }

  // Resolve internal ids + readable ids for the linked source documents — one
  // embedded select per link, run in parallel. The internal ids drive the
  // navigable back-links on the line form.
  let shipmentId: string | null = null;
  let shipmentReadableId: string | null = null;
  let salesOrderId: string | null = null;
  let salesOrderReadableId: string | null = null;
  let salesInvoiceId: string | null = null;
  let salesInvoiceReadableId: string | null = null;
  const readableIdLookups: PromiseLike<void>[] = [];
  if (line.data.shipmentLineId) {
    readableIdLookups.push(
      client
        .from("shipmentLine")
        .select("shipment(id, shipmentId)")
        .eq("id", line.data.shipmentLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then((result) => {
          shipmentId = result.data?.shipment?.id ?? null;
          shipmentReadableId = result.data?.shipment?.shipmentId ?? null;
        })
    );
  }
  if (line.data.salesOrderLineId) {
    readableIdLookups.push(
      client
        .from("salesOrderLine")
        .select("salesOrder(id, salesOrderId)")
        .eq("id", line.data.salesOrderLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then((result) => {
          salesOrderId = result.data?.salesOrder?.id ?? null;
          salesOrderReadableId = result.data?.salesOrder?.salesOrderId ?? null;
        })
    );
  }
  if (line.data.salesInvoiceLineId) {
    readableIdLookups.push(
      client
        .from("salesInvoiceLine")
        .select("salesInvoice!salesInvoiceLine_invoiceId_fkey(id, invoiceId)")
        .eq("id", line.data.salesInvoiceLineId)
        .eq("companyId", companyId)
        .maybeSingle()
        .then((result) => {
          salesInvoiceId = result.data?.salesInvoice?.id ?? null;
          salesInvoiceReadableId = result.data?.salesInvoice?.invoiceId ?? null;
        })
    );
  }
  await Promise.all(readableIdLookups);

  return {
    line: line.data,
    returnReasons: returnReasons.data ?? [],
    linkage: {
      shipmentId,
      shipmentReadableId,
      salesOrderId,
      salesOrderReadableId,
      salesInvoiceId,
      salesInvoiceReadableId
    }
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesReturnOrderLineValidator).request(args, {
    params: ["id", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { id: orderId, lineId } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.updateReturnOrderLine({
    ...input.data,
    id: lineId,
    // The URL order: a line is never re-parented.
    salesReturnOrderId: orderId,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  const to = path.to.salesReturnOrderLine(orderId, lineId);
  if (!result.data) {
    return respond(args.request, result).redirect(to, { message: "" });
  }
  throw redirect(to);
}

export default function SalesReturnOrderLineDetailsRoute() {
  const { line, returnReasons, linkage } = useLoaderData<typeof loader>();
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
    ...getCustomFields(line.customFields)
  };

  return (
    <SalesReturnOrderLineForm
      key={lineId}
      initialValues={initialValues}
      line={fullLine}
      returnReasons={returnReasons}
      linkage={linkage}
    />
  );
}
