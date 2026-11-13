// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { quoteMaterialValidator } from "~/modules/sales/sales.models";
import { setCustomFields } from "~/utils/form";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(quoteMaterialValidator).request(args, {
    params: ["quoteId", "lineId", "id"]
  });
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  return api.sales.updateQuoteMaterial({
    ...input.data,
    id: input.params.id,
    quoteId: input.params.quoteId,
    quoteLineId: input.params.lineId,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
}
