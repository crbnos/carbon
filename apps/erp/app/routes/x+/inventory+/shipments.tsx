// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import ShipmentsTable from "~/modules/inventory/ui/Shipments/ShipmentsTable";
import type { Handle } from "~/utils/handle";
import { shipmentsList } from "~/utils/list-registry/inventory.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["shipment"],
  breadcrumb: msg`Shipments`,
  to: path.to.shipments
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, shipmentsList, {
    dataKey: "shipments",
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Error loading shipments"
    }
  });
}

export default function ShipmentsRoute() {
  const { shipments, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ShipmentsTable data={shipments} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
