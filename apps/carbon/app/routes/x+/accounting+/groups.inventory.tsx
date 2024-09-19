import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { AccountListItem } from "~/modules/accounting";
import {
  InventoryPostingGroupsTable,
  getInventoryPostingGroups,
} from "~/modules/accounting";
import { getItemPostingGroupsList } from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Inventory Groups",
  to: path.to.accountingGroupsInventory,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: ["accounting", "inventory"],
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [inventoryGroups, itemPostingGroups, locations] = await Promise.all([
    getInventoryPostingGroups(client, companyId, {
      limit,
      offset,
      sorts,
      filters,
    }),
    getItemPostingGroupsList(client, companyId),
    getLocationsList(client, companyId),
  ]);
  if (inventoryGroups.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(inventoryGroups.error, "Failed to fetch inventory posting groups")
      )
    );
  }

  return json({
    data: inventoryGroups.data ?? [],
    itemPostingGroups: itemPostingGroups.data ?? [],
    locations: locations.data ?? [],
    count: inventoryGroups.count ?? 0,
  });
}

export default function InventoryPostingGroupsRoute() {
  const { data, itemPostingGroups, locations, count } =
    useLoaderData<typeof loader>();

  const routeData = useRouteData<{
    balanceSheetAccounts: AccountListItem[];
    incomeStatementAccounts: AccountListItem[];
  }>(path.to.accounting);

  return (
    <VStack spacing={0} className="h-full">
      <InventoryPostingGroupsTable
        data={data}
        count={count}
        itemPostingGroups={itemPostingGroups}
        locations={locations}
        balanceSheetAccounts={routeData?.balanceSheetAccounts ?? []}
        incomeStatementAccounts={routeData?.incomeStatementAccounts ?? []}
      />
      <Outlet />
    </VStack>
  );
}
