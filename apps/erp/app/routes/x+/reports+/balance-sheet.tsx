import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import {
  computeReportPeriodBuckets,
  datetime,
  defaultReportRange
} from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLocale } from "@react-aria/i18n";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import type { ChartPeriodSeries } from "~/modules/accounting";
import {
  financialReportParamsValidator,
  getCompaniesInGroup,
  getConsolidatedPeriodSeries,
  getFinancialStatementPeriodSeries,
  getFiscalYearSettings
} from "~/modules/accounting";
import {
  exportPeriodReport,
  getPeriodColumnLabel,
  MultiPeriodStatementTree,
  ReportFilters
} from "~/modules/accounting/ui/Reports";
import { months } from "~/modules/shared";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { revalidateIgnoringOffset } from "~/utils/revalidate";

export const handle: Handle = {
  breadcrumb: msg`Balance Sheet`,
  to: path.to.balanceSheet
};

export const shouldRevalidate = revalidateIgnoringOffset;

const CTA_RESERVES_ACCOUNT_NUMBER = "3200";

function applyCtaByBucket(
  accounts: ChartPeriodSeries[],
  ctaByBucket: Record<string, number>
) {
  const ctaAccount = accounts.find(
    (a) => a.number === CTA_RESERVES_ACCOUNT_NUMBER
  );
  if (!ctaAccount) return;
  for (const [key, cta] of Object.entries(ctaByBucket)) {
    const cell = ctaAccount.periods[key];
    if (!cell) continue;
    ctaAccount.periods[key] = {
      ...cell,
      translatedBalance: (cell.translatedBalance ?? 0) + cta
    };
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting",
      role: "employee"
    }
  );

  const url = new URL(request.url);
  // Invalid params fall back to defaults — a bad bookmark must not 500
  const parsed = financialReportParamsValidator.safeParse(
    Object.fromEntries(url.searchParams.entries())
  );
  const companiesParam = parsed.success
    ? (parsed.data.companies ?? null)
    : null;
  const startDateParam = parsed.success
    ? (parsed.data.startDate ?? null)
    : null;
  const endDateParam = parsed.success ? (parsed.data.endDate ?? null) : null;
  const columns = parsed.success ? parsed.data.columns : ("month" as const);
  const showTranslatedParam = parsed.success
    ? parsed.data.showTranslated
    : false;

  const [companies, fiscalYearSettings] = await Promise.all([
    getCompaniesInGroup(client, companyGroupId),
    getFiscalYearSettings(client, companyId)
  ]);
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

  // Default range: last 6 months to date (in the company's business timezone) —
  // the current partial month plus the five preceding whole months.
  const range = defaultReportRange(
    endDateParam ??
      datetime.today(await getCompanyTimeZone(client, companyId)).toString()
  );
  const endDate = range.endDate;
  const startDate = startDateParam ?? range.startDate;

  const buckets = computeReportPeriodBuckets(
    startDate,
    endDate,
    columns,
    fiscalStartMonth
  );

  if (isMultiCompany && parentCurrency) {
    const consolidated = await getConsolidatedPeriodSeries(
      client,
      companyGroupId,
      selectedCompanyIds,
      parentCurrency,
      { buckets }
    );

    const balanceSheetAccounts = consolidated.data.filter(
      (a) => a.incomeBalance === "Balance Sheet"
    );
    applyCtaByBucket(balanceSheetAccounts, consolidated.ctaByBucket);

    return {
      balanceSheet: balanceSheetAccounts,
      periods: buckets,
      columns,
      companies: companiesList,
      selectedCompanyIds,
      showTranslated: true,
      isMultiCompany: true,
      isForeignCurrency: false,
      parentCurrency,
      fiscalStartMonth
    };
  }

  // Single company
  const selectedCompanyId = selectedCompanyIds[0]!;
  const selectedCompany = companiesList.find((c) => c.id === selectedCompanyId);
  const isForeignCurrency =
    !!parentCurrency &&
    !!selectedCompany?.baseCurrencyCode &&
    selectedCompany.baseCurrencyCode !== parentCurrency;
  const showTranslated = showTranslatedParam && isForeignCurrency;

  const series = await getFinancialStatementPeriodSeries(
    client,
    companyGroupId,
    selectedCompanyId,
    {
      buckets,
      includeCurrentYearEarnings: true,
      ...(showTranslated && parentCurrency
        ? { translate: { targetCurrency: parentCurrency } }
        : {})
    }
  );

  if (series.error) {
    throw redirect(
      path.to.accounting,
      await flash(request, error(series.error, "Failed to load balance sheet"))
    );
  }

  const balanceSheetAccounts = (series.data ?? []).filter(
    (a) => a.incomeBalance === "Balance Sheet"
  );
  if (showTranslated) {
    applyCtaByBucket(balanceSheetAccounts, series.ctaByBucket);
  }

  return {
    balanceSheet: balanceSheetAccounts,
    periods: buckets,
    columns,
    companies: companiesList,
    selectedCompanyIds,
    showTranslated,
    isMultiCompany: false,
    isForeignCurrency,
    parentCurrency,
    fiscalStartMonth
  };
}

export default function BalanceSheetRoute() {
  const {
    balanceSheet,
    periods,
    columns,
    companies,
    selectedCompanyIds,
    showTranslated,
    isMultiCompany,
    isForeignCurrency,
    parentCurrency,
    fiscalStartMonth
  } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const { locale } = useLocale();

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyIds={selectedCompanyIds}
        isMultiCompany={isMultiCompany}
        isForeignCurrency={isForeignCurrency}
        parentCurrency={parentCurrency}
        periodVariant="range"
        fiscalStartMonth={fiscalStartMonth}
        showColumns
        onDownload={() =>
          exportPeriodReport({
            accounts: balanceSheet,
            periods: periods.map((bucket) => ({
              ...bucket,
              label:
                getPeriodColumnLabel(bucket, columns, locale) +
                (bucket.isPartial ? " (To Date)" : "")
            })),
            measure: "balanceAtDate",
            showTranslated,
            search,
            filename: "balance-sheet.csv"
          })
        }
        search={search}
        onSearchChange={setSearch}
      />
      <MultiPeriodStatementTree
        data={balanceSheet}
        periods={periods}
        columns={columns}
        measure="balanceAtDate"
        showTranslated={showTranslated}
        parentCurrency={parentCurrency}
        search={search}
        ledgerPath={path.to.balanceSheetLedger}
      />
      <Outlet />
    </VStack>
  );
}
