// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getPullFromLocations } from "@carbon/database/strict-backflush";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader, RefreshRate } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "items-pull-from-locations");

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  try {
    const locations = await getPullFromLocations(
      getDatabaseClient(),
      companyId
    );
    return { data: locations.map((location) => location.id), error: null };
  } catch (error) {
    logger.error("Failed to read pull-from locations", { companyId, error });
    return { data: null, error: "Failed to read pull-from locations" };
  }
}

export const clientLoader = cachedClientLoader<typeof loader>({
  staleTime: RefreshRate.Medium
});
