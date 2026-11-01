// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import FailureModesTable from "~/modules/resources/ui/FailureModes/FailureModesTable";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { failureModesList } from "~/utils/list-registry/resources.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Failure Modes`,
  to: path.to.failureModes
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, failureModesList, { dataKey: "data" });
}

export default function FailureModesRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <FailureModesTable
        data={data ?? []}
        count={count ?? 0}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
