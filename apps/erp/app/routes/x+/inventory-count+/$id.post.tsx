// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

// Post (Pending -> Posted): the variances become inventory adjustments.
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.postInventoryCount({
    inventoryCountId: id
  });
  // An error is toasted by the Post button's fetcher.
  if (!result.data) return result;
  // Lines that cannot post: the page toasts the reason and marks them.
  if ("invalidLineIds" in result.data) return result.data;
  return respond(args.request, result).redirect(path.to.inventoryCount(id), {
    message: "Inventory count posted"
  });
}
