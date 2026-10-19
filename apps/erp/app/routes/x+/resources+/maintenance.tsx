// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import MaintenanceDispatchesTable from "~/modules/resources/ui/Maintenance/MaintenanceDispatchesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Maintenance`,
  to: path.to.maintenanceDispatches
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "resources.dispatches": "View" },
    { role: "employee" }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status") ?? undefined;
  const locationId = searchParams.get("location");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const locations = await api.resources.getLocationsList({});
  const locationsList = locations.data ?? [];

  // Default to first location if none specified
  const selectedLocationId = locationId ?? locationsList[0]?.id;

  if (!selectedLocationId) {
    return {
      dispatches: [],
      count: 0,
      failureModes: [],
      locations: locationsList,
      locationId: null
    };
  }

  const [dispatches, failureModes] = await Promise.all([
    api.resources.getMaintenanceDispatchesByLocation({
      search,
      status,
      limit,
      offset,
      sorts,
      filters,
      locationId: selectedLocationId
    }),
    api.resources.getFailureModesList({})
  ]);

  return {
    dispatches: dispatches.data?.rows ?? [],
    count: dispatches.data?.count ?? 0,
    failureModes: failureModes.data ?? [],
    locations: locationsList,
    locationId: selectedLocationId
  };
}

export default function MaintenanceRoute() {
  const { dispatches, count, failureModes, locations, locationId } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaintenanceDispatchesTable
        // @ts-expect-error TS2322 - TODO: fix type
        data={dispatches ?? []}
        count={count ?? 0}
        failureModes={failureModes ?? []}
        locations={locations}
        locationId={locationId}
      />
      <RecordOutlet />
    </VStack>
  );
}
