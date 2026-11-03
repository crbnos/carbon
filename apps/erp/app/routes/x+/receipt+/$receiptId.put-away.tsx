// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

// Put Away: one stock transfer for the receipt's passed, inspected stock.
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["receiptId"] });
  if ("invalid" in input) return input.invalid;
  const { receiptId } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.createReceiptPutAway({ receiptId });
  return respond(args.request, result).redirect(
    result.data
      ? path.to.stockTransfer(result.data.id)
      : path.to.receipt(receiptId),
    { message: "Putaway created", onError: path.to.receipt(receiptId) }
  );
}
