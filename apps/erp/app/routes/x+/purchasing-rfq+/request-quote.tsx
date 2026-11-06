// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import type { ActionFunctionArgs } from "react-router";
import { requestQuoteValidator } from "~/modules/purchasing/purchasing.models";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  assertIsPost(args.request);
  const parsed = requestQuoteValidator.safeParse(await args.request.json());
  const back = requestReferrer(args.request) ?? path.to.purchasingRfqs;
  if (!parsed.success) {
    return respond(args.request, {
      error: { message: "Choose at least one part and a supplier for each" }
    }).redirect(back);
  }

  const api = await carbon(args.request);
  const result = await api.purchasing.requestQuoteFromItem(parsed.data);
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
