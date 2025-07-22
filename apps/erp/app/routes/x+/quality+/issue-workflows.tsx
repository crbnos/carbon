import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getIssueWorkflows } from "~/modules/quality";
import IssueWorkflowsTable from "~/modules/quality/ui/IssueWorkflows/IssueWorkflowsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Issue Workflows",
  to: path.to.issueWorkflows,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const procedures = await getIssueWorkflows(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters,
  });

  return json({
    procedures: procedures.data ?? [],
    count: procedures.count ?? 0,
  });
}

export default function IssueWorkflowsRoute() {
  const { procedures, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <IssueWorkflowsTable data={procedures} count={count} />
      <Outlet />
    </VStack>
  );
}
