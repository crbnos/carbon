// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { itemId, ruleId } = params;
  if (!itemId || !ruleId) throw new Error("itemId and ruleId required");
  const api = await carbon(request);
  const result = await api.sales.unassignSalesRule({ ruleId, itemId });
  const back = requestReferrer(request) ?? path.to.salesRules;
  return respond(request, result).redirect(back, {
    message: "Rule unassigned",
    onError: back
  });
}
