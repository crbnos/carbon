// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { getMethodValidator } from "~/modules/sales/sales.models";
import { path, requestReferrer } from "~/utils/path";

// Get Method: the source and target, the parts to copy, and for a
// configurable item its configuration as JSON.
const getMethodForm = getMethodValidator.safeExtend({
  configuration: zfd.json(z.record(z.string(), z.unknown())).optional()
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(getMethodForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { type, sourceId, targetId, configuration, ...parts } = input.data;
  const api = await carbon(args.request);

  switch (type) {
    case "item": {
      const [quoteId, quoteLineId] = targetId.split(":");
      return api.sales.copyItemMethodToQuoteLine({
        quoteId: quoteId ?? "",
        quoteLineId: quoteLineId ?? "",
        itemId: sourceId,
        parts,
        configuration
      });
    }
    case "quoteLine":
      return api.sales.copyQuoteLineMethod({ sourceId, targetId, parts });
    case "method": {
      const result = await api.sales.copyItemMethodToQuoteMaterial({
        sourceId,
        targetId,
        parts,
        configuration
      });
      if (result.error) return result;
      throw redirect(requestReferrer(args.request) ?? path.to.quotes);
    }
    default:
      return data({ error: "Invalid type" }, { status: 400 });
  }
}
