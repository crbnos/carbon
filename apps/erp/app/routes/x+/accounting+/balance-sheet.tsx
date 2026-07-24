import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Alert, AlertDescription, AlertTitle, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { useUrlParams } from "~/hooks";
import type { Chart } from "~/modules/accounting";
import {
  getCompaniesInGroup,
  getConsolidatedBalances,
  getFinancialStatementBalances,
  getFiscalYearSettings,
  getReportViews,
  translateCompanyBalances
} from "~/modules/accounting";
import { getComparisonWindow } from "~/modules/accounting/accounting.utils";
import {
  DownloadPdfButton,
  ExportReportButton,
  FinancialStatementTree,
  ReportFilters
} from "~/modules/accounting/ui/Reports";
import { months } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { revalidateIgnoringOffset } from "~/utils/revalidate";

export const handle: Handle = {
  breadcrumb: msg`Balance Sheet`,
  to: path.to.balanceSheet
};

export const shouldRevalidate = revalidateIgnoringOffset;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      view: "accounting",
      role: "employee"
    });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const companiesParam = searchParams.get("companies");
  const endDate = searchParams.get("endDate") || null;
  const showTranslated = searchParams.get("showTranslated") === "true";
  const compare = (searchParams.get("compare") ?? "none") as
    | "none"
    | "priorPeriod"
    | "priorYear";

  const [companies, fiscalYearSettings, reportViews] = await Promise.all([
    getCompaniesInGroup(client, companyGroupId),
    getFiscalYearSettings(client, companyId),
    getReportViews(client, companyId, userId, "balance-sheet")
  ]);
  const views = reportViews.data;
  const fiscalStartMonth =
    months.indexOf(fiscalYearSettings.data?.startMonth ?? "January") + 1;
  const companiesList = companies.data ?? [];
  const parentCompany = companiesList.find((c) => !c.parentCompanyId);
  const parentCurrency = parentCompany?.baseCurrencyCode ?? null;

  const selectedCompanyIds =
    companiesParam === "all"
      ? companiesList.map((c) => c.id)
      : companiesParam
        ? [companiesParam]
        : [companyId];
  const isMultiCompany = selectedCompanyIds.length > 1;

  if (isMultiCompany && parentCurrency) {
    const periodEnd = endDate ?? new Date().toISOString().split("T")[0];
    const consolidated = await getConsolidatedBalances(
      client,
      companyGroupId,
      selectedCompanyIds,
      parentCurrency,
      periodEnd
    );

    let balanceSheetAccounts = consolidated.data.filter(
      (a) => a.incomeBalance === "Balance Sheet"
    );

    // Apply CTA to reserves account
    const ctaAccount = balanceSheetAccounts.find((a) => a.number === "3200");
    if (ctaAccount) {
      ctaAccount.translatedBalance =
        (ctaAccount.translatedBalance ?? 0) + consolidated.cta;
    }

    return {
      balanceSheet: balanceSheetAccounts as (Chart & {
        translatedBalance?: number;
        exchangeRate?: number;
      })[],
      companies: companiesList,
      selectedCompanyIds,
      showTranslated: true,
      isMultiCompany: true,
      isForeignCurrency: false,
      parentCurrency,
      fiscalStartMonth,
      warnings: [] as string[],
      comparison: undefined as Record<string, number> | undefined,
      views
    };
  }

  // Single company
  const selectedCompanyId = selectedCompanyIds[0];
  const balances = await getFinancialStatementBalances(
    client,
    companyGroupId,
    selectedCompanyId,
    { startDate: null, endDate, includeCurrentYearEarnings: true }
  );

  if (balances.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(balances.error, "Failed to load balance sheet")
      )
    );
  }

  const selectedCompany = companiesList.find((c) => c.id === selectedCompanyId);
  const isForeignCurrency =
    !!parentCurrency &&
    !!selectedCompany?.baseCurrencyCode &&
    selectedCompany.baseCurrencyCode !== parentCurrency;

  let balanceSheetAccounts = (balances.data ?? []).filter(
    (a) => a.incomeBalance === "Balance Sheet"
  ) as (Chart & { translatedBalance?: number; exchangeRate?: number })[];

  let cta = 0;

  if (showTranslated && isForeignCurrency && parentCurrency) {
    const periodEnd = endDate ?? new Date().toISOString().split("T")[0];
    const translation = await translateCompanyBalances(
      client,
      companyGroupId,
      selectedCompanyId!,
      parentCurrency,
      periodEnd,
      undefined,
      balances.data ?? []
    );

    if (translation.data) {
      const translationMap = new Map(
        translation.data.map((t) => [t.accountId, t])
      );
      cta = translation.cta;

      balanceSheetAccounts = balanceSheetAccounts.map((account) => {
        const t = translationMap.get(account.id);
        if (t) {
          return {
            ...account,
            translatedBalance: Number(t.translatedBalance),
            exchangeRate: Number(t.exchangeRate)
          };
        }
        return account;
      });

      const ctaAccount = balanceSheetAccounts.find((a) => a.number === "3200");
      if (ctaAccount) {
        ctaAccount.translatedBalance =
          (ctaAccount.translatedBalance ?? 0) + cta;
      }
    }
  }

  // Comparative column: balance sheet compares as-of a shifted end date.
  let comparison: Record<string, number> | undefined;
  const compWindow = getComparisonWindow(compare, null, endDate, "asOf");
  if (compWindow?.endDate) {
    const compBalances = await getFinancialStatementBalances(
      client,
      companyGroupId,
      selectedCompanyId,
      {
        startDate: null,
        endDate: compWindow.endDate,
        includeCurrentYearEarnings: true
      }
    );
    if (!compBalances.error) {
      comparison = {};
      for (const a of compBalances.data ?? []) {
        if (a.incomeBalance === "Balance Sheet")
          comparison[a.id] = a.balanceAtDate;
      }
    }
  }

  return {
    balanceSheet: balanceSheetAccounts,
    companies: companiesList,
    selectedCompanyIds,
    showTranslated: showTranslated && isForeignCurrency,
    isMultiCompany: false,
    isForeignCurrency,
    parentCurrency,
    fiscalStartMonth,
    warnings: balances.warnings ?? [],
    comparison,
    views
  };
}

