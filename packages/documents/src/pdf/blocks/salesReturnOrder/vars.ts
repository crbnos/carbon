// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MergeToken } from "../../../template";
import { returnOrderVars } from "../returnOrder/vars";
import { str } from "../textVars";
import type { SalesReturnOrderData } from "./types";

/**
 * Merge-field variable map for a Sales Return Order (RMA). Tokens mirror
 * `SALES_RETURN_ORDER_MERGE_FIELDS` in template/mergeFields.ts.
 */
export function buildSalesReturnOrderVars(
  data: Pick<
    SalesReturnOrderData,
    | "salesReturnOrder"
    | "salesReturnOrderLines"
    | "customerAddress"
    | "returnToAddress"
    | "company"
    | "currencyCode"
    | "locale"
    | "numberFormatter"
  >
): Record<MergeToken<"salesReturnOrder">, string> {
  const order = data.salesReturnOrder;
  return {
    ...returnOrderVars({
      ...data,
      number: order?.salesReturnOrderId,
      orderDate: order?.orderDate,
      expirationDate: order?.expirationDate,
      lines: data.salesReturnOrderLines,
      party: { prefix: "customer", address: data.customerAddress },
      other: { prefix: "returnTo", address: data.returnToAddress }
    }),
    "order.customerReference": str(order?.customerReference)
  };
}
