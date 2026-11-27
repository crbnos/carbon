// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { configurationParameterOrderValidator } from "~/modules/items/items.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(configurationParameterOrderValidator).request(
    args
  );
  if ("invalid" in input) return input.invalid;
  const { configurationParameterGroupId, ...order } = input.data;
  const { api } = await authorize(args.request);
  // The card posts "null" for the Ungrouped column.
  return api.items.updateConfigurationParameterOrder({
    ...order,
    configurationParameterGroupId:
      configurationParameterGroupId === "null"
        ? null
        : configurationParameterGroupId
  });
}
