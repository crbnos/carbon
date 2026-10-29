// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import InspectionsTable from "~/modules/quality/ui/Inspections/InspectionsTable";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { inspectionsList } from "~/utils/list-registry/quality.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["inspection"],
  breadcrumb: msg`Inspections`,
  to: path.to.inspections
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, inspectionsList, {
    dataKey: "inspections",
    onError: {
      redirectTo: path.to.quality,
      message: "Failed to load inspections"
    }
  });
}

export default function InspectionsRoute() {
  const { inspections, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <InspectionsTable data={inspections} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
