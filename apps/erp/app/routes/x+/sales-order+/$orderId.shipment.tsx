// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { salesOrderShipmentValidator } from "~/modules/sales/sales.models";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesOrderShipmentValidator).request(args, {
    params: ["orderId"]
  });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;

  const { api } = await authorize(args.request, {
    "sales.salesOrders": "Edit"
  });
  const result = await api.sales.updateSalesOrderShipping({
    salesOrderId: orderId,
    shipping: input.data,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  return respond(args.request, result).redirect(
    path.to.salesOrderDetails(orderId),
    { message: "Updated sales order shipment" }
  );
}
