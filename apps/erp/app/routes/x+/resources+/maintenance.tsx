import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import {
  getFailureModesList,
  getLocationsList,
  getMaintenanceDispatchesByLocation
} from "~/modules/resources";
import MaintenanceDispatchesTable from "~/modules/resources/ui/Maintenance/MaintenanceDispatchesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Maintenance",
  to: path.to.maintenanceDispatches
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status") ?? undefined;
  const locationId = searchParams.get("location");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const locations = await getLocationsList(client, companyId);
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
    getMaintenanceDispatchesByLocation(client, companyId, selectedLocationId, {
      search,
      status,
      limit,
      offset,
      sorts,
      filters
    }),
    getFailureModesList(client, companyId)
  ]);

  return {
    dispatches: dispatches.data ?? [],
    count: dispatches.count ?? 0,
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
        data={dispatches ?? []}
        count={count ?? 0}
        failureModes={failureModes ?? []}
        locations={locations}
        locationId={locationId}
      />
      <Outlet />
    </VStack>
  );
}
