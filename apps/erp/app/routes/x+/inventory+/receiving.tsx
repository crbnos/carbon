// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getDraftReceiptsForPurchaseOrders,
  getOpenPurchaseOrdersForItems,
  getPurchaseOrderLinesToReceive
} from "~/modules/inventory/inventory.service";
import type {
  ReceivingDraftReceipt,
  ReceivingOrder,
  ReceivingRow
} from "~/modules/inventory/types";
import ReceivingTable from "~/modules/inventory/ui/Receiving/ReceivingTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["purchaseOrder", "receipt"],
  breadcrumb: msg`Receiving`,
  to: path.to.receiving
};

const logger = getLogger("erp", "inventory", "receiving");

export async function loader({ request }: LoaderFunctionArgs) {
  // Purchase order lines are only readable with purchasing view, so without
  // it the list would read as "nothing to receive".
  const { client, companyId } = await requirePermissions(request, {
    view: ["inventory", "purchasing"]
  });

  const searchParams = new URL(request.url).searchParams;
  const search = searchParams.get("search");
  const { limit, offset, filters } = getGenericQueryFilters(searchParams);

  const lines = await getPurchaseOrderLinesToReceive(client, companyId, {
    search,
    limit,
    offset,
    filters
  });

  if (lines.error) {
    logger.error("Failed to load purchase order lines to receive", {
      companyId,
      error: lines.error
    });
    throw redirect(
      path.to.inventory,
      await flash(
        request,
        error(lines.error, "Failed to load purchase order lines to receive")
      )
    );
  }

  // The view's keys are never null; the generated view type cannot say so.
  const openLines = (lines.data ?? []).flatMap((line) =>
    line.id && line.purchaseOrderId
      ? [{ ...line, id: line.id, purchaseOrderId: line.purchaseOrderId }]
      : []
  );
  const itemIds = [
    ...new Set(openLines.flatMap((line) => (line.itemId ? [line.itemId] : [])))
  ];
  const purchaseOrderIds = [
    ...new Set(openLines.map((line) => line.purchaseOrderId))
  ];

  const [otherOrders, draftReceipts] = await Promise.all([
    getOpenPurchaseOrdersForItems(client, companyId, itemIds),
    getDraftReceiptsForPurchaseOrders(client, companyId, purchaseOrderIds)
  ]);

  // Both only add context to the list, so a failed read leaves it out.
  if (otherOrders.error) {
    logger.warn("Failed to load other open orders for items", {
      companyId,
      error: otherOrders.error
    });
  }
  if (draftReceipts.error) {
    logger.warn("Failed to load draft receipts for purchase orders", {
      companyId,
      error: draftReceipts.error
    });
  }

  const ordersByItem = new Map<string, Map<string, ReceivingOrder>>();
  for (const order of otherOrders.data ?? []) {
    if (!order.itemId || !order.purchaseOrderId) continue;
    const orders = ordersByItem.get(order.itemId) ?? new Map();
    orders.set(order.purchaseOrderId, {
      id: order.purchaseOrderId,
      readableId: order.purchaseOrderReadableId,
      revisionId: order.revisionId
    });
    ordersByItem.set(order.itemId, orders);
  }

  const rows: ReceivingRow[] = openLines.map((line) => ({
    ...line,
    alsoOpenOn: [...(ordersByItem.get(line.itemId ?? "")?.values() ?? [])]
      .filter((order) => order.id !== line.purchaseOrderId)
      .sort((a, b) => (a.readableId ?? "").localeCompare(b.readableId ?? ""))
  }));

  // The oldest Draft per order: the one its Receive button opens.
  const draftReceiptByOrder: Record<string, ReceivingDraftReceipt> = {};
  for (const receipt of draftReceipts.data ?? []) {
    if (!receipt.sourceDocumentId) continue;
    draftReceiptByOrder[receipt.sourceDocumentId] ??= {
      id: receipt.id,
      receiptId: receipt.receiptId
    };
  }

  return {
    rows,
    count: lines.count ?? 0,
    draftReceiptByOrder
  };
}

export default function ReceivingRoute() {
  const { rows, count, draftReceiptByOrder } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ReceivingTable
        rows={rows}
        count={count}
        draftReceiptByOrder={draftReceiptByOrder}
      />
    </VStack>
  );
}
