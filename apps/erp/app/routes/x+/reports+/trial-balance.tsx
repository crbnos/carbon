import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { datetime, defaultReportRange } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import type { Chart } from "~/modules/accounting";
import {
  financialReportParamsValidator,
  getCompaniesInGroup,
  getFinancialStatementBalances,
  getFiscalYearSettings,
  translateCompanyBalances
} from "~/modules/accounting";
import { getConsolidatedBalancesForReport } from "~/modules/accounting/accounting.ee.server";
import {
  exportTrialBalance,
  ReportFilters,
  TrialBalanceTree
} from "~/modules/accounting/ui/Reports";
import { months } from "~/modules/shared";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { revalidateIgnoringOffset } from "~/utils/revalidate";

export const handle: Handle = {
  breadcrumb: msg`Trial Balance`,
  to: path.to.trialBalance
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

  // Default to the trailing six months, matching every other range report
  // (previously trial balance alone defaulted to all-time).
  const range = defaultReportRange(
    endDateParam ??
      datetime.today(await getCompanyTimeZone(client, companyId)).toString()
  );
  const startDate = startDateParam ?? range.startDate;
  const endDate = endDateParam ?? range.endDate;

  if (isMultiCompany && parentCurrency) {
    const consolidated = await getConsolidatedBalancesForReport(
      client,
      companyGroupId,
      selectedCompanyIds,
      parentCurrency,
      endDate,
      startDate
    );

    return {
      trialBalance: consolidated.data as (Chart & {
        translatedBalance?: number;
        exchangeRate?: number;
      })[],
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
        error(balances.error, "Failed to load trial balance")
      )
    );
  }

  const selectedCompany = companiesList.find((c) => c.id === selectedCompanyId);
  const isForeignCurrency =
    !!parentCurrency &&
    !!selectedCompany?.baseCurrencyCode &&
    selectedCompany.baseCurrencyCode !== parentCurrency;

  let accounts = (balances.data ?? []) as (Chart & {
    translatedBalance?: number;
    exchangeRate?: number;
  })[];

  if (showTranslatedParam && isForeignCurrency && parentCurrency) {
    const translation = await translateCompanyBalances(
      client,
      companyGroupId,
      selectedCompanyId!,
      parentCurrency,
      endDate,
      startDate,
      balances.data ?? []
    );

    if (translation.data) {
      const translationMap = new Map(
        translation.data.map((t) => [t.accountId, t])
      );

      accounts = accounts.map((account) => {
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

  return {
    trialBalance: accounts,
    companies: companiesList,
    selectedCompanyIds,
    showTranslated: showTranslatedParam && isForeignCurrency,
    isMultiCompany: false,
    isForeignCurrency,
    parentCurrency,
    fiscalStartMonth
  };
}

export default function TrialBalanceRoute() {
  const {
    trialBalance,
    companies,
    selectedCompanyIds,
    showTranslated,
    isMultiCompany,
    isForeignCurrency,
    parentCurrency,
    fiscalStartMonth
  } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyIds={selectedCompanyIds}
        isMultiCompany={isMultiCompany}
        isForeignCurrency={isForeignCurrency}
        parentCurrency={parentCurrency}
        fiscalStartMonth={fiscalStartMonth}
        onDownload={() =>
          exportTrialBalance({
            accounts: trialBalance,
            showTranslated,
            parentCurrency,
            search,
            filename: "trial-balance.csv"
          })
        }
        search={search}
        onSearchChange={setSearch}
      />
      <TrialBalanceTree
        data={trialBalance}
        showTranslated={showTranslated}
        parentCurrency={parentCurrency}
        search={search}
        ledgerPath={path.to.trialBalanceLedger}
      />
      <Outlet />
    </VStack>
  );
}
