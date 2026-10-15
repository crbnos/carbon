// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon } from "~/modules/carbon.server";
import { shipmentFixedAssetLineUpdateValidator } from "~/modules/inventory";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(shipmentFixedAssetLineUpdateValidator).request(
    args
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.inventory.shipment.fixedAssetLine.update(input.data);
}
