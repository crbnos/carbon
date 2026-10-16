// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["invoiceId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.invoicing.salesInvoice.delete({
    invoiceId: input.params.invoiceId
  });
  return redirectWithResult(args.request, result, {
    to: path.to.invoicingSales
  });
}
