// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon } from "~/modules/carbon.server";
import { quoteMaterialValidator } from "~/modules/sales";
import { setCustomFields } from "~/utils/form";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(quoteMaterialValidator).request(args, {
    params: ["quoteId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.sales.quote.material.create({
    ...input.data,
    quoteId: input.params.quoteId,
    quoteLineId: input.params.lineId,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
}
