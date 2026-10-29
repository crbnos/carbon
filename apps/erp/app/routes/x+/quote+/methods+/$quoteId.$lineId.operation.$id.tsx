// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { quoteOperationValidator } from "~/modules/sales/sales.models";
import { setCustomFields } from "~/utils/form";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(quoteOperationValidator).request(args, {
    params: ["quoteId", "lineId", "id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.sales.updateQuoteOperation({
    ...input.data,
    id: input.params.id,
    quoteId: input.params.quoteId,
    quoteLineId: input.params.lineId,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
}
