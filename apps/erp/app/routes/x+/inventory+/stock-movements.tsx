// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import StockMovementsTable from "~/modules/inventory/ui/StockMovements/StockMovementsTable";
import type { Handle } from "~/utils/handle";
import { stockMovementsList } from "~/utils/list-registry/inventory.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["itemLedger"],
  breadcrumb: msg`Movements`,
  to: path.to.stockMovements
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, stockMovementsList, {
    dataKey: "movements",
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Error loading stock movements"
    }
  });
}

export default function StockMovementsRoute() {
  const { movements, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <StockMovementsTable data={movements} count={count} infinite={infinite} />
    </VStack>
  );
}
