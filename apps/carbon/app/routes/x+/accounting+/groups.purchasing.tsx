import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { AccountListItem } from "~/modules/accounting";
import {
  PurchasingPostingGroupsTable,
  getPurchasingPostingGroups,
} from "~/modules/accounting";
import { getItemPostingGroupsList } from "~/modules/items";
import { getSupplierTypesList } from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Purchasing Groups",
  to: path.to.accountingGroupsPurchasing,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: ["accounting", "purchasing"],
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [purchasingGroups, itemPostingGroups, supplierTypes] =
    await Promise.all([
      getPurchasingPostingGroups(client, companyId, {
        limit,
        offset,
        sorts,
        filters,
      }),
      getItemPostingGroupsList(client, companyId),
      getSupplierTypesList(client, companyId),
    ]);
  if (purchasingGroups.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(
          purchasingGroups.error,
          "Failed to fetch purchasing posting groups"
        )
      )
    );
  }

  return json({
    data: purchasingGroups.data ?? [],
    itemPostingGroups: itemPostingGroups.data ?? [],
    supplierTypes: supplierTypes.data ?? [],
    count: purchasingGroups.count ?? 0,
  });
}

export default function PurchasingPostingGroupsRoute() {
  const { data, itemPostingGroups, supplierTypes, count } =
    useLoaderData<typeof loader>();

  const routeData = useRouteData<{
    balanceSheetAccounts: AccountListItem[];
    incomeStatementAccounts: AccountListItem[];
  }>(path.to.accounting);

  return (
    <VStack spacing={0} className="h-full">
      <PurchasingPostingGroupsTable
        data={data}
        count={count}
        itemPostingGroups={itemPostingGroups}
        supplierTypes={supplierTypes}
        balanceSheetAccounts={routeData?.balanceSheetAccounts ?? []}
        incomeStatementAccounts={routeData?.incomeStatementAccounts ?? []}
      />
      <Outlet />
    </VStack>
  );
}
