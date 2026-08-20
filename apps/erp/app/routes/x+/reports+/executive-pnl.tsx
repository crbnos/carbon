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
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  financialReportParamsValidator,
  getCompaniesInGroup,
  getFinancialStatementPeriodSeries,
  getFiscalYearSettings
} from "~/modules/accounting";
import { getConsolidatedPeriodSeriesForReport } from "~/modules/accounting/accounting.ee.server";
import type { ExecutivePnlRowKey } from "~/modules/accounting/ui/Reports";
import {
  ExecutivePnlSummary,
  exportExecutivePnl,
  getPeriodColumnLabel,
  ReportFilters
} from "~/modules/accounting/ui/Reports";
import { months } from "~/modules/shared";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { revalidateIgnoringOffset } from "~/utils/revalidate";

export const handle: Handle = {
  breadcrumb: msg`Executive P&L`,
  to: path.to.executivePnl
};

export const shouldRevalidate = revalidateIgnoringOffset;

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
    const consolidated = await getConsolidatedPeriodSeriesForReport(
      client,
      companyGroupId,
      selectedCompanyIds,
      parentCurrency,
      { buckets }
    );

    return {
      incomeStatement: consolidated.data.filter(
        (a) => a.incomeBalance === "Income Statement"
      ),
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
      ...(showTranslated && parentCurrency
        ? { translate: { targetCurrency: parentCurrency } }
        : {})
    }
  );

  if (series.error) {
    throw redirect(
      path.to.accounting,
      await flash(request, error(series.error, "Failed to load executive P&L"))
    );
  }

  return {
    incomeStatement: (series.data ?? []).filter(
      (a) => a.incomeBalance === "Income Statement"
    ),
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

export default function ExecutivePnlRoute() {
  const {
    incomeStatement,
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
  const { t } = useLingui();
  const { locale } = useLocale();

  const labels: Record<ExecutivePnlRowKey, string> = {
    revenue: t`Revenue`,
    cogs: t`Cost of Sales`,
    grossProfit: t`Gross Profit`,
    operatingExpenses: t`Operating Expenses`,
    operatingIncome: t`Operating Income`,
    otherIncome: t`Other Income`,
    otherExpense: t`Other Expense`,
    tax: t`Income Tax`,
    netIncome: t`Net Income`
  };

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
        showSearch={false}
        onDownload={() =>
          exportExecutivePnl({
            accounts: incomeStatement,
            periods: periods.map((bucket) => ({
              ...bucket,
              label:
                getPeriodColumnLabel(bucket, columns, locale) +
                (bucket.isPartial ? " (To Date)" : "")
            })),
            labels,
            showTranslated,
            filename: "executive-pnl.csv"
          })
        }
      />
      <ExecutivePnlSummary
        data={incomeStatement}
        periods={periods}
        columns={columns}
        showTranslated={showTranslated}
        parentCurrency={parentCurrency}
      />
    </VStack>
  );
}
