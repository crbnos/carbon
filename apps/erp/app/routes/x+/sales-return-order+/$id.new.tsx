// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { salesReturnOrderLineValidator } from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesReturnOrderLineValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const orderId = input.params.id;
  const api = await carbon(args.request);
  const result = await api.sales.returnOrder.line.create({
    ...input.data,
    // The URL order, not the form's copy.
    salesReturnOrderId: orderId,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  if (!result.data) {
    return redirectWithResult(args.request, result, {
      to: path.to.salesReturnOrderDetails(orderId),
      message: ""
    });
  }
  throw redirect(
    path.to.salesReturnOrderLine(orderId, result.data.salesReturnOrderLineId)
  );
}
