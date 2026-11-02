// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import WarehouseTransfersTable from "~/modules/inventory/ui/WarehouseTransfers/WarehouseTransfersTable";
import type { Handle } from "~/utils/handle";
import { warehouseTransfersList } from "~/utils/list-registry/inventory.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["warehouseTransfer"],
  breadcrumb: msg`Warehouse Transfers`,
  to: path.to.warehouseTransfers
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, warehouseTransfersList, {
    dataKey: "warehouseTransfers",
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Error loading warehouse transfers"
    }
  });
}

export default function WarehouseTransfersRoute() {
  const { warehouseTransfers, count, infinite } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <WarehouseTransfersTable
        data={warehouseTransfers}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
