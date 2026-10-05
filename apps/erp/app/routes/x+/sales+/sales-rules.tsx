// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { isUnaffectedByNavigation, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  SalesRulesGroups,
  SalesRulesUpgradeOverlay
} from "~/modules/sales/ui/SalesRules";
import {
  getEnforcementRuleAssignmentCounts,
  getEnforcementRules
} from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Sales Rules`,
  to: path.to.salesRules
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args) ? false : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const rules = await getEnforcementRules(client, "sales", companyId, {
    search: null,
    limit: 1000,
    offset: 0,
    sorts: []
  });

  if (rules.error) {
    throw redirect(
      path.to.salesOrders,
      await flash(request, error(rules.error, "Failed to load sales rules"))
    );
  }

  const ids = (rules.data ?? []).map((r) => r.id);
  const counts = await getEnforcementRuleAssignmentCounts(client, ids);

  const countsData = (counts.data ?? {}) as Record<string, number>;
  const rows = (rules.data ?? []).map((r) => ({
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
      <Outlet />
    </>
  );
}
