import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getIssues, getIssueTypesList } from "~/modules/quality";
import IssuesTable from "~/modules/quality/ui/Issue/IssuesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "issues");

export const handle: Handle = {
  breadcrumb: msg`Issues`,
  to: path.to.issues
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
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
      filters
    }),
    getIssueTypesList(client, companyId)
  ]);

  if (issues.error) {
    logger.error(issues.error);
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(issues.error, "Error loading issues"))
    );
  }

  return {
    issues: issues.data ?? [],
    count: issues.count ?? 0,
    types: nonConformanceTypes.data ?? []
  };
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
