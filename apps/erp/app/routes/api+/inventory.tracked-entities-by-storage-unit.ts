// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getItemStorageUnitQuantities } from "~/modules/items/items.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const storageUnitId = url.searchParams.get("storageUnitId");
  const locationId = url.searchParams.get("locationId");

  if (!itemId || !locationId) {
    return {
      data: [],
      error: null
    };
  }

  // Get all tracked entities for the item in the location
  const result = await getItemStorageUnitQuantities(
    client,
    itemId,
    companyId,
    locationId
  );

  if (result.error) {
    return {
      data: [],
      error: result.error
    };
  }

  // Filter to only include entities from the specific storageUnit
  const storageUnitEntities =
    result.data?.filter(
      (entity) =>
        entity.storageUnitId === storageUnitId && entity.trackedEntityId
    ) || [];

  return {
    data: storageUnitEntities,
    error: null
  };
}
