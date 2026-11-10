// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["orderId"] });
  if ("invalid" in input) return input.invalid;
  const { orderId } = input.params;
  const api = await carbon(args.request);
  const result = await api.production.convertSalesOrderLinesToJobs({
    orderId
  });
  return respond(args.request, result).redirect(
    requestReferrer(args.request) ?? path.to.salesOrder(orderId),
    { message: "Jobs created", onError: path.to.salesOrder(orderId) }
  );
}
