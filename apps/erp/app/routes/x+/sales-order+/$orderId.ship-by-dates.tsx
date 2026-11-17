// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

/** The ship-by plan: how many open lines a recalculation would move. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");
  const api = await carbon(request);
  return api.sales.getSalesOrderShipByDates({ salesOrderId: orderId });
}

/** The "Recalculate" answer of the prompt. */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["orderId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.sales.recalculateSalesOrderShipByDates({
    salesOrderId: input.params.orderId
  });
}
