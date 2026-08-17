import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { useRouteData } from "~/hooks";
import { getAccountingSyncTieOut } from "~/modules/accounting";
import { SyncTieOutTable } from "~/modules/accounting/ui/SyncTieOut";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import type { Filter } from "~/utils/query";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Sync Tie-Out`,
  to: path.to.accountingSyncTieOut
};

/** `eq` value or `in` comma-list from the table's filter params. */
function filterValues(
  filters: Filter[] | undefined,
  column: string
): string[] | null {
  const match = filters?.find((filter) => filter.column === column);
  if (!match?.value) return null;
  return match.operator === "in" ? match.value.split(",") : [match.value];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const { filters } = getGenericQueryFilters(searchParams);

  // Table filter params, with the SyncActivity card's direct-param
  // deep-links (?integration=, ?periodId=) as fallbacks.
  const integration =
    filterValues(filters, "integration") ?? searchParams.get("integration");
  const accountId = filterValues(filters, "accountId");
  const accountingPeriodId = searchParams.get("periodId");

  const tieOut = await getAccountingSyncTieOut(client, companyId, {
    integration,
    accountingPeriodId,
    accountId
  });

  return {
    data: tieOut.data ?? [],
    count: tieOut.data?.length ?? 0
  };
}

export default function SyncTieOutRoute() {
  const { data, count } = useLoaderData<typeof loader>();
  const accountingRouteData = useRouteData<{
    accountingIntegrations: string[];
    balanceSheetAccounts: { id: string; number: string | null; name: string }[];
    incomeStatementAccounts: {
      id: string;
      number: string | null;
      name: string;
    }[];
  }>(path.to.accounting);

  const integrations = accountingRouteData?.accountingIntegrations ?? [];
  const accounts = [
    ...(accountingRouteData?.balanceSheetAccounts ?? []),
    ...(accountingRouteData?.incomeStatementAccounts ?? [])
  ];

  return (
    <VStack spacing={0} className="h-full">
      <SyncTieOutTable
        data={data}
        count={count}
        integrations={integrations}
        accounts={accounts}
      />
      <Outlet />
    </VStack>
  );
}
