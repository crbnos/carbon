// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { salesRuleAcknowledgementValidator } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesRuleAcknowledgementValidator).request(
    args,
    {
      params: ["rfqId"]
    }
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.sales.rfq.convert({
    id: input.params.rfqId,
    acknowledged: input.data.acknowledged
  });
  // The violation modal reads `violations` off the response.
  if (result.data && "violations" in result.data) return result.data;
  return redirectWithResult(args.request, result, {
    to: result.data
      ? path.to.quoteDetails(result.data.quoteId)
      : path.to.salesRfq(input.params.rfqId),
    message: "Successfully converted RFQ to quote"
  });
}
