// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { salesReturnOrderNextStepValidator } from "~/modules/sales/sales.models";
import { path, requestReferrer } from "~/utils/path";

// What happens to a serviced unit after its job: scrap it, replace it at no
// charge (a Return for Warranty line), or bill the job when the warranty is
// denied. Shipping the unit back is the RMA shipment, as for Return to
// Customer.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesReturnOrderNextStepValidator).request(
    args,
    { params: ["id", "lineId"] }
  );
  if ("invalid" in input) return input.invalid;
  const { id, lineId } = input.params;
  const api = await carbon(args.request);
  const back =
    requestReferrer(args.request) ?? path.to.salesReturnOrderLine(id, lineId);
  const target = { salesReturnOrderId: id, lineId };

  switch (input.data.action) {
    case "Scrap": {
      const result = await api.sales.scrapReturnedUnit(target);
      return respond(args.request, result).redirect(back, {
        message: "Unit scrapped"
      });
    }
    case "Replace": {
      const result = await api.sales.replaceReturnedUnit(target);
      return respond(args.request, result).redirect(
        result.data ? path.to.salesOrder(result.data.salesOrderId) : back,
        { message: "Replacement order created" }
      );
    }
    case "Change to Service": {
      const result = await api.sales.changeReturnLineToService(target);
      return respond(args.request, result).redirect(back, {
        message: "Changed to Return for Service"
      });
    }
  }
}
