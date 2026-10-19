// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

// A line's Pick (its quantity) or Unpick (0).
const quantityForm = z.object({
  id: z.string().min(1),
  quantity: zfd.numeric(z.number().min(0)),
  locationId: zfd.text(z.string().optional()),
  trackedEntityId: zfd.text(z.string().optional())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(quantityForm).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: lineId, quantity, locationId = "", trackedEntityId } = input.data;
  const api = await carbon(args.request);
  return quantity === 0
    ? api.inventory.unpickStockTransferLine({
        lineId,
        locationId,
        trackedEntityId
      })
    : api.inventory.pickStockTransferLine({
        lineId,
        quantity,
        locationId,
        trackedEntityId
      });
}
