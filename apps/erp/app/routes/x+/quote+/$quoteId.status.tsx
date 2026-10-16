// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { quoteStatusType } from "~/modules/sales/sales.models";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(
    z.object({ status: z.enum(quoteStatusType) })
  ).request(args, { params: ["quoteId"] });
  if ("invalid" in input) return input.invalid;
  const { quoteId } = input.params;

  const api = await carbon(args.request);
  const result = await api.sales.quote.setStatus({
    quoteId,
    status: input.data.status
  });
  return redirectWithResult(args.request, result, {
    to: requestReferrer(args.request) ?? path.to.quote(quoteId),
    message: "Updated quote status"
  });
}
