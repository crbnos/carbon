// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  purchaseOrderForceDeleteDecisionValidator,
  purchaseOrderForceDeleteRequestValidator
} from "~/modules/purchasing/purchasing.models";
import { path } from "~/utils/path";

/**
 * The Admin force-delete override: ask (`request`), then `approve`, `reject`
 * or `cancel`. The service functions check that the caller is an Admin.
 *
 * The order is redirected to at its details page, never its index: the
 * index redirects again, and that second hop reaches the page the form was
 * on as a same-path GET, which the root loader skips (`rootShouldRevalidate`),
 * so the flash would never toast.
 */
export async function action(args: ActionFunctionArgs) {
  const intent = (await args.request.clone().formData()).get("intent");
  const api = await carbon(args.request);

  if (intent === "request") {
    const input = await validator(
      purchaseOrderForceDeleteRequestValidator
    ).request(args, { params: ["orderId"] });
    if ("invalid" in input) return input.invalid;
    const { orderId } = input.params;
    const result = await api.purchasing.requestPurchaseOrderForceDelete({
      purchaseOrderId: orderId,
      reason: input.data.reason,
      confirmation: input.data.confirmation
    });
    return respond(args.request, result).redirect(
      path.to.purchaseOrderDetails(orderId),
      {
        message: "Force delete requested. Another Admin must approve it."
      }
    );
  }

  const input = await validator(
    purchaseOrderForceDeleteDecisionValidator
  ).request(args, { params: ["orderId"] });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;
  const { requestId, notes } = input.data;

  if (input.data.intent === "cancel") {
    const result = await api.purchasing.cancelPurchaseOrderForceDelete({
      requestId
    });
    return respond(args.request, result).redirect(
      path.to.purchaseOrderDetails(orderId),
      { message: "Force delete request cancelled" }
    );
  }

  const result = await api.purchasing.decidePurchaseOrderForceDelete({
    requestId,
    decision: input.data.intent,
    notes
  });
  const decided = result.data;
  if (decided?.status === "Executed") {
    return respond(args.request, result).redirect(path.to.purchaseOrders, {
      message: `${decided.purchaseOrderReadableId} was force deleted`
    });
  }
  return respond(args.request, result).redirect(
    path.to.purchaseOrderDetails(orderId),
    { message: "Force delete rejected" }
  );
}
