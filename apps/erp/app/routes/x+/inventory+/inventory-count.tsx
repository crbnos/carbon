// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { InventoryCountsTable } from "~/modules/inventory/ui";
import { getLocationsList } from "~/modules/resources/resources.service";
import type { Handle } from "~/utils/handle";
import { inventoryCountsList } from "~/utils/list-registry/inventory.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["inventoryCount"],
  breadcrumb: msg`Inventory Count`,
  to: path.to.inventoryCounts
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, inventoryCountsList, {
    dataKey: "inventoryCounts",
    firstPage: async ({ client, companyId }) => {
      const locations = await getLocationsList(client, companyId);
      return { locations: locations.data ?? [] };
    },
    onError: {
      redirectTo: path.to.inventory,
      message: "Error loading inventory count"
    }
  });
}

export default function InventoryCountRoute() {
  const { inventoryCounts, count, infinite, locations } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <InventoryCountsTable
        data={inventoryCounts}
        count={count}
        infinite={infinite}
        locations={locations}
      />
      <RecordOutlet />
    </VStack>
  );
}
