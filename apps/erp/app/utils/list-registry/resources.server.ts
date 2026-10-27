// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ABILITIES_PAGING,
  CONTRACTORS_PAGING,
  FAILURE_MODES_PAGING,
  getAbilities,
  getContractors,
  getFailureModes,
  getLocations,
  getLocationsList,
  getMaintenanceDispatchesByLocation,
  getMaintenanceSchedulesByLocation,
  getProcesses,
  getSuggestions,
  getTrainings,
  getWorkCenters,
  LOCATIONS_PAGING,
  MAINTENANCE_DISPATCHES_PAGING,
  MAINTENANCE_SCHEDULES_PAGING,
  PROCESSES_PAGING,
  SUGGESTIONS_PAGING,
  TRAININGS_PAGING,
  WORK_CENTERS_PAGING
} from "~/modules/resources/resources.service";
import type { ListDefinition } from "./index.server";
import { searchList } from "./index.server";

/**
 * The maintenance lists show one location: `?location=`, else the company's
 * first location. Null when the company has no location.
 */
export async function resolveMaintenanceLocationId(
  client: SupabaseClient<Database>,
  companyId: string,
  params: URLSearchParams
) {
  const locationId = params.get("location");
  if (locationId) return locationId;
  const locations = await getLocationsList(client, companyId);
  return locations.data?.[0]?.id ?? null;
}

export const abilitiesList = searchList({
  key: "abilities",
  permission: { view: "resources", role: "employee" },
  paging: ABILITIES_PAGING,
  service: getAbilities
});

export const failureModesList = searchList({
  key: "failure-modes",
  permission: { view: "resources", role: "employee" },
  paging: FAILURE_MODES_PAGING,
  service: getFailureModes
});

export const locationsList = searchList({
  key: "locations",
  permission: { view: "resources", role: "employee" },
  paging: LOCATIONS_PAGING,
  service: getLocations
});

export const maintenanceDispatchesList = {
  key: "maintenance-dispatches",
  permission: { view: "resources", role: "employee" },
  ...MAINTENANCE_DISPATCHES_PAGING,
  query: async (
    client,
    companyId,
    { params, limit, cursor, exactCount, sorts, filters }
  ) => {
    const locationId = await resolveMaintenanceLocationId(
      client,
      companyId,
      params
    );
    if (!locationId) return { data: [], error: null, count: 0 };
    return getMaintenanceDispatchesByLocation(client, companyId, locationId, {
      search: params.get("search"),
      status: params.get("status") ?? undefined,
      limit,
      cursor,
      exactCount,
      sorts,
      filters
    });
  }
} satisfies ListDefinition;

export const maintenanceSchedulesList = {
  key: "maintenance-schedules",
  permission: { view: "resources", role: "employee" },
  ...MAINTENANCE_SCHEDULES_PAGING,
  query: async (
    client,
    companyId,
    { params, limit, cursor, exactCount, sorts, filters }
  ) => {
    const locationId = await resolveMaintenanceLocationId(
      client,
      companyId,
      params
    );
    if (!locationId) return { data: [], error: null, count: 0 };
    return getMaintenanceSchedulesByLocation(client, companyId, locationId, {
      search: params.get("search"),
      limit,
      cursor,
      exactCount,
      sorts,
      filters
    });
  }
} satisfies ListDefinition;

export const processesList = searchList({
  key: "processes",
  permission: { view: "resources", role: "employee" },
  paging: PROCESSES_PAGING,
  service: getProcesses
});

export const suggestionsList = searchList({
  key: "suggestions",
  permission: { view: "resources", role: "employee" },
  paging: SUGGESTIONS_PAGING,
  service: getSuggestions
});

export const trainingsList = searchList({
  key: "trainings",
  permission: { view: "resources", role: "employee" },
  paging: TRAININGS_PAGING,
  service: getTrainings
});

export const workCentersList = searchList({
  key: "work-centers",
  permission: { view: "resources", role: "employee" },
  paging: WORK_CENTERS_PAGING,
  service: getWorkCenters
});

export const contractorsList = searchList({
  key: "contractors",
  permission: { view: "resources", role: "employee" },
  paging: CONTRACTORS_PAGING,
  service: getContractors
});

// The resources lists. Each entry follows `sales.server.ts`.
export const resourcesLists: Record<string, ListDefinition> = {
  [abilitiesList.key]: abilitiesList,
  [contractorsList.key]: contractorsList,
  [failureModesList.key]: failureModesList,
  [locationsList.key]: locationsList,
  [maintenanceDispatchesList.key]: maintenanceDispatchesList,
  [maintenanceSchedulesList.key]: maintenanceSchedulesList,
  [processesList.key]: processesList,
  [suggestionsList.key]: suggestionsList,
  [trainingsList.key]: trainingsList,
  [workCentersList.key]: workCentersList
};
