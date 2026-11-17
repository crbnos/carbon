// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { shipmentDeliveredValidator } from "~/modules/inventory/inventory.models";

/** Mark Delivered: records, changes or clears the date the goods arrived. */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(shipmentDeliveredValidator).request(args, {
    params: ["shipmentId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.inventory.markShipmentDelivered({
    shipmentId: input.params.shipmentId,
    deliveredDate: input.data.deliveredDate ?? null
  });
}
