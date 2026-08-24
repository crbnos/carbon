import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import type { WorkflowLastRun } from "~/modules/workflows";
import {
  getWorkflowLastRuns,
  getWorkflows,
  getWorkflowVersionNumbers
} from "~/modules/workflows";
import WorkflowsTable from "~/modules/workflows/ui/WorkflowsTable";
import WorkflowsUpgradeOverlay from "~/modules/workflows/ui/WorkflowsUpgradeOverlay";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "workflows",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const workflows = await getWorkflows(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  const rows = workflows.data ?? [];
  const publishedVersionIds = rows
    .map((row) => row.publishedVersionId)
    .filter((id): id is string => id !== null);

  const versionNumbers: Record<string, number> = {};
  if (publishedVersionIds.length) {
    const versions = await getWorkflowVersionNumbers(
      client,
      publishedVersionIds,
      companyId
    );
    for (const version of versions.data ?? []) {
      versionNumbers[version.id] = version.versionNumber;
    }
  }

  const workflowIds = rows.map((row) => row.id);
  const lastRuns: Record<string, WorkflowLastRun> = {};
  if (workflowIds.length) {
    const runs = await getWorkflowLastRuns(client, workflowIds, companyId);
    for (const run of runs.data ?? []) {
      if (run.workflowId) lastRuns[run.workflowId] = run;
    }
  }

  return {
    data: rows,
    count: workflows.count ?? 0,
    versionNumbers,
    lastRuns
  };
}

export default function WorkflowsIndexRoute() {
  const { data, count, versionNumbers, lastRuns } =
    useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "WORKFLOWS" });

  if (isGated) {
    return <WorkflowsUpgradeOverlay />;
  }

  return (
    <VStack spacing={0} className="h-full">
      <WorkflowsTable
        data={data}
        count={count}
        versionNumbers={versionNumbers}
        lastRuns={lastRuns}
      />
    </VStack>
  );
}
