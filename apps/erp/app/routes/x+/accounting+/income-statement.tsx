import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { useUrlParams } from "~/hooks";
import type { Chart } from "~/modules/accounting";
import {
  getCompaniesInGroup,
  getConsolidatedBalances,
  getFinancialStatementBalances,
  getFiscalYearSettings,
  getReportingPeriods,
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
  breadcrumb: msg`Income Statement`,
  to: path.to.incomeStatement
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
  const startDate = searchParams.get("startDate") || null;
  const endDate = searchParams.get("endDate") || null;
  const showTranslated = searchParams.get("showTranslated") === "true";
  const compare = (searchParams.get("compare") ?? "none") as
    | "none"
    | "priorPeriod"
    | "priorYear";

  const [companies, fiscalYearSettings, reportViews, reportPeriods] =
    await Promise.all([
      getCompaniesInGroup(client, companyGroupId),
      getFiscalYearSettings(client, companyId),
      getReportViews(client, companyId, userId, "income-statement"),
      getReportingPeriods(client, companyId)
    ]);
  const views = reportViews.data;
  const periods = reportPeriods.data;
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
      periodEnd,
      startDate ?? undefined
    );

    const incomeStatementAccounts = consolidated.data.filter(
      (a) => a.incomeBalance === "Income Statement"
    );

    return {
      incomeStatement: incomeStatementAccounts as (Chart & {
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
      comparison: undefined as Record<string, number> | undefined,
      views,
      periods
    };
  }

  // Single company
  const selectedCompanyId = selectedCompanyIds[0];
  const balances = await getFinancialStatementBalances(
    client,
    companyGroupId,
    selectedCompanyId,
    { startDate, endDate }
  );

  if (balances.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(balances.error, "Failed to load income statement")
      )
    );
  }

  const selectedCompany = companiesList.find((c) => c.id === selectedCompanyId);
  const isForeignCurrency =
    !!parentCurrency &&
    !!selectedCompany?.baseCurrencyCode &&
    selectedCompany.baseCurrencyCode !== parentCurrency;

  let incomeStatementAccounts = (balances.data ?? []).filter(
    (a) => a.incomeBalance === "Income Statement"
  ) as (Chart & { translatedBalance?: number; exchangeRate?: number })[];

  if (showTranslated && isForeignCurrency && parentCurrency) {
    const periodEnd = endDate ?? new Date().toISOString().split("T")[0];
    const translation = await translateCompanyBalances(
      client,
      companyGroupId,
      selectedCompanyId!,
      parentCurrency,
      periodEnd,
      startDate ?? undefined,
      balances.data ?? []
    );

    if (translation.data) {
      const translationMap = new Map(
        translation.data.map((t) => [t.accountId, t])
      );

      incomeStatementAccounts = incomeStatementAccounts.map((account) => {
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
    }
  }

  // Comparative column: re-run the same balance call over the shifted window.
  let comparison: Record<string, number> | undefined;
  const compWindow = getComparisonWindow(compare, startDate, endDate, "range");
  if (compWindow) {
    const compBalances = await getFinancialStatementBalances(
      client,
      companyGroupId,
      selectedCompanyId,
      { startDate: compWindow.startDate, endDate: compWindow.endDate }
    );
    if (!compBalances.error) {
      comparison = {};
      for (const a of compBalances.data ?? []) {
        if (a.incomeBalance === "Income Statement")
          comparison[a.id] = a.netChange;
      }
    }
  }

  return {
    incomeStatement: incomeStatementAccounts,
    companies: companiesList,
    selectedCompanyIds,
    showTranslated: showTranslated && isForeignCurrency,
    isMultiCompany: false,
    isForeignCurrency,
    parentCurrency,
    fiscalStartMonth,
    comparison,
    views,
    periods
  };
}

export default function IncomeStatementRoute() {
  const {
    incomeStatement,
    companies,
    selectedCompanyIds,
    showTranslated,
    isMultiCompany,
    isForeignCurrency,
    parentCurrency,
    fiscalStartMonth,
    comparison,
    views,
    periods
  } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const [params] = useUrlParams();
  const endDate =
    params.get("endDate") || new Date().toISOString().split("T")[0];
  const csvRows = incomeStatement.map((a) => ({
    number: a.number ?? "",
    name: a.name ?? "",
    netChange: a.netChange ?? 0,
    comparison: comparison?.[a.id] ?? ""
  }));

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyIds={selectedCompanyIds}
        isMultiCompany={isMultiCompany}
        isForeignCurrency={isForeignCurrency}
        parentCurrency={parentCurrency}
        fiscalStartMonth={fiscalStartMonth}
        showCompare={!isMultiCompany}
        report="income-statement"
        views={views}
        periods={periods}
        actions={
          <>
            <ExportReportButton
              rows={csvRows}
              filename={`income-statement-${endDate}.csv`}
            />
            <DownloadPdfButton />
          </>
        }
        search={search}
        onSearchChange={setSearch}
      />
      <FinancialStatementTree
        data={incomeStatement}
        measure="netChange"
        showTranslated={showTranslated}
        parentCurrency={parentCurrency}
        search={search}
        ledgerPath={path.to.incomeStatementLedger}
        comparison={comparison}
      />
      <Outlet />
    </VStack>
  );
}
