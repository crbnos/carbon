// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import type { ActionFunctionArgs } from "react-router";

// Picks every untracked line of the transfer.
export async function action(args: ActionFunctionArgs) {
  const { id } = args.params;
  if (!id) throw new Error("Could not find id");
  const api = await carbon(args.request);
  return api.inventory.pickAllStockTransferLines({ stockTransferId: id });
}
