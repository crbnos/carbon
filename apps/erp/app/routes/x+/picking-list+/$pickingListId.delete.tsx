// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["pickingListId"] });
  if ("invalid" in input) return input.invalid;
  const { pickingListId } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.deletePickingList({ pickingListId });
  // Back to wherever the delete came from (the lists view with its filters),
  // never to the deleted list's own page.
  const referrer = requestReferrer(args.request);
  const destination =
    referrer && !referrer.includes(`/picking-list/${pickingListId}`)
      ? referrer
      : path.to.pickingListsTable;
  return respond(args.request, result).redirect(destination, {
    message: "Picking list deleted successfully",
    onError: path.to.pickingListDetails(pickingListId)
  });
}
