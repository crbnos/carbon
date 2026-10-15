// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { setSalesRfqStatus } from "~/modules/sales/sales.server";
import { path } from "~/utils/path";

const statusForm = setSalesRfqStatus.input.omit({ id: true });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(statusForm).request(args, {
    params: ["rfqId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.sales.rfq.setStatus({
    ...input.data,
    id: input.params.rfqId
  });
  return redirectWithResult(args.request, result, {
    to: path.to.salesRfq(input.params.rfqId),
    message: "Updated RFQ status"
  });
}
