// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const linesUpdate = z.object({
  ids: zfd.repeatableOfType(z.string()),
  field: z.enum(["storageUnitId", "shippedQuantity"]),
  value: zfd.text(z.string().optional())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(linesUpdate).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.inventory.updateShipmentLines({
    ...input.data,
    value: input.data.value ?? null
  });
}
