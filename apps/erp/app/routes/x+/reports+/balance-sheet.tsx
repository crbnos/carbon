import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { resolveLanguage } from "@carbon/locale";
import { VStack } from "@carbon/react";
import {
  computeReportPeriodBuckets,
  datetime,
  defaultReportRange,
  getPreferenceHeaders
} from "@carbon/utils";
import { setupI18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
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
  canExportFilteredReport,
  exportPeriodReport,
  getPeriodColumnLabel,
  MultiPeriodStatementTree,
  ReportFilters
} from "~/modules/accounting/ui/Reports";
import { months } from "~/modules/shared";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { loadLinguiCatalogForRequest } from "~/services/lingui.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { resolveReportCompanies } from "~/utils/reportExport";
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
  if (
    fiscalYearSettings.error?.code !== "PGRST116" &&
    (fiscalYearSettings.error || fiscalYearSettings.data == null)
  ) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(fiscalYearSettings.error, "Failed to load fiscal year settings")
      )
    );
  }
  const fiscalStartMonth =
    months.indexOf(fiscalYearSettings.data?.startMonth ?? "January") + 1;
  const {
    companies: companiesList,
    selectedCompanyIds,
    isComplete: isCompanySourceComplete
  } = resolveReportCompanies(companies, companiesParam, companyId);

  if (!selectedCompanyIds) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(companies.error, "Failed to load complete company metadata")
      )
    );
  }

  const parentCompany = companiesList.find((c) => !c.parentCompanyId);
  const parentCurrency = parentCompany?.baseCurrencyCode ?? null;
  const isMultiCompany = selectedCompanyIds.length > 1;

  if (companiesParam === "all" && (!parentCompany || !parentCurrency)) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(null, "Failed to load complete company metadata")
      )
    );
  }

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
  const { locale } = getPreferenceHeaders(request);
  const language = resolveLanguage(locale);
  const linguiCatalog = await loadLinguiCatalogForRequest(request, language);
  const reportI18n = setupI18n();
  reportI18n.load(language, linguiCatalog);
  reportI18n.activate(language);
  const netIncomeLabel = reportI18n._(msg`Net Income`);

  if (isMultiCompany && parentCurrency) {
    const consolidated = await getConsolidatedPeriodSeries(
      client,
      companyGroupId,
      selectedCompanyIds,
      parentCurrency,
      { buckets, includeCurrentYearEarnings: true, netIncomeLabel }
    );

    if (consolidated.error || !consolidated.data) {
      throw redirect(
        path.to.accounting,
        await flash(
          request,
          error(consolidated.error, "Failed to load balance sheet")
        )
      );
    }

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
      fiscalStartMonth,
      isCompanySourceComplete,
      isExportSourceComplete: isCompanySourceComplete && consolidated.isComplete
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
      netIncomeLabel,
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
    fiscalStartMonth,
    isCompanySourceComplete,
    isExportSourceComplete: isCompanySourceComplete && series.isComplete
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
    fiscalStartMonth,
    isCompanySourceComplete,
    isExportSourceComplete
  } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const { t } = useLingui();
  const { locale } = useLocale();
  const canDownload = canExportFilteredReport(
    balanceSheet,
    search,
    isExportSourceComplete
  );

  const onDownload = () => {
    if (!canDownload) return;
    exportPeriodReport({
      accounts: balanceSheet,
      periods: periods.map((bucket) => ({
        ...bucket,
        label:
          getPeriodColumnLabel(bucket, columns, locale) +
          (bucket.isPartial ? ` (${t`To Date`})` : "")
      })),
      measure: "balanceAtDate",
      showTranslated,
      search,
      filename: "balance-sheet.csv",
      isSourceComplete: isExportSourceComplete,
      labels: { number: t`Number`, account: t`Account` }
    });
  };

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyIds={selectedCompanyIds}
        isCompanySourceComplete={isCompanySourceComplete}
        isMultiCompany={isMultiCompany}
        isForeignCurrency={isForeignCurrency}
        parentCurrency={parentCurrency}
        periodVariant="range"
        fiscalStartMonth={fiscalStartMonth}
        showColumns
        onDownload={onDownload}
        isDownloadDisabled={!canDownload}
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
