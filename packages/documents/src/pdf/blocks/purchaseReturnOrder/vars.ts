// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MergeToken } from "../../../template";
import { returnOrderVars } from "../returnOrder/vars";
import { str } from "../textVars";
import type { PurchaseReturnOrderData } from "./types";

/**
 * Merge-field variable map for a Purchase Return Order. Tokens mirror
 * `PURCHASE_RETURN_ORDER_MERGE_FIELDS` in template/mergeFields.ts.
 */
export function buildPurchaseReturnOrderVars(
  data: Pick<
    PurchaseReturnOrderData,
    | "purchaseReturnOrder"
    | "purchaseReturnOrderLines"
    | "supplierAddress"
    | "shipFromAddress"
    | "company"
    | "currencyCode"
    | "locale"
    | "numberFormatter"
  >
): Record<MergeToken<"purchaseReturnOrder">, string> {
  const order = data.purchaseReturnOrder;
  return {
    ...returnOrderVars({
      ...data,
      number: order?.purchaseReturnOrderId,
      orderDate: order?.orderDate,
      expirationDate: order?.expirationDate,
      lines: data.purchaseReturnOrderLines,
      party: { prefix: "supplier", address: data.supplierAddress },
      other: { prefix: "shipFrom", address: data.shipFromAddress }
    }),
    "order.supplierReference": str(order?.supplierReference)
  };
}
