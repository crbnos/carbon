// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { inventoryCountScanValidator } from "~/modules/inventory/inventory.models";

// A code scanned or typed in the count's scan bar. The result's `outcome`
// tells the bar what happened, or what it must ask the counter for.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(inventoryCountScanValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.inventory.recordInventoryCountScan({
    inventoryCountId: input.params.id,
    storageUnitId: input.data.storageUnitId || null,
    code: input.data.code,
    itemId: input.data.itemId || undefined,
    quantity: input.data.quantity
  });
}
