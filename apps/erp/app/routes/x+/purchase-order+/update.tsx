// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { updatePurchaseOrders } from "~/modules/purchasing/purchasing.server";
import { bulkStartFormResponse } from "~/utils/table-jobs";
import { startAllMatchingBulkAction } from "~/utils/table-jobs.server";

// The properties panel posts one field (`ids`, `field`, `value`); the orders
// table posts `field=delete` for the selected rows, or `allMatching` in place
// of the ids for every matching row.
const form = z.object({
  ids: zfd.repeatableOfType(z.string()),
  field: z.union([z.literal("delete"), updatePurchaseOrders.input.shape.field]),
  value: z.string().optional(),
  allMatching: zfd.text(z.string().optional())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(form).request(args);
  if ("invalid" in input) return input.invalid;
  const { ids, field, value, allMatching } = input.data;

  // Every matching row: the background job deletes the Draft and Planned
  // orders (bulkDeletePurchaseOrders) and skips the rest.
  if (field === "delete" && allMatching) {
    const { companyId, userId } = await requirePermissions(args.request, {
      update: "purchasing",
      delete: "purchasing"
    });
    const started = await startAllMatchingBulkAction(allMatching, {
      companyId,
      userId,
      actionKey: "purchase-orders.delete",
      params: {}
    });
    if (started) return bulkStartFormResponse(started);
  }

  const api = await carbon(args.request);
  return field === "delete"
    ? api.purchasing.deletePurchaseOrders({ purchaseOrderIds: ids })
    : api.purchasing.updatePurchaseOrders({ ids, field, value: value || null });
}
