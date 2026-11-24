// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Lives here, not in @carbon/utils (which re-exports it), so the demo
// datasets' validator derives an order's status with the app's own rule.

import type { Database } from "./types.ts";

type PurchaseOrderLine = Pick<
  Database["public"]["Tables"]["purchaseOrderLine"]["Row"],
  "purchaseOrderLineType" | "receivedComplete" | "invoicedComplete"
>;

export const getPurchaseOrderStatus = (
  lines: Array<{
    purchaseOrderLineType: PurchaseOrderLine["purchaseOrderLineType"] | null;
    invoicedComplete: PurchaseOrderLine["invoicedComplete"] | null;
    receivedComplete: PurchaseOrderLine["receivedComplete"] | null;
  }>
) => {
  const allInvoices = lines.every(
    (line) => line.purchaseOrderLineType === "Comment" || line.invoicedComplete
  );

  const allLinesReceived = lines.every(
    (line) =>
      line.purchaseOrderLineType === "Comment" ||
      line.purchaseOrderLineType === "G/L Account" ||
      // Services are never received — they can't block receipt completeness
      line.purchaseOrderLineType === "Service" ||
      line.receivedComplete
  );

  let status: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
    "To Receive and Invoice";
  if (allInvoices && allLinesReceived) {
    status = "Completed";
  } else if (allInvoices) {
    status = "To Receive";
  } else if (allLinesReceived) {
    status = "To Invoice";
  }

  return { status, allInvoices, allLinesReceived };
};
