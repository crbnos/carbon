// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { data, type LoaderFunctionArgs } from "react-router";

// GET ?locationId=&targetQuantity= — how many of the item the location can
// make now, through every BOM level, and what limits it.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const search = new URL(request.url).searchParams;
  const target = Number(search.get("targetQuantity"));

  const api = await carbon(request);
  const result = await api.items.getBuildableQuantity({
    itemId: params.itemId ?? "",
    locationId: search.get("locationId") ?? "",
    targetQuantity: Number.isInteger(target) && target > 0 ? target : undefined
  });
  if (result.error) {
    throw data(
      { message: result.error.message },
      { status: result.error.status }
    );
  }
  return result.data;
}
