// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure, shared by tier 05 and the validator, so a seeded order's status is
// the one its lines give.

import { getPurchaseOrderStatus } from "../../purchase-order-status.ts";
import type { PurchaseOrderSpec } from "../types.ts";

type DirectPurchaseOrderSpec = Extract<PurchaseOrderSpec, { source: "direct" }>;

export type PurchaseOrderLineCounts = {
  quantityReceived: number;
  receivedComplete: boolean;
  quantityInvoiced: number;
  invoicedComplete: boolean;
};

// A voided invoice was posted, then its void took the quantity back off the
// line; a Draft one never reached it.
const isInvoiceOnLines = (status: string) =>
  status !== "Draft" && status !== "Voided";

/**
 * Each line's received and invoiced counts, keyed by item, as post-receipt and
 * post-purchase-invoice leave them: a Posted receipt adds its received
 * quantity, a posted invoice that is not voided adds its quantity, and a line
 * is complete once the count reaches its ordered quantity.
 */
export function purchaseOrderLineCounts(
  po: DirectPurchaseOrderSpec
): Record<string, PurchaseOrderLineCounts> {
  const received = new Map<string, number>();
  if (po.receipt?.status === "Posted") {
    for (const line of po.receipt.lines) {
      received.set(
        line.item,
        (received.get(line.item) ?? 0) + line.receivedQuantity
      );
    }
  }
  const invoiced = new Map<string, number>();
  if (po.invoice && isInvoiceOnLines(po.invoice.status)) {
    for (const line of po.invoice.lines) {
      invoiced.set(line.item, (invoiced.get(line.item) ?? 0) + line.quantity);
    }
  }
  return Object.fromEntries(
    po.lines.map((line) => {
      const quantityReceived = received.get(line.item) ?? 0;
      const quantityInvoiced = invoiced.get(line.item) ?? 0;
      return [
        line.item,
        {
          quantityReceived,
          receivedComplete: quantityReceived >= line.purchaseQuantity,
          quantityInvoiced,
          invoicedComplete: quantityInvoiced >= line.purchaseQuantity
        }
      ];
    })
  );
}

/**
 * The status the app derives from the order's lines (every seeded line is a
 * Part line). A winning-quote order has neither a receipt nor an invoice.
 */
export function derivedPurchaseOrderStatus(
  po: PurchaseOrderSpec
): ReturnType<typeof getPurchaseOrderStatus>["status"] {
  if (po.source !== "direct") return "To Receive and Invoice";
  return getPurchaseOrderStatus(
    Object.values(purchaseOrderLineCounts(po)).map((counts) => ({
      ...counts,
      purchaseOrderLineType: "Part" as const
    }))
  ).status;
}
