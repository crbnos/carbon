// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { purchasingRfqFinalizeValidator } from "~/modules/purchasing/purchasing.models";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchasingRfqFinalizeValidator).request(args, {
    params: ["rfqId"]
  });
  if ("invalid" in input) return input.invalid;
  const { rfqId } = input.params;
  const api = await carbon(args.request);
  const result = await api.purchasing.finalizePurchasingRfqAndNotify({
    ...input.data,
    rfqId
  });
  const sent = result.data?.emailsSent ?? 0;
  return respond(args.request, result).redirect(
    path.to.purchasingRfqDetails(rfqId),
    {
      message: `Created ${result.data?.quotesCreated ?? 0} supplier quote(s)${
        sent > 0 ? ` and sent ${sent} email(s)` : ""
      }`
    }
  );
}
