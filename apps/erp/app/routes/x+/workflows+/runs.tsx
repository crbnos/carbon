// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getWorkflowRunRecordNames } from "~/modules/workflows";
import WorkflowRunsTable from "~/modules/workflows/ui/Runs/WorkflowRunsTable";
import { fetchListPage } from "~/utils/list-registry/index.server";
import { listErrorPage } from "~/utils/list-registry/load.server";
import { workflowRunsList } from "~/utils/list-registry/workflows.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "workflow-runs");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(
    request,
    workflowRunsList.permission
  );
  await requireFeature({
    request,
    client,
    companyId,
    feature: "WORKFLOWS",
    redirectTo: path.to.workflows
  });

  const searchParams = new URL(request.url).searchParams;
  const runs = await fetchListPage(
    workflowRunsList,
    client,
    companyId,
    searchParams
  );

  if (runs.error && searchParams.get("after")) {
    logger.error("Failed to load a later page of workflow runs", {
      companyId,
      error: runs.error
    });
    return listErrorPage("data");
  }

  // The record names are read per page, so every loaded row carries its own.
  const data = runs.rows;
  const recordNames = await getWorkflowRunRecordNames(
    client,
    companyId,
    data.flatMap((run) =>
      run.triggerTable && run.triggerRecordId
        ? [{ table: run.triggerTable, id: run.triggerRecordId }]
        : []
    )
  );

  return {
    data: data.map((run) => ({
      ...run,
      recordName: recordNames[`${run.triggerTable}:${run.triggerRecordId}`]
    })),
    count: runs.count,
    exactCount: runs.exactCount,
    nextCursor: runs.nextCursor
  };
}

export default function WorkflowRunsRoute() {
  const { data, count, nextCursor } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={0} className="h-full">
      <WorkflowRunsTable data={data} count={count} nextCursor={nextCursor} />
      <RecordOutlet />
    </VStack>
  );
}
