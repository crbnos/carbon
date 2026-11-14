// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { path } from "~/utils/path";

const putAwayForm = z.object({
  acknowledged: zfd.checkbox({ trueValue: "true" })
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(putAwayForm).request(args, {
    params: ["receiptId"]
  });
  if ("invalid" in input) return input.invalid;
  const { receiptId } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.createReceiptPutAway({
    receiptId,
    acknowledged: input.data.acknowledged
  });
  if (!result.data) return result;
  if ("violations" in result.data) return result.data;
  return respond(args.request, result).redirect(
    path.to.stockTransfer(result.data.id),
    { message: "Putaway created" }
  );
}
