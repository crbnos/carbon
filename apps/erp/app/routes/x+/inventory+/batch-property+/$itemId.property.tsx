// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { batchPropertyValidator } from "~/modules/inventory/inventory.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(batchPropertyValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { listOptions, ...property } = input.data;
  const { api } = await authorize(args.request);
  return api.inventory.upsertBatchProperty({
    ...property,
    listOptions: property.dataType === "list" ? listOptions : undefined
  });
}
