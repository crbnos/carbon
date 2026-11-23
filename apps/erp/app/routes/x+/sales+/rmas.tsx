// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SalesReturnOrdersTable } from "~/modules/sales/ui/SalesReturnOrders";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { salesReturnOrdersList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["salesReturnOrder"],
  breadcrumb: msg`RMAs`,
  to: path.to.salesReturnOrders
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, salesReturnOrdersList, {
    dataKey: "salesReturnOrders",
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch sales return orders"
    }
  });
}

export default function SalesReturnOrdersSearchRoute() {
  const { count, salesReturnOrders, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesReturnOrdersTable
        data={salesReturnOrders}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
