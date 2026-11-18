// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { invoiceLineAccountValidator } from "~/modules/invoicing/invoicing.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(invoiceLineAccountValidator).request(args, {
    params: ["invoiceId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;

  const api = await carbon(args.request);
  return api.invoicing.changePurchaseInvoiceLineAccount({
    invoiceId: input.params.invoiceId,
    lineId: input.params.lineId,
    accountId: input.data.accountId
  });
}
