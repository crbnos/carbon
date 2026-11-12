// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { requestQuoteValidator } from "~/modules/purchasing/purchasing.models";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(requestQuoteValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const back = requestReferrer(args.request) ?? path.to.purchasingRfqs;

  const api = await carbon(args.request);
  const result = await api.purchasing.requestQuoteFromItem(input.data);
  const rfqs = result.data?.rfqs ?? [];
  const first = rfqs[0];

  return respond(args.request, result).redirect(
    rfqs.length === 1 && first
      ? path.to.purchasingRfqDetails(first.id)
      : `${path.to.purchasingRfqs}?filter=id:in:${rfqs.map((r) => r.id).join(",")}`,
    {
      message:
        rfqs.length === 1
          ? "Created draft RFQ"
          : `Created ${rfqs.length} draft RFQs`,
      onError: back
    }
  );
}
