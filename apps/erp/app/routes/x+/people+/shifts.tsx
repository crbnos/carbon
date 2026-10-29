// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ShiftsTable } from "~/modules/people/ui/Shifts";
import { getLocations } from "~/modules/resources/resources.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { shiftsList } from "~/utils/list-registry/people.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Shifts`,
  to: path.to.shifts
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, shiftsList, {
    dataKey: "shifts",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => ({
      locations: (await getLocations(client, companyId)).data ?? []
    }),
    onError: { redirectTo: path.to.people, message: "Failed to load shifts" }
  });
}

export default function ShiftsRoute() {
  const { shifts, locations, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ShiftsTable
        data={shifts}
        count={count}
        infinite={infinite}
        locations={locations}
      />
      <RecordOutlet />
    </VStack>
  );
}
