// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure: the purchasing order drawer's open PO lines as the item planning
// chart draws them. No JSX, no lingui — unit-tested by
// apps/erp/test/open-orders-chart.test.ts.

import { chartedOrderQuantity } from "~/modules/production/ui/Planning/planning-increase";
import { actionForOrder } from "~/modules/production/ui/Planning/planning-review";
import type { PlannedOrder } from "../../purchasing.models";

/** An existing PO line in the planned-order shape the chart reads, plus the
 *  factor between its purchase units and inventory units, and the quantity it
 *  was read at (so the chart can tell a planner's edit from the stored line). */
export type OpenPurchaseOrder = PlannedOrder & {
  existingLineId: string;
  conversionFactor: number;
  /** Purchase units already received, on a line whose quantity is the ordered
   *  total (an editable one); 0 on a sent line, which shows what is to come. */
  receivedOffset: number;
  loadedQuantity: number;
};

/** A planning action as far as the chart reads it: an open Increase on a PO
 *  line is charted on that line. */
export type ChartedLineAction = {
  type: string;
  status: string;
  periodId: string;
  suggestedQuantity: number | string;
  purchaseOrderLineId: string | null;
};

/**
 * The open orders the chart overlays as planned supply, so an edit to one
 * shows before MRP runs again — each at its open Increase, which took the
 * place of a draft order. The chart reads existing orders in inventory units
 * (see `mergePlannedOrders`), and only what is still to come: the received
 * units of a line showing its ordered total are already on hand.
 */
export function openOrdersForChart(
  openOrders: OpenPurchaseOrder[],
  actions: ChartedLineAction[]
): PlannedOrder[] {
  return openOrders.map(
    ({ conversionFactor, loadedQuantity, receivedOffset, ...order }) => ({
      ...order,
      quantity: chartedOrderQuantity({
        quantity:
          Math.max(order.quantity - receivedOffset, 0) * conversionFactor,
        loadedQuantity:
          Math.max(loadedQuantity - receivedOffset, 0) * conversionFactor,
        increase: actionForOrder(
          actions,
          (a) =>
            a.type === "Increase" &&
            a.purchaseOrderLineId === order.existingLineId
        )
      })
    })
  );
}
