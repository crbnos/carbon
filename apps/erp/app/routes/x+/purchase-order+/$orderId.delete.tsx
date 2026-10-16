// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["orderId"] });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;
  const api = await carbon(args.request);
  const result = await api.purchasing.deletePurchaseOrders({
    purchaseOrderIds: [orderId]
  });
  // A refusal stays on the order; a deleted (or missing) one goes to the list.
  return respond(args.request, result).redirect(
    result.error && result.error.category !== "notFound"
      ? path.to.purchaseOrder(orderId)
      : path.to.purchaseOrders,
    { message: "Purchase order deleted" }
  );
}
