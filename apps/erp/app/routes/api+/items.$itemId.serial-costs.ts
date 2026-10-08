// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { getDefaultAccounts } from "~/modules/accounting";
import { getSerialUnitCosts } from "~/modules/inventory";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "item-serial-costs");

// Each on-hand serial unit's inventory cost, for the item's Storage Units
// card. Inventory value is accounting data, so it takes accounting view.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { itemId } = params;
  if (!itemId) {
    return { costs: {}, costingMethod: null, retainedEarningsAccountId: null };
  }
  const locationId = new URL(request.url).searchParams.get("locationId");

  const [result, accountDefaults] = await Promise.all([
    getSerialUnitCosts(client, getDatabaseClient(), {
      companyId,
      userId,
      itemId,
      locationId
    }),
    getDefaultAccounts(client, companyId)
  ]);
  // A recost's offset defaults to Retained Earnings, as on the asset side.
  const retainedEarningsAccountId =
    accountDefaults.data?.retainedEarningsAccount ?? null;
  if (result.error) {
    logger.error("Failed to value serial units", {
      companyId,
      itemId,
      locationId,
      error: result.error
    });
    return { costs: {}, costingMethod: null, retainedEarningsAccountId };
  }
  return { ...result.data, retainedEarningsAccountId };
}

export const clientLoader = cachedClientLoader<typeof loader>();
