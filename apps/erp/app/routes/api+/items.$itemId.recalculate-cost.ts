// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon } from "~/modules/carbon.server";

// The Recalculate confirm dialog toasts `{ success, message }`.
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["itemId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.items.cost.recalculate({
    itemId: input.params.itemId
  });
  if (result.error) return { success: false, message: result.error.message };
  const { unitCost } = result.data;
  return {
    success: true,
    message: `Unit cost updated to ${unitCost.toFixed(2)}`
  };
}
