// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { salesOrderStatusType } from "~/modules/sales/sales.models";
import { path, requestReferrer } from "~/utils/path";

// The cancel modal sends `cancelJobIds` as a comma-separated string. The
// field's presence (even empty) means the user chose which jobs; its absence
// means cancel them all.
const statusChange = z.object({
  status: z.enum(salesOrderStatusType),
  cancelJobIds: z.string().optional()
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(statusChange).request(args, {
    params: ["orderId"]
  });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;
  const { status, cancelJobIds } = input.data;

  const api = await carbon(args.request);
  const result = await api.sales.setSalesOrderStatus({
    salesOrderId: orderId,
    status,
    cancelJobIds:
      cancelJobIds === undefined
        ? undefined
        : cancelJobIds
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
  });
  return respond(args.request, result).redirect(
    requestReferrer(args.request) ?? path.to.salesOrderDetails(orderId),
    { message: result.data?.message }
  );
}
