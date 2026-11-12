// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { customerPortalLineUpdateValidator } from "~/modules/sales/sales.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(customerPortalLineUpdateValidator).request(
    args,
    {
      params: ["orderId", "lineId"]
    }
  );
  if ("invalid" in input) return input.invalid;

  const api = await carbon(args.request);
  const result = await api.sales.updateSalesOrderLinePortalMessage({
    ...input.data,
    id: input.params.lineId,
    salesOrderId: input.params.orderId
  });
  if (!result.data) {
    return data(
      { success: false, message: "Could not save the portal update." },
      { status: 400 }
    );
  }
  return data({ success: true, message: "Portal update saved." });
}
