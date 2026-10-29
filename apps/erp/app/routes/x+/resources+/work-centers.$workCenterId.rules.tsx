// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getStorageRulesDataForTarget } from "@carbon/ee/rules.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import RuleAssignmentsList from "~/modules/inventory/ui/StorageRules/RuleAssignmentsList";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });
  const { workCenterId } = params;
  if (!workCenterId) throw notFound("workCenterId required");

  const data = await getStorageRulesDataForTarget(client, {
    targetType: "workCenter",
    targetId: workCenterId,
    companyId
  });

  return { workCenterId, ...data };
}

export default function WorkCenterRulesRoute() {
  const { workCenterId, assignments, library } = useLoaderData<typeof loader>();
  return (
    <RuleAssignmentsList
      targetType="workCenter"
      targetId={workCenterId}
      assignments={assignments as never}
      library={library as never}
      variant="flat"
    />
  );
}
