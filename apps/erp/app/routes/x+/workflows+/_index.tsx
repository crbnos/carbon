import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getWorkflows, getWorkflowVersionNumbers } from "~/modules/workflows";
import WorkflowsTable from "~/modules/workflows/ui/WorkflowsTable";
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
  const activeVersionIds = rows
    .map((row) => row.activeVersionId)
    .filter((id): id is string => id !== null);

  const versionNumbers: Record<string, number> = {};
  if (activeVersionIds.length) {
    const versions = await getWorkflowVersionNumbers(
      client,
      activeVersionIds,
      companyId
    );
    for (const version of versions.data ?? []) {
      versionNumbers[version.id] = version.versionNumber;
    }
  }

  return {
    data: rows,
    count: workflows.count ?? 0,
    versionNumbers
  };
}

export default function WorkflowsIndexRoute() {
  const { data, count, versionNumbers } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <WorkflowsTable
        data={data}
        count={count}
        versionNumbers={versionNumbers}
      />
    </VStack>
  );
}
