// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["orderId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { orderId, lineId } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.shipSalesOrderLine({
    salesOrderLineId: lineId
  });
  if (!result.data) {
    return respond(args.request, result).redirect(
      path.to.salesOrderLine(orderId, lineId),
      { message: "" }
    );
  }
  throw redirect(path.to.shipmentDetails(result.data.shipmentId));
}
