// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SalesOrdersTable } from "~/modules/sales/ui/SalesOrder";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { salesOrdersList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["salesOrder"],
  breadcrumb: msg`Orders`,
  to: path.to.salesOrders
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, salesOrdersList, {
    dataKey: "salesOrders",
    bypassRls: true,
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch sales orders"
    }
  });
}

export default function SalesOrdersSearchRoute() {
  const { count, salesOrders, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesOrdersTable data={salesOrders} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
