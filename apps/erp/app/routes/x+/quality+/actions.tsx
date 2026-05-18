import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import {
  getIssueTypesList,
  getQualityActions,
  getRequiredActionsList
} from "~/modules/quality";
import ActionsTable from "~/modules/quality/ui/Actions/ActionsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Actions`,
  to: path.to.qualityActions
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [actions, issueTypes, requiredActions] = await Promise.all([
    getQualityActions({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getIssueTypesList(),
    getRequiredActionsList()
  ]);

  if (actions.error) {
    console.error(actions.error);
  }

  return {
    actions: actions.data ?? [],
    count: actions.count ?? 0,
    issueTypes: issueTypes.data ?? [],
    requiredActions: requiredActions.data ?? []
  };
}

export default function ActionsRoute() {
  const { actions, count, issueTypes, requiredActions } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ActionsTable
        data={actions}
        count={count}
        issueTypes={issueTypes}
        requiredActions={requiredActions}
      />
      <Outlet />
    </VStack>
  );
}
