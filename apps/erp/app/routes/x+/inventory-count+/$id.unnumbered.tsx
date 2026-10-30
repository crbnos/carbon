// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { inventoryCountUnnumberedValidator } from "~/modules/inventory/inventory.models";

// How many units with no serial number are on the shelf, for one group.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(inventoryCountUnnumberedValidator).request(
    args,
    { params: ["id"] }
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.inventory.setInventoryCountUnnumberedQuantity({
    inventoryCountId: input.params.id,
    itemId: input.data.itemId,
    storageUnitId: input.data.storageUnitId || null,
    quantity: input.data.quantity
  });
}
