// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";

// The body is the line as the form holds it, as JSON; the operation validates
// it. Read only: the check writes nothing, so a fetcher can call it on every
// change.
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["orderId"] });
  if ("invalid" in input) return input.invalid;
  const line = await args.request.json();
  const api = await carbon(args.request);
  return data(
    await api.sales.checkSalesOrderLineDeliveryDate({
      ...line,
      salesOrderId: input.params.orderId
    })
  );
}
