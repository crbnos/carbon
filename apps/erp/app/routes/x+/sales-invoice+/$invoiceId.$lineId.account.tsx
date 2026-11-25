// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { invoiceLineAccountValidator } from "~/modules/invoicing/invoicing.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(invoiceLineAccountValidator).request(args, {
    params: ["invoiceId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;

  const { api } = await authorize(args.request);
  return api.invoicing.changeSalesInvoiceLineAccount({
    invoiceId: input.params.invoiceId,
    lineId: input.params.lineId,
    accountId: input.data.accountId
  });
}
