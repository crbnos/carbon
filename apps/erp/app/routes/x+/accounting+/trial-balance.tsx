import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import type { Chart, TrialBalanceRow } from "~/modules/accounting";
import {
  getCompaniesInGroup,
  getConsolidatedBalances,
  getFinancialStatementBalances,
  getFiscalYearSettings,
  getTrialBalance,
  translateCompanyBalances
} from "~/modules/accounting";
import {
  ReportFilters,
  TrialBalanceTable,
  TrialBalanceTree
} from "~/modules/accounting/ui/Reports";
import { months } from "~/modules/shared";
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
  const searchParams = new URLSearchParams(url.search);
  const companiesParam = searchParams.get("companies");
  const startDate = searchParams.get("startDate") || null;
  const endDate = searchParams.get("endDate") || null;
  const showTranslated = searchParams.get("showTranslated") === "true";

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

    return {
      mode: "tree" as const,
      trialBalance: consolidated.data as (Chart & {
        translatedBalance?: number;
        exchangeRate?: number;
      })[],
      trialBalanceRows: [] as TrialBalanceRow[],
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
  const selectedCompany = companiesList.find((c) => c.id === selectedCompanyId);
  const isForeignCurrency =
    !!parentCurrency &&
    !!selectedCompany?.baseCurrencyCode &&
    selectedCompany.baseCurrencyCode !== parentCurrency;

  // Default single-company view: the four-column trial balance (SAP F0996 handoff
  // form) from the extended RPC. The grouped tree is kept only for the translated
  // view, which the flat four-column RPC does not compute.
  if (!(showTranslated && isForeignCurrency)) {
    const rows = await getTrialBalance(
      client,
      companyGroupId,
      selectedCompanyId,
      {
        startDate,
        endDate
      }
    );
    if (rows.error) {
      throw redirect(
        path.to.accounting,
        await flash(request, error(rows.error, "Failed to load trial balance"))
      );
    }
    return {
      mode: "table" as const,
      trialBalance: [] as (Chart & {
        translatedBalance?: number;
        exchangeRate?: number;
      })[],
      trialBalanceRows: (rows.data ?? []) as unknown as TrialBalanceRow[],
      companies: companiesList,
      selectedCompanyIds,
      showTranslated: false,
      isMultiCompany: false,
      isForeignCurrency,
      parentCurrency,
      fiscalStartMonth
    };
  }

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

  let accounts = (balances.data ?? []) as (Chart & {
    translatedBalance?: number;
    exchangeRate?: number;
  })[];

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
    mode: "tree" as const,
    trialBalance: accounts,
    trialBalanceRows: [] as TrialBalanceRow[],
    companies: companiesList,
    selectedCompanyIds,
    showTranslated: showTranslated && isForeignCurrency,
    isMultiCompany: false,
    isForeignCurrency,
    parentCurrency,
    fiscalStartMonth
  };
}

export default function TrialBalanceRoute() {
  const {
    mode,
    trialBalance,
    trialBalanceRows,
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
        search={search}
        onSearchChange={setSearch}
      />
      {mode === "table" ? (
        <TrialBalanceTable
          data={trialBalanceRows}
          count={trialBalanceRows.length}
        />
      ) : (
        <TrialBalanceTree
          data={trialBalance}
          showTranslated={showTranslated}
          parentCurrency={parentCurrency}
          search={search}
          ledgerPath={path.to.trialBalanceLedger}
        />
      )}
      <Outlet />
    </VStack>
  );
}
