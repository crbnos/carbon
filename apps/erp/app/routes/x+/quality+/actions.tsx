import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getQualityActions, getIssueTypesList } from "~/modules/quality";
import ActionsTable from "~/modules/quality/ui/Actions/ActionsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Actions",
  to: path.to.qualityActions,
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

  const [actions, issueTypes] = await Promise.all([
    getQualityActions(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getIssueTypesList(client, companyId),
  ]);

  return json({
    actions: actions.data ?? [],
    count: actions.count ?? 0,
    issueTypes: issueTypes.data ?? [],
  });
}

export default function ActionsRoute() {
  const { actions, count, issueTypes } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ActionsTable data={actions} count={count} issueTypes={issueTypes} />
      <Outlet />
    </VStack>
  );
}