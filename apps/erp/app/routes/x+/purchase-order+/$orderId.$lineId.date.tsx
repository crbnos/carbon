// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { purchaseOrderLineDateValidator } from "~/modules/purchasing/purchasing.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchaseOrderLineDateValidator).request(args, {
    params: ["lineId"]
  });
  if ("invalid" in input) return input.invalid;

  const api = await carbon(args.request);
  return api.purchasing.updatePurchaseOrderLineDate({
    lineId: input.params.lineId,
    field: input.data.field,
    value: input.data.value ?? null
  });
}
