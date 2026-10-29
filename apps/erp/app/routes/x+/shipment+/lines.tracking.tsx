// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const line = {
  shipmentId: z.string().min(1),
  shipmentLineId: z.string().min(1),
  trackedEntityId: z.string().min(1)
};

const tracking = z.discriminatedUnion("trackingType", [
  z.object({
    trackingType: z.literal("batch"),
    ...line,
    quantity: zfd.numeric(z.number())
  }),
  z.object({
    trackingType: z.literal("serial"),
    ...line,
    index: zfd.numeric(z.number())
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(tracking).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.inventory.assignShipmentLineEntity(input.data);
}
