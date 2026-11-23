// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { makeMethodVersionValidator } from "~/modules/items/items.models";
import { getPathToMakeMethod } from "~/modules/items/ui/Methods/utils";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(makeMethodVersionValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.items.createMethodVersion(input.data);
  if (result.error) return result;
  const { id, itemId, type } = result.data;
  // Only parts, tools and services have make methods.
  const methodItemType = type as Parameters<typeof getPathToMakeMethod>[0];
  throw redirect(getPathToMakeMethod(methodItemType, itemId, id));
}
