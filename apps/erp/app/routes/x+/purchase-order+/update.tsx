// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { updatePurchaseOrders } from "~/modules/purchasing/purchasing.server";

// The properties panel posts one field (`ids`, `field`, `value`); the orders
// table posts `field=delete` for the selected rows.
const form = z.object({
  ids: zfd.repeatableOfType(z.string()),
  field: z.union([z.literal("delete"), updatePurchaseOrders.input.shape.field]),
  value: z.string().optional()
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args);
  if ("invalid" in input) return input.invalid;
  const { ids, field, value } = input.data;
  const api = await carbon(args.request);
  return field === "delete"
    ? api.purchasing.deletePurchaseOrders({ purchaseOrderIds: ids })
    : api.purchasing.updatePurchaseOrders({ ids, field, value: value || null });
}
