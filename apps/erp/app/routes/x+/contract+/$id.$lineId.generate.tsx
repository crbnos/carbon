// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

/**
 * Generate billable items: the line's items for ledger rows posted up to
 * today that have none yet — work posted before the line existed, or rows
 * the job SQL wrote. A Time & Materials line runs the T&M backfill; a Cost
 * Plus line runs the commercial generator, which a company without
 * `PROJECT_REVENUE` cannot.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["id", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { id, lineId } = input.params;

  const back =
    requestReferrer(args.request) ?? path.to.contractLineBilling(id, lineId);

  const api = await carbon(args.request);
  const result = await api.sales.generateContractBillableItems({
    customerContractId: id,
    customerContractLineId: lineId
  });
  const generated = result.data?.generated ?? 0;
  return respond(args.request, result).redirect(back, {
    message:
      generated === 1
        ? "1 billable item generated"
        : `${generated} billable items generated`
  });
}
