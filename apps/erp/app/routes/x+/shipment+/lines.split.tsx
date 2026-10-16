// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { splitValidator } from "~/modules/inventory/inventory.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(splitValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { documentId, documentLineId, ...split } = input.data;
  const api = await carbon(args.request);
  return api.inventory.splitShipmentLine({
    shipmentId: documentId,
    shipmentLineId: documentLineId,
    ...split
  });
}
