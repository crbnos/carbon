// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import PlanningGroupsTable from "~/modules/projects/ui/PlanningGroups/PlanningGroupsTable";
import PlanningGroupsUpgradeOverlay from "~/modules/projects/ui/PlanningGroups/PlanningGroupsUpgradeOverlay";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "planning-groups");

export const handle: Handle = {
  breadcrumb: msg`Planning Groups`,
  to: path.to.planningGroups
};

// The list loads without a plan check: a gated company sees the upgrade
// overlay. The write routes and `upsertPlanningGroup` enforce the plan.
export async function loader({ request }: LoaderFunctionArgs) {
  const { api, companyId } = await authorize(request, {
    "projects.planningGroups": "View"
  });

  const searchParams = new URL(request.url).searchParams;
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const groups = await api.projects.getPlanningGroups({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (groups.error) {
    logger.error("Failed to load planning groups", {
      companyId,
      error: groups.error
    });
    throw redirect(
      path.to.projects,
      await flash(
        request,
        error(groups.error, "Failed to load planning groups")
      )
    );
  }

  return {
    groups: groups.data?.rows ?? [],
    count: groups.data?.count ?? 0
  };
}

export default function PlanningGroupsRoute() {
  const { groups, count } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "PLANNING_GROUPS" });

  if (isGated) {
    return <PlanningGroupsUpgradeOverlay />;
  }

  return (
    <VStack spacing={0} className="h-full">
      <PlanningGroupsTable data={groups} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
