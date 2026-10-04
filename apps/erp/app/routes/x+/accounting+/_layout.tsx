// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getIntegrationIdsByRole } from "@carbon/ee";
import { VStack } from "@carbon/react";
import { isUnaffectedByNavigation, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  MetaFunction,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import {
  getAccountsList,
  getBaseCurrency,
  getCompaniesInGroup
} from "~/modules/accounting";
import AccountingBetaGate from "~/modules/accounting/ui/AccountingBetaGate";
import useAccountingSubmodules from "~/modules/accounting/ui/useAccountingSubmodules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Accounting" }];
};

function AccountingSidebar() {
  const { groups } = useAccountingSubmodules();
  return <GroupedContentSidebar groups={groups} />;
}

export const handle: Handle = {
  breadcrumb: msg`Accounting`,
  to: path.to.accounting,
  module: "accounting",
  sidebar: AccountingSidebar
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args) ? false : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting"
    }
  );

  const [accounts, baseCurrency, companies, integrations] = await Promise.all([
    getAccountsList(client, companyGroupId, {
      isGroup: false
    }),
    getBaseCurrency(client, companyId),
    getCompaniesInGroup(client, companyGroupId),
    // Active accounting integrations gate integration-dependent nav items
    // (Sync Tie-Out) and feed the tie-out table's integration filter
    client
      .from("companyIntegration")
      .select("id")
      .eq("companyId", companyId)
      .eq("active", true)
      .in("id", getIntegrationIdsByRole("accounting"))
  ]);

  if (accounts.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(accounts.error, "Failed to fetch accounts"))
    );
  }

  return {
    baseCurrency: baseCurrency.data,
    balanceSheetAccounts:
      accounts.data.filter((a) => a.incomeBalance === "Balance Sheet") ?? [],
    incomeStatementAccounts:
      accounts.data.filter((a) => a.incomeBalance === "Income Statement") ?? [],
    hasMultipleCompanies: (companies.data?.length ?? 0) > 1,
    accountingIntegrations: (integrations.data ?? []).map((row) => row.id)
  };
}

export default function AccountingRoute() {
  return (
    <VStack spacing={0} className="relative h-full">
      <Outlet />
      <AccountingBetaGate />
    </VStack>
  );
}
