// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { LeasesTable } from "~/modules/purchasing/ui/Leases";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { leasesList } from "~/utils/list-registry/purchasing.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Leases`,
  to: path.to.leases
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, leasesList, {
    dataKey: "leases",
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch leases"
    }
  });
}

export default function LeasesRoute() {
  const { count, leases, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <LeasesTable data={leases} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
