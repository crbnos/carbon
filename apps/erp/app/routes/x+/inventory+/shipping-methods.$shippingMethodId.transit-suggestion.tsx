// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";

/** Use N days: sets the transit days to the measured average, rounded up. */
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["shippingMethodId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.inventory.applyShippingMethodTransitSuggestion({
    shippingMethodId: input.params.shippingMethodId
  });
}
