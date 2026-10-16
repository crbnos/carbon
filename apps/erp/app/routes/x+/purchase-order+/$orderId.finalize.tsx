// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { carbon, respond } from "~/modules/carbon.server";
import { purchaseOrderFinalizeValidator } from "~/modules/purchasing";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseOrderFinalizeValidator).request(args, {
    params: ["orderId"]
  });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;
  const api = await carbon(args.request);
  const result = await api.purchasing.purchaseOrder.finalize({
    ...input.data,
    purchaseOrderId: orderId,
    locale: getPreferenceHeaders(args.request).locale
  });
  return respond(args.request, result)
    .onError(path.to.purchaseOrder(orderId))
    .redirect(
      requestReferrer(args.request) ?? path.to.purchaseOrder(orderId),
      result.data?.needsApproval
        ? "Purchase order submitted for approval"
        : "Purchase order finalized"
    );
}
