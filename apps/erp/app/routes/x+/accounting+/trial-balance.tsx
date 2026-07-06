import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import type { Chart } from "~/modules/accounting";
import {
  getCompaniesInGroup,
  getConsolidatedBalances,
  getFinancialStatementBalances,
  translateCompanyBalances
} from "~/modules/accounting";
import {
  ReportFilters,
  TrialBalanceTree
} from "~/modules/accounting/ui/Reports";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Trial Balance",
  to: path.to.trialBalance
};

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

  const companies = await getCompaniesInGroup(client, companyGroupId);
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
      trialBalance: consolidated.data as (Chart & {
        translatedBalance?: number;
        exchangeRate?: number;
      })[],
      companies: companiesList,
      selectedCompanyIds,
      showTranslated: true,
      isMultiCompany: true,
      isForeignCurrency: false,
      parentCurrency
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

  if (showTranslated && isForeignCurrency && parentCurrency) {
    const periodEnd = endDate ?? new Date().toISOString().split("T")[0];
    const translation = await translateCompanyBalances(
      client,
      companyGroupId,
      selectedCompanyId!,
      parentCurrency,
      periodEnd,
      startDate ?? undefined
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
    showTranslated: showTranslated && isForeignCurrency,
    isMultiCompany: false,
    isForeignCurrency,
    parentCurrency
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
    parentCurrency
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
        search={search}
        onSearchChange={setSearch}
      />
      <TrialBalanceTree
        data={trialBalance}
        showTranslated={showTranslated}
        parentCurrency={parentCurrency}
        search={search}
      />
    </VStack>
  );
}
