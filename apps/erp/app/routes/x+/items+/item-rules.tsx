import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { getItemRuleAssignmentCounts, getItemRules } from "~/modules/items";
import {
  ItemRulesTable,
  ItemRulesUpgradeOverlay
} from "~/modules/items/ui/ItemRules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Item Rules`,
  to: path.to.itemRules
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const rules = await getItemRules(client, companyId, {
    search: null,
    limit: 1000,
    offset: 0,
    sorts: []
  });

  if (rules.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(rules.error, "Failed to load item rules"))
    );
  }

  const ids = (rules.data ?? []).map((r) => r.id);
  const counts = await getItemRuleAssignmentCounts(client, ids);

  const countsData = (counts.data ?? {}) as Record<string, number>;
  const rows = (rules.data ?? []).map((r) => ({
    ...r,
    assignmentCount: countsData[r.id] ?? 0
  }));

  return { rows, count: rules.count ?? rows.length };
}

export default function ItemRulesRoute() {
  const { rows, count } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "ITEM_RULES" });

  if (isGated) {
    return <ItemRulesUpgradeOverlay />;
  }

  return (
    <>
      <ItemRulesTable data={rows as never} count={count} />
      <Outlet />
    </>
  );
}
