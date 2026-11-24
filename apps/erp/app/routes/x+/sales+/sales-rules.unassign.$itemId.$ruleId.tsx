// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["itemId", "ruleId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.sales.unassignSalesRule({
    ruleId: input.params.ruleId,
    itemId: input.params.itemId
  });
  const back = requestReferrer(args.request) ?? path.to.salesRules;
  return respond(args.request, result).redirect(back, {
    message: "Rule unassigned",
    onError: back
  });
}
