// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { stockTransferStatusType } from "~/modules/inventory/inventory.models";
import { path, requestReferrer } from "~/utils/path";

const statusForm = z.object({
  status: z.enum(stockTransferStatusType),
  acknowledged: zfd.checkbox({ trueValue: "true" })
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(statusForm).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.setStockTransferStatus({
    id,
    ...input.data
  });
  // An error is toasted by the fetcher that sent it.
  if (!result.data) return result;
  // A blocking rule: the violation modal reads these.
  if ("violations" in result.data) return result.data;
  return respond(args.request, result).redirect(
    requestReferrer(args.request) ?? path.to.stockTransfer(id),
    { message: "Updated stock transfer status" }
  );
}
