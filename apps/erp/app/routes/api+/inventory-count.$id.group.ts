// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";

const logger = getLogger("erp", "inventory-count-group");

// The units of one count group (item and storage unit), read when its row
// expands on the count sheet.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { id } = params;
  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  if (!id || !itemId) return { lines: [] };
  const storageUnitId = url.searchParams.get("storageUnitId") || null;

  const api = await carbon(request);
  const result = await api.inventory.getInventoryCountGroupLines({
    inventoryCountId: id,
    itemId,
    storageUnitId
  });
  if (result.error) {
    logger.error("Failed to load the units of a count group", {
      inventoryCountId: id,
      itemId,
      storageUnitId,
      error: result.error
    });
    return { lines: [] };
  }
  return { lines: result.data };
}

export const clientLoader = cachedClientLoader<typeof loader>();
