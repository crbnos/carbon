// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import WorkflowsTable from "~/modules/workflows/ui/WorkflowsTable";
import WorkflowsUpgradeOverlay from "~/modules/workflows/ui/WorkflowsUpgradeOverlay";
import { loadListPage } from "~/utils/list-registry/load.server";
import { workflowsList } from "~/utils/list-registry/workflows.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, workflowsList, { dataKey: "data" });
}

export default function WorkflowsIndexRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "WORKFLOWS" });

  if (isGated) {
    return <WorkflowsUpgradeOverlay />;
  }

  return (
    <VStack spacing={0} className="h-full">
      <WorkflowsTable data={data} count={count} infinite={infinite} />
    </VStack>
  );
}
