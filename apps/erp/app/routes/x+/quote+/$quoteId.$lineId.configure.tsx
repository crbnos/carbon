// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { configureQuoteLine } from "~/modules/sales/sales.server";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  // The configuration is the JSON body itself.
  const input = await validator(
    configureQuoteLine.input.shape.configuration
  ).request(args, { params: ["quoteId", "lineId"] });
  if ("invalid" in input) return input.invalid;
  const { quoteId, lineId } = input.params;
  const api = await carbon(args.request);
  const result = await api.sales.configureQuoteLine({
    quoteId,
    lineId,
    configuration: input.data
  });
  return respond(args.request, result).redirect(
    requestReferrer(args.request) ?? path.to.quoteLine(quoteId, lineId),
    { message: "Updated quote line" }
  );
}
