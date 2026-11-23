// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { getChargeNumbers } from "~/modules/projects/projects.service";

const logger = getLogger("erp", "api-charge-numbers");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const chargeNumbers = await getChargeNumbers(client, companyId);
  if (chargeNumbers.error) {
    logger.error("Failed to load charge numbers", {
      companyId,
      error: chargeNumbers.error
    });
    return { data: [] };
  }

  return { data: chargeNumbers.data };
}

export const clientLoader = cachedClientLoader<typeof loader>();
