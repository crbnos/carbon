// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, respond } from "~/modules/carbon.server";
import { supplierQuoteFinalizeValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(supplierQuoteFinalizeValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.purchasing.supplierQuote.send({
    ...input.data,
    supplierQuoteId: id
  });
  return respond(args.request, result).redirect(path.to.supplierQuote(id), {
    message: "Supplier quote sent successfully"
  });
}
