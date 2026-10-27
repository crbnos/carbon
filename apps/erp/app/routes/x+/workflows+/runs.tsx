// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requireFeature } from "@carbon/ee/plan.server";
import { RecordOutlet, VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import WorkflowRunsTable from "~/modules/workflows/ui/Runs/WorkflowRunsTable";
import { loadListPage } from "~/utils/list-registry/load.server";
import { workflowRunsList } from "~/utils/list-registry/workflows.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, workflowRunsList, {
    dataKey: "data",
    guard: ({ client, companyId }) =>
      requireFeature({
        request,
        client,
        companyId,
        feature: "WORKFLOWS",
        redirectTo: path.to.workflows
      })
  });
}

export default function WorkflowRunsRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={0} className="h-full">
      <WorkflowRunsTable data={data} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
