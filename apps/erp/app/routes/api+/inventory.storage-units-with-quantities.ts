// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { getStorageUnitsListForLocation } from "~/modules/inventory";
import { getItemStorageUnitQuantities } from "~/modules/items/items.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  const itemId = url.searchParams.get("itemId");

  if (!locationId) {
    return {
      data: [],
      error: null
    };
  }

  // If itemId is provided, get storageUnits with quantities
  if (itemId) {
    const [shelvesResult, quantitiesResult] = await Promise.all([
      getStorageUnitsListForLocation(client, companyId, locationId),
      getItemStorageUnitQuantities(client, itemId, companyId, locationId)
    ]);

    if (shelvesResult.error || quantitiesResult.error) {
      return {
        data: [],
        error: shelvesResult.error || quantitiesResult.error
      };
    }

    // Filter storageUnits to only include those with quantities > 0
    const quantitiesMap = new Map(
      quantitiesResult.data?.map((q) => [q.storageUnitId, q.quantity]) ?? []
    );

    const shelvesWithQuantities =
      shelvesResult.data?.filter((storageUnit) => {
        const quantity = quantitiesMap.get(storageUnit.id);
        return quantity && quantity > 0;
      }) ?? [];

    // Add quantity information to each storageUnit
    const shelvesWithQuantityData = shelvesWithQuantities.map(
      (storageUnit) => ({
        ...storageUnit,
        quantity: quantitiesMap.get(storageUnit.id) ?? 0
      })
    );

    return {
      data: shelvesWithQuantityData,
      error: null
    };
  }

  return await getStorageUnitsListForLocation(client, companyId, locationId);
}

// On-hand moves with every receipt, pick and shipment, by anyone: the cached
// value is shown at once and always read again.
export const clientLoader = cachedClientLoader<typeof loader>({ staleTime: 0 });
