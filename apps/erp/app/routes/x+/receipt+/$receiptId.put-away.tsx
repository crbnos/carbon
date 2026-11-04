// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["receiptId"] });
  if ("invalid" in input) return input.invalid;
  const { receiptId } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.createReceiptPutAway({ receiptId });
  // The button cannot acknowledge a storage rule: name the rules and stay on
  // the receipt. A stock transfer made by hand can acknowledge a warning.
  if (result.data && "violations" in result.data) {
    const rules = [...new Set(Object.values(result.data.ruleNames))];
    return respond(args.request, {
      error: {
        message:
          rules.length > 0
            ? `Storage rules stop this putaway: ${rules.join(", ")}`
            : "Storage rules stop this putaway"
      }
    }).redirect(path.to.receipt(receiptId));
  }
  return respond(args.request, result).redirect(
    result.data
      ? path.to.stockTransfer(result.data.id)
      : path.to.receipt(receiptId),
    { message: "Putaway created", onError: path.to.receipt(receiptId) }
  );
}
