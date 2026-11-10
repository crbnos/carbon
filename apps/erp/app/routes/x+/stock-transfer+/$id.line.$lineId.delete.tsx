// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id", "lineId"] });
  if ("invalid" in input) return input.invalid;
  const { id, lineId } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.deleteStockTransferLine({
    stockTransferLineId: lineId
  });
  // An error is toasted where the delete was confirmed.
  if (result.error) return result;
  return respond(args.request, result).redirect(path.to.stockTransfer(id), {
    message: "Successfully deleted line"
  });
}
