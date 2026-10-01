// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { VStack } from "@carbon/react";
import { isUnaffectedByNavigation } from "@carbon/utils";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getWorkflowRuns } from "~/modules/workflows";
import WorkflowRunsTable from "~/modules/workflows/ui/Runs/WorkflowRunsTable";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { search: "all" })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "workflows",
    role: "employee"
  });
  await requireFeature({
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
