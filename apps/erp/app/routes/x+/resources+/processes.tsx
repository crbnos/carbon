// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ProcessesTable } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { processesList } from "~/utils/list-registry/resources.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Processes`,
  to: path.to.processes
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, processesList, {
    dataKey: "processes",
    bypassRls: true,
    onError: {
      redirectTo: path.to.resources,
      message: "Failed to load processes"
    }
  });
}

export default function ProcessesRoute() {
  const { processes, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProcessesTable data={processes} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
