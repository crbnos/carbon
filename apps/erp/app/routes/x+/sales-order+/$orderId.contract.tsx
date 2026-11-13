// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { createContractFromSalesOrderValidator } from "~/modules/sales/sales.models";
import { path } from "~/utils/path";

/** Moves an order's Service lines onto a new Draft contract
 *  (`sales.createContractFromSalesOrder` holds the gate and every guard). */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(createContractFromSalesOrderValidator).request(
    args,
    { params: ["orderId"] }
  );
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;

  const { api } = await authorize(args.request);
  const result = await api.sales.createContractFromSalesOrder({
    ...input.data,
    // The order in the URL is the one the user is looking at.
    salesOrderId: orderId
  });

  return respond(args.request, result).redirect(
    result.data
      ? path.to.contractDetails(result.data.id)
      : path.to.salesOrderDetails(orderId),
    { message: "Created contract" }
  );
}
