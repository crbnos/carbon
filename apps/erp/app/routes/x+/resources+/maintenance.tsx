// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getFailureModesList,
  getLocationsList
} from "~/modules/resources/resources.service";
import MaintenanceDispatchesTable from "~/modules/resources/ui/Maintenance/MaintenanceDispatchesTable";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { maintenanceDispatchesList } from "~/utils/list-registry/resources.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Maintenance`,
  to: path.to.maintenanceDispatches
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, maintenanceDispatchesList, {
    dataKey: "dispatches",
    firstPage: async ({ client, companyId, params }) => {
      const [locations, failureModes] = await Promise.all([
        getLocationsList(client, companyId),
        getFailureModesList(client, companyId)
      ]);
      const locationsList = locations.data ?? [];
      return {
        failureModes: failureModes.data ?? [],
        locations: locationsList,
        // The registry query defaults to the first location too.
        locationId: params.get("location") ?? locationsList[0]?.id ?? null
      };
    }
  });
}

export default function MaintenanceRoute() {
  const { dispatches, count, infinite, failureModes, locations, locationId } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaintenanceDispatchesTable
        // @ts-expect-error TS2322 - TODO: fix type
        data={dispatches ?? []}
        count={count ?? 0}
        infinite={infinite}
        failureModes={failureModes ?? []}
        locations={locations}
        locationId={locationId}
      />
      <RecordOutlet />
    </VStack>
  );
}
