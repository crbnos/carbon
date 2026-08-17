import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  SalesRulesTable,
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
      path.to.items,
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

  return { rows, count: rules.count ?? rows.length };
}

export default function SalesRulesRoute() {
  const { rows, count } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "SALES_RULES" });

  if (isGated) {
    return <SalesRulesUpgradeOverlay />;
  }

  return (
    <>
      <SalesRulesTable data={rows as never} count={count} />
      <Outlet />
    </>
  );
}
