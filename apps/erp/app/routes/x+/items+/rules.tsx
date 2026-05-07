import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { getItemRules, getRuleAssignmentCounts } from "~/modules/items";
import ItemRulesTable from "~/modules/items/ui/ItemRules/ItemRulesTable";
import ItemRulesUpgradeOverlay from "~/modules/items/ui/ItemRules/ItemRulesUpgradeOverlay";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Item Rules`,
  to: path.to.itemRules
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const rules = await getItemRules(client, companyId, {
    limit,
    offset,
    sorts,
    search,
    filters
  });

  if (rules.error) {
    console.error(rules.error);
    throw redirect(
      path.to.parts,
      await flash(request, error(null, "Failed to load item rules"))
    );
  }

  const ids = (rules.data ?? []).map((r) => r.id);
  const counts = await getRuleAssignmentCounts(client, ids);
  const countMap = (counts.data ?? {}) as Record<string, number>;

  return {
    rules: (rules.data ?? []).map((r) => ({
      ...r,
      assignmentCount: countMap[r.id] ?? 0
    })),
    count: rules.count ?? 0
  };
}

export default function ItemRulesRoute() {
  const { rules, count } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate();

  if (isGated) {
    return <ItemRulesUpgradeOverlay />;
  }

  return (
    <VStack spacing={0} className="h-full">
      <ItemRulesTable data={rules as never} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
