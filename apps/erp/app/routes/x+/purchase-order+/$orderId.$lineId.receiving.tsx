// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { purchaseOrderLineReceivingValidator } from "~/modules/purchasing/purchasing.models";
import { path } from "~/utils/path";

// Stop/Resume Receiving on one line. The operation holds every rule — the
// order must be released, the line receivable with a remainder — in the
// transaction that writes, so the page, the API and MCP are refused alike.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseOrderLineReceivingValidator).request(
    args,
    { params: ["orderId", "lineId"] }
  );
  if ("invalid" in input) return input.invalid;
  const { orderId, lineId } = input.params;
  const { intent } = input.data;

  const api = await carbon(args.request);
  const result = await api.purchasing.shortClosePurchaseOrderLine({
    purchaseOrderId: orderId,
    lineId,
    intent
  });
  return respond(args.request, result).redirect(
    path.to.purchaseOrderDetails(orderId),
    {
      message:
        intent === "close"
          ? "Stopped receiving for line"
          : "Resumed receiving for line"
    }
  );
}
