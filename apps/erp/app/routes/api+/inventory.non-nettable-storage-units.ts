// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader, RefreshRate } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { getNonNettableStorageUnitIds } from "~/modules/inventory/inventory.service";

const logger = getLogger("erp", "inventory-non-nettable-storage-units");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});
  const result = await getNonNettableStorageUnitIds(client, companyId);
  if (result.error) {
    logger.error("Failed to read non-nettable storage units", {
      companyId,
      error: result.error
    });
    // A 5xx, not an empty list: the read is retried and the hook reports it,
    // where an empty list would read as "no non-nettable units".
    throw new Response("Failed to read non-nettable storage units", {
      status: 500
    });
  }
  return { data: (result.data ?? []).map((unit) => unit.id) };
}

export const clientLoader = cachedClientLoader<typeof loader>({
  staleTime: RefreshRate.Medium
});
