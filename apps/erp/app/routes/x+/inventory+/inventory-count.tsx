// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { InventoryCountsTable } from "~/modules/inventory/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["inventoryCount"],
  breadcrumb: msg`Inventory Count`,
  to: path.to.inventoryCounts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [inventoryCounts, locations] = await Promise.all([
    api.inventory.getInventoryCounts({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.resources.getLocationsList({})
  ]);

  if (inventoryCounts.error) {
    throw redirect(
      path.to.inventory,
      await flash(
        request,
        error(inventoryCounts.error, "Error loading inventory count")
      )
    );
  }

  return {
    inventoryCounts: inventoryCounts.data?.rows ?? [],
    count: inventoryCounts.data?.count ?? 0,
    locations: locations.data ?? []
  };
}

export default function InventoryCountRoute() {
  const { inventoryCounts, count, locations } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <InventoryCountsTable
        data={inventoryCounts}
        count={count ?? 0}
        locations={locations}
      />
      <RecordOutlet />
    </VStack>
  );
}
