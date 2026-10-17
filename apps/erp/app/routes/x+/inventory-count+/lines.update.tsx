// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { inventoryCountLineValidator } from "~/modules/inventory/inventory.models";

// Inline count entry persists one line at a time. The Draft-only guard is part
// of the operation's single UPDATE, so a concurrent Confirm cannot slip in.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(inventoryCountLineValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.inventory.updateInventoryCountLine(input.data);
  // The count grid saves with a plain fetch, which reads only the status.
  return data(result, { status: result.error?.status ?? 200 });
}
