import { requirePermissions } from "@carbon/auth/auth.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getWorkflowRuns } from "~/modules/workflows";
import WorkflowRunsTable from "~/modules/workflows/ui/Runs/WorkflowRunsTable";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "workflows",
    role: "employee"
  });
  await requirePlan({
    request,
    client,
    companyId,
    feature: "WORKFLOWS",
    redirectTo: path.to.workflows
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const runs = await getWorkflowRuns(client, companyId, {
    limit,
    offset,
    sorts,
    filters
  });

  return {
    data: runs.data ?? [],
    count: runs.count ?? 0
  };
}

export default function WorkflowRunsRoute() {
  const { data, count } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={0} className="h-full">
      <WorkflowRunsTable data={data} count={count} />
      <Outlet />
    </VStack>
  );
}
