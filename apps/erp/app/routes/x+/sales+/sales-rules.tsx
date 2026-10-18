// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  SalesRulesGroups,
  SalesRulesUpgradeOverlay
} from "~/modules/sales/ui/SalesRules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Sales Rules`,
  to: path.to.salesRules
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "sales",
    role: "employee"
  });

  const rules = await api.shared.getEnforcementRules({
    search: null,
    limit: 1000,
    offset: 0,
    sorts: [],
    family: "sales"
  });

  if (rules.error) {
    throw redirect(
      path.to.salesOrders,
      await flash(request, error(rules.error, "Failed to load sales rules"))
    );
  }

  const ids = (rules.data?.rows ?? []).map((r) => r.id);
  const counts = await api.shared.getEnforcementRuleAssignmentCounts({
    ruleIds: ids
  });

  const countsData = (counts.data ?? {}) as Record<string, number>;
  const rows = (rules.data?.rows ?? []).map((r) => ({
    ...r,
    assignmentCount: countsData[r.id] ?? 0
  }));

  return { rows };
}

export default function SalesRulesRoute() {
  const { rows } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "SALES_RULES" });

  if (isGated) {
    return <SalesRulesUpgradeOverlay />;
  }

  return (
    <>
      <SalesRulesGroups rules={rows as never} />
      <RecordOutlet />
    </>
  );
}
