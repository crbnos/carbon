import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
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

const logger = getLogger("erp", "actions");

export const handle: Handle = {
  breadcrumb: msg`Actions`,
  to: path.to.qualityActions
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

  const [actions, issueTypes, requiredActions] = await Promise.all([
    getQualityActions(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getIssueTypesList(client, companyId),
    getRequiredActionsList(client, companyId)
  ]);

  if (actions.error) {
    logger.error(actions.error);
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
