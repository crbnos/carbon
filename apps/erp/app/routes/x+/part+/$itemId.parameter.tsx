// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { configurationParameterValidator } from "~/modules/items/items.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(configurationParameterValidator).request(args, {
    params: ["itemId"]
  });
  if ("invalid" in input) return input.invalid;
  const { listOptions, ...parameter } = input.data;
  const { api } = await authorize(args.request);
  return api.items.upsertConfigurationParameter({
    ...parameter,
    itemId: input.params.itemId,
    listOptions: parameter.dataType === "list" ? listOptions : undefined
  });
}
