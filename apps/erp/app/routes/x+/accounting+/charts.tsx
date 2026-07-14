import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import type { Chart } from "~/modules/accounting";
import {
  getChartOfAccounts,
  getFiscalYearSettings
} from "~/modules/accounting";
import { ChartOfAccountsTree } from "~/modules/accounting/ui/ChartOfAccounts";
import ChartOfAccountsTableFilters from "~/modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTableFilters";
import { months } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { revalidateIgnoringOffset } from "~/utils/revalidate";

export const handle: Handle = {
  breadcrumb: msg`Chart of Accounts`,
  to: path.to.chartOfAccounts
};

export const shouldRevalidate = revalidateIgnoringOffset;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting",
      role: "employee",
      bypassRls: true
    }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);

  const startDate = searchParams.get("startDate") || null;
  const endDate = searchParams.get("endDate") || null;

  const [chartOfAccounts, fiscalYearSettings] = await Promise.all([
    getChartOfAccounts(client, companyGroupId, {
      incomeBalance: null,
      startDate,
      endDate
    }),
    getFiscalYearSettings(client, companyId)
  ]);

  if (chartOfAccounts.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(chartOfAccounts.error, "Failed to get chart of accounts")
      )
    );
  }

  return {
    chartOfAccounts: (chartOfAccounts.data ?? []) as Chart[],
    fiscalStartMonth:
      months.indexOf(fiscalYearSettings.data?.startMonth ?? "January") + 1
  };
}

export default function ChartOfAccountsRoute() {
  const { chartOfAccounts, fiscalStartMonth } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");

  return (
    <VStack spacing={0} className="h-full">
      <ChartOfAccountsTableFilters
        fiscalStartMonth={fiscalStartMonth}
        search={search}
        onSearchChange={setSearch}
      />
      <ChartOfAccountsTree data={chartOfAccounts} search={search} />
      <Outlet />
    </VStack>
  );
}
