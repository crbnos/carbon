// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["invoiceId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.invoicing.voidSalesInvoice({
    invoiceId: input.params.invoiceId
  });
}
