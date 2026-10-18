// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import type { MaintenanceSchedule } from "~/modules/resources/types";
import MaintenanceSchedulesTable from "~/modules/resources/ui/MaintenanceSchedule/MaintenanceSchedulesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Scheduled Maintenances`,
  to: path.to.maintenanceSchedules
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "resources",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const locationId = searchParams.get("location");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const locations = await api.resources.getLocationsList({});
  const locationsList = locations.data ?? [];

  // Default to first location if none specified
  const selectedLocationId = locationId ?? locationsList[0]?.id;

  if (!selectedLocationId) {
    return {
      data: [],
      count: 0,
      locations: locationsList,
      locationId: null
    };
  }

  const schedules = await api.resources.getMaintenanceSchedulesByLocation({
    search,
    limit,
    offset,
    sorts,
    filters,
    locationId: selectedLocationId
  });

  if (!schedules.data?.rows) {
    return data(
      {
        data: [] as MaintenanceSchedule[],
        count: 0,
        locations: locationsList,
        locationId: selectedLocationId
      },
      await flash(
        request,
        error(schedules.error, "Failed to load maintenance schedules")
      )
    );
  }

  return {
    data: (schedules.data?.rows ?? []) as MaintenanceSchedule[],
    count: schedules.data?.count ?? 0,
    locations: locationsList,
    locationId: selectedLocationId
  };
}

export default function MaintenanceSchedulesRoute() {
  const { data, count, locations, locationId } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaintenanceSchedulesTable
        data={data ?? []}
        count={count ?? 0}
        locations={locations}
        locationId={locationId}
      />
      <RecordOutlet />
    </VStack>
  );
}
