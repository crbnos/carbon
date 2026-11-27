// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { configurationParameterGroupValidator } from "~/modules/items/items.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(configurationParameterGroupValidator).request(
    args,
    { params: ["itemId"] }
  );
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  return api.items.upsertConfigurationParameterGroup({
    ...input.data,
    itemId: input.params.itemId
  });
}
