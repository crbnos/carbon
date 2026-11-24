// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { itemId, locationId } = params;
  if (!itemId || !locationId) {
    throw new Error("Item ID and Location ID are required");
  }
  const api = await carbon(request);
  const result = await api.production.deleteDemandProjections({
    itemId,
    locationId
  });
  return respond(request, result).redirect(
    `${path.to.demandProjections}?location=${locationId}`,
    { message: "Demand projections deleted successfully" }
  );
}
