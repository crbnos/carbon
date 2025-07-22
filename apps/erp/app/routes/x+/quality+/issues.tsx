import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getIssues, getIssueTypesList } from "~/modules/quality";
import IssuesTable from "~/modules/quality/ui/Issue/IssuesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Issues",
  to: path.to.issues,
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

  const [issues, nonConformanceTypes] = await Promise.all([
    getIssues(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getIssueTypesList(client, companyId),
  ]);

  return json({
    issues: issues.data ?? [],
    count: issues.count ?? 0,
    types: nonConformanceTypes.data ?? [],
  });
}

export default function IssuesRoute() {
  const { issues, count, types } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <IssuesTable data={issues} count={count} types={types} />
      <Outlet />
    </VStack>
  );
}
