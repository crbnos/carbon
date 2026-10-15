// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { path, requestReferrer } from "~/utils/path";

// The status follows the lines (To Ship, Completed): by hand a return is only
// cancelled, or reopened to Draft.
const form = z.object({ status: z.enum(["Cancelled", "Draft"]) });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const to =
    requestReferrer(args.request) ?? path.to.purchaseReturnOrderDetails(id);
  const api = await carbon(args.request);

  if (input.data.status === "Cancelled") {
    const result = await api.purchasing.purchaseReturnOrder.cancel({
      purchaseReturnOrderId: id
    });
    return redirectWithResult(args.request, result, {
      to,
      message: "Cancelled return order"
    });
  }
  const result = await api.purchasing.purchaseReturnOrder.reopen({
    purchaseReturnOrderId: id
  });
  return redirectWithResult(args.request, result, {
    to,
    message: "Reopened return order"
  });
}
