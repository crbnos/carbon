// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { purchaseOrderDeliveryValidator } from "~/modules/purchasing/purchasing.models";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseOrderDeliveryValidator).request(args, {
    params: ["orderId"]
  });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;

  const api = await carbon(args.request);
  const result = await api.purchasing.updatePurchaseOrderDelivery({
    ...input.data,
    id: orderId,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });

  return respond(args.request, result).redirect(
    path.to.purchaseOrderDetails(orderId),
    { message: "Updated purchase order delivery" }
  );
}
