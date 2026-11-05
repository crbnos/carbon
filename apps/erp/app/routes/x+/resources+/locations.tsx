// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { LocationsTable } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { locationsList } from "~/utils/list-registry/resources.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Locations`,
  to: path.to.locations
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, locationsList, {
    dataKey: "locations",
    bypassRls: true,
    onError: {
      redirectTo: path.to.resources,
      message: "Failed to load locations"
    }
  });
}

export default function LocationsRoute() {
  const { locations, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <LocationsTable data={locations} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
