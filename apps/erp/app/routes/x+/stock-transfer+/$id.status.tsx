// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { stockTransferStatusType } from "~/modules/inventory";
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
  const result = await api.inventory.stockTransfer.setStatus({
    id,
    ...input.data
  });
  // An error is toasted by the fetcher that sent it.
  if (!result.data) return result;
  // A blocking rule: the violation modal reads these.
  if ("violations" in result.data) return result.data;
  return redirectWithResult(args.request, result, {
    to: requestReferrer(args.request) ?? path.to.stockTransfer(id),
    message: "Updated stock transfer status"
  });
}
