import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Outlet, redirect, useLoaderData } from "react-router";
import { usePermissions, useSettings } from "~/hooks";
import type { Chart } from "~/modules/accounting";
import {
  createOpeningBalanceJournal,
  getChartOfAccounts,
  getExistingOpeningBalanceEntry,
  getFiscalYearSettings,
  openingBalanceValidator
} from "~/modules/accounting";
import { ChartOfAccountsTree } from "~/modules/accounting/ui/ChartOfAccounts";
import ChartOfAccountsTableFilters from "~/modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTableFilters";
import OpeningBalancePostModal from "~/modules/accounting/ui/ChartOfAccounts/OpeningBalancePostModal";
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

  const [chartOfAccounts, fiscalYearSettings, existingOpeningBalance] =
    await Promise.all([
      getChartOfAccounts(client, companyGroupId, {
        incomeBalance: null,
        startDate,
        endDate
      }),
      getFiscalYearSettings(client, companyId),
      getExistingOpeningBalanceEntry(client, companyId)
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
      months.indexOf(fiscalYearSettings.data?.startMonth ?? "January") + 1,
    hasOpeningBalance: existingOpeningBalance.data !== null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "accounting"
    });

  const formData = await request.formData();
  const validation = await validator(openingBalanceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // The re-entry guard (and the "already posted" message) lives in
  // createOpeningBalanceJournal so every caller is protected; the loader hides
  // the entry button when one exists, so this is just the backstop.
  const result = await createOpeningBalanceJournal(client, {
    companyId,
    companyGroupId,
    userId,
    postingDate: validation.data.postingDate,
    balances: validation.data.lines
  });

  if (result.error || !result.data) {
    return data(
      {},
      await flash(
        request,
        error(result.error, "Failed to post opening balances")
      )
    );
  }

  throw redirect(
    path.to.journalEntry(result.data.id),
    await flash(request, success("Opening balances posted"))
  );
}

export default function ChartOfAccountsRoute() {
  const { chartOfAccounts, fiscalStartMonth, hasOpeningBalance } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const settings = useSettings();
  const accountingEnabled = (settings as { accountingEnabled?: boolean })
    .accountingEnabled;

  const [search, setSearch] = useState("");
  const [openingBalanceMode, setOpeningBalanceMode] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [postModalOpen, setPostModalOpen] = useState(false);

  const canEnterOpeningBalances =
    Boolean(accountingEnabled) &&
    permissions.can("create", "accounting") &&
    !hasOpeningBalance;

  const enteredCount = useMemo(
    () => Object.values(amounts).filter((amount) => amount).length,
    [amounts]
  );

  const linesJson = useMemo(
    () =>
      JSON.stringify(
        Object.entries(amounts)
          .filter(([, amount]) => amount)
          .map(([accountId, amount]) => ({ accountId, amount }))
      ),
    [amounts]
  );

  const exitOpeningBalanceMode = () => {
    setOpeningBalanceMode(false);
    setAmounts({});
    setPostModalOpen(false);
  };

  return (
    <VStack spacing={0} className="h-full">
      <ChartOfAccountsTableFilters
        fiscalStartMonth={fiscalStartMonth}
        search={search}
        onSearchChange={setSearch}
        openingBalanceMode={openingBalanceMode}
        canEnterOpeningBalances={canEnterOpeningBalances}
        hasOpeningBalanceEntries={enteredCount > 0}
        onEnterOpeningBalances={() => setOpeningBalanceMode(true)}
        onCancelOpeningBalances={exitOpeningBalanceMode}
        onPostOpeningBalances={() => setPostModalOpen(true)}
      />
      <ChartOfAccountsTree
        data={chartOfAccounts}
        search={search}
        openingBalanceMode={openingBalanceMode}
        amounts={amounts}
        onAmountChange={(accountId, value) =>
          setAmounts((prev) => ({ ...prev, [accountId]: value }))
        }
      />
      <Outlet />
      <OpeningBalancePostModal
        open={postModalOpen}
        onClose={() => setPostModalOpen(false)}
        linesJson={linesJson}
        count={enteredCount}
      />
    </VStack>
  );
}
