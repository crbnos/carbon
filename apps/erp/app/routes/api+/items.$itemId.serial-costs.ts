// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";

const logger = getLogger("erp", "item-serial-costs");

// Each on-hand serial unit's inventory cost, for the item's Storage Units
// card. Inventory value is accounting data: both reads take accounting view.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { itemId } = params;
  if (!itemId) {
    return { costs: {}, costingMethod: null, retainedEarningsAccountId: null };
  }
  const locationId = new URL(request.url).searchParams.get("locationId");

  const api = await carbon(request);
  const [result, accountDefaults] = await Promise.all([
    api.inventory.getSerialUnitCosts({ itemId, locationId }),
    api.accounting.getDefaultAccounts({})
  ]);
  // A recost's offset defaults to Retained Earnings, as on the asset side.
  const retainedEarningsAccountId =
    accountDefaults.data?.retainedEarningsAccount ?? null;
  if (result.error) {
    logger.error("Failed to value serial units", {
      itemId,
      locationId,
      error: result.error
    });
    return { costs: {}, costingMethod: null, retainedEarningsAccountId };
  }
  return { ...result.data, retainedEarningsAccountId };
}

export const clientLoader = cachedClientLoader<typeof loader>();
