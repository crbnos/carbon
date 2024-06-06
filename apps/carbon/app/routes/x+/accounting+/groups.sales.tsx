import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { AccountListItem } from "~/modules/accounting";
import {
  SalesPostingGroupsTable,
  getSalesPostingGroups,
} from "~/modules/accounting";
import { getItemGroupsList } from "~/modules/items";
import { getCustomerTypesList } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Sales Groups",
  to: path.to.accountingGroupsSales,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: ["accounting", "sales"],
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [salesGroups, itemGroups, customerTypes] = await Promise.all([
    getSalesPostingGroups(client, companyId, {
      limit,
      offset,
      sorts,
      filters,
    }),
    getItemGroupsList(client, companyId),
    getCustomerTypesList(client, companyId),
  ]);
  if (salesGroups.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(salesGroups.error, "Failed to fetch sales posting groups")
      )
    );
  }

  return json({
    data: salesGroups.data ?? [],
    count: salesGroups.count ?? 0,
    itemGroups: itemGroups.data ?? [],
    customerTypes: customerTypes.data ?? [],
  });
}

export default function SalesPostingGroupsRoute() {
  const { data, count, itemGroups, customerTypes } =
    useLoaderData<typeof loader>();

  const routeData = useRouteData<{
    balanceSheetAccounts: AccountListItem[];
    incomeStatementAccounts: AccountListItem[];
  }>(path.to.accounting);

  return (
    <VStack spacing={0} className="h-full">
      <SalesPostingGroupsTable
        data={data}
        count={count}
        itemGroups={itemGroups}
        customerTypes={customerTypes}
        balanceSheetAccounts={routeData?.balanceSheetAccounts ?? []}
        incomeStatementAccounts={routeData?.incomeStatementAccounts ?? []}
      />
      <Outlet />
    </VStack>
  );
}
