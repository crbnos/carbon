// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { stockTransferValidator } from "~/modules/inventory/inventory.models";

/**
 * Create a stock transfer and move its lines at once, for a caller that has
 * no transfer screen (the MES line feed). The answer is always
 * `{ success, message?, stockTransferId? }`: a transfer that was created but
 * did not fully move is a failure that names the transfer, so the caller does
 * not send it again.
 */
export async function action(args: ActionFunctionArgs) {
  const input = await validator(stockTransferValidator).request(args);
  if ("invalid" in input) {
    return Response.json(
      { success: false, message: "Invalid stock transfer" },
      { status: 422 }
    );
  }
  const { locationId, lines } = input.data;
  const { api } = await authorize(args.request);
  const result = await api.inventory.createStockTransfer({
    locationId,
    lines,
    moveNow: true
  });

  if (!result.data) {
    return Response.json({
      success: false,
      message: result.error?.message ?? "Failed to create stock transfer"
    });
  }
  if ("violations" in result.data) {
    return Response.json({
      success: false,
      message: `Blocked by a storage rule: ${Object.values(result.data.ruleNames).join(", ")}`
    });
  }
  const { id, stockTransferId, moveError, pickedLineIds } = result.data;
  if (moveError || pickedLineIds.length === 0) {
    return Response.json({
      success: false,
      stockTransferId: id,
      message: `${stockTransferId} was created, but not moved: ${moveError ?? "pick its lines on the transfer"}`
    });
  }
  return Response.json({ success: true, stockTransferId: id });
}
