import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getComplianceStatements } from "~/modules/quality";
import ComplianceStatementsTable from "~/modules/quality/ui/ComplianceStatements/ComplianceStatementsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Compliance Statements`,
  to: path.to.complianceStatements
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

  return await getComplianceStatements(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function ComplianceStatementsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ComplianceStatementsTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
