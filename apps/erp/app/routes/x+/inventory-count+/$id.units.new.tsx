// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { inventoryCountUnitValidator } from "~/modules/inventory/inventory.models";

// A unit the counter adds by hand, with its item named.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(inventoryCountUnitValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.inventory.addInventoryCountUnit({
    inventoryCountId: input.params.id,
    storageUnitId: input.data.storageUnitId || null,
    code: input.data.code,
    itemId: input.data.itemId,
    quantity: input.data.quantity
  });
}
