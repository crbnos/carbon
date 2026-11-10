// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

// Confirm (Draft -> Pending): moves the count out of entry into review. The
// acknowledgement of row-level warnings happens in the confirm dialog.
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.updateInventoryCountStatus({
    id,
    status: "Pending"
  });
  return respond(args.request, result).redirect(path.to.inventoryCount(id), {
    message: "Count confirmed"
  });
}
