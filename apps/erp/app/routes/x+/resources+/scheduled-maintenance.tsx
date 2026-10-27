// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { getLocationsList } from "~/modules/resources/resources.service";
import type { MaintenanceSchedule } from "~/modules/resources/types";
import MaintenanceSchedulesTable from "~/modules/resources/ui/MaintenanceSchedule/MaintenanceSchedulesTable";
import type { Handle } from "~/utils/handle";
import { fetchListPage } from "~/utils/list-registry/index.server";
import { listErrorPage, listInfinite } from "~/utils/list-registry/load.server";
import { maintenanceSchedulesList } from "~/utils/list-registry/resources.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "maintenance-schedules");

export const handle: Handle = {
  breadcrumb: msg`Scheduled Maintenances`,
  to: path.to.maintenanceSchedules
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(
    request,
    maintenanceSchedulesList.permission
  );

  const searchParams = new URL(request.url).searchParams;
  const locationId = searchParams.get("location");

  const locations = await getLocationsList(client, companyId);
  const locationsList = locations.data ?? [];

  // Default to first location if none specified
  const selectedLocationId = locationId ?? locationsList[0]?.id;

  if (!selectedLocationId) {
    return {
      data: [],
      count: 0,
      nextCursor: null,
      infinite: listInfinite(maintenanceSchedulesList, "data", null),
      locations: locationsList,
      locationId: null
    };
  }

  // The registry query reads the location from the URL: pass the default.
  const listParams = new URLSearchParams(searchParams);
  listParams.set("location", selectedLocationId);
  const schedules = await fetchListPage(
    maintenanceSchedulesList,
    client,
    companyId,
    listParams
  );

  if (schedules.error) {
    if (searchParams.get("after")) {
      logger.error("Failed to load a later page of maintenance schedules", {
        companyId,
        error: schedules.error
      });
      return listErrorPage("data");
    }
    return data(
      {
        data: [] as MaintenanceSchedule[],
        count: 0,
        nextCursor: null,
        infinite: listInfinite(maintenanceSchedulesList, "data", null),
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
    data: schedules.rows as MaintenanceSchedule[],
    count: schedules.count,
    exactCount: schedules.exactCount,
    nextCursor: schedules.nextCursor,
    infinite: listInfinite(
      maintenanceSchedulesList,
      "data",
      schedules.nextCursor
    ),
    locations: locationsList,
    locationId: selectedLocationId
  };
}

export default function MaintenanceSchedulesRoute() {
  const { data, count, infinite, locations, locationId } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <MaintenanceSchedulesTable
        data={data ?? []}
        count={count ?? 0}
        infinite={infinite}
        locations={locations}
        locationId={locationId}
      />
      <RecordOutlet />
    </VStack>
  );
}
