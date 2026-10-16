// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, respond } from "~/modules/carbon.server";
import { purchaseReturnOrderLineValidator } from "~/modules/purchasing";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseReturnOrderLineValidator).request(
    args,
    { params: ["id"] }
  );
  if ("invalid" in input) return input.invalid;
  const { id: orderId } = input.params;
  const { id: _id, ...line } = input.data;
  const api = await carbon(args.request);
  // Written to the URL's order, never the form's copy of the id.
  const result = await api.purchasing.purchaseReturnOrder.addLine({
    ...line,
    purchaseReturnOrderId: orderId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(
    result.data
      ? path.to.purchaseReturnOrderLine(orderId, result.data.id)
      : path.to.purchaseReturnOrderDetails(orderId),
    "Return order line added"
  );
}