export default function BalanceSheetRoute() {
  const {
    balanceSheet,
    companies,
    selectedCompanyIds,
    showTranslated,
    isMultiCompany,
    isForeignCurrency,
    parentCurrency,
    fiscalStartMonth,
    warnings,
    comparison,
    views
  } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const [params] = useUrlParams();
  const endDate =
    params.get("endDate") || new Date().toISOString().split("T")[0];
  const csvRows = balanceSheet.map((a) => ({
    number: a.number ?? "",
    name: `${"  ".repeat(0)}${a.name ?? ""}`,
    balance: a.balanceAtDate ?? 0,
    translated: a.translatedBalance ?? ""
  }));

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyIds={selectedCompanyIds}
        isMultiCompany={isMultiCompany}
        isForeignCurrency={isForeignCurrency}
        parentCurrency={parentCurrency}
        periodVariant="asOf"
        fiscalStartMonth={fiscalStartMonth}
        showCompare={!isMultiCompany}
        report="balance-sheet"
        views={views}
        actions={
          <>
            <ExportReportButton
              rows={csvRows}
              filename={`balance-sheet-${endDate}.csv`}
            />
            <DownloadPdfButton />
          </>
        }
        search={search}
        onSearchChange={setSearch}
      />
      {warnings.includes("no-retained-earnings-account") && (
        <Alert variant="warning" className="rounded-none border-x-0">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>No Retained Earnings account found</AlertTitle>
          <AlertDescription>
            Prior-year income is shown inside Net Income. Add an account with
            type Retained Earnings to split retained earnings from current-year
            income.
          </AlertDescription>
        </Alert>
      )}
      <FinancialStatementTree
        data={balanceSheet}
        measure="balanceAtDate"
        showTranslated={showTranslated}
        parentCurrency={parentCurrency}
        search={search}
        ledgerPath={path.to.balanceSheetLedger}
        comparison={comparison}
      />
      <Outlet />
    </VStack>
  );
}
