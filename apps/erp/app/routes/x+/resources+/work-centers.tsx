// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getDepartmentsList } from "~/modules/people/people.service";
import { getLocationsList } from "~/modules/resources/resources.service";
import { WorkCentersTable } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { workCentersList } from "~/utils/list-registry/resources.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Work Centers`,
  to: path.to.workCenters
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, workCentersList, {
    dataKey: "workCenters",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => {
      const [departments, locations] = await Promise.all([
        getDepartmentsList(client, companyId),
        getLocationsList(client, companyId)
      ]);
      return {
        departments: departments.data ?? [],
        locations: locations.data ?? []
      };
    },
    onError: {
      redirectTo: path.to.resources,
      message: "Failed to fetch work centers"
    }
  });
}

export default function WorkCentersRoute() {
  const { count, departments, locations, workCenters, infinite } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <WorkCentersTable
        data={workCenters}
        count={count}
        infinite={infinite}
        departments={departments}
        locations={locations}
      />
      <RecordOutlet />
    </VStack>
  );
}
