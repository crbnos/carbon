import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getCashFlowStatement,
  getCompaniesInGroup,
  getConsolidatedCashFlowStatement,
  getFiscalYearSettings
} from "~/modules/accounting";
import {
  CashFlowStatement,
  ReportFilters
} from "~/modules/accounting/ui/Reports";
import { months } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { revalidateIgnoringOffset } from "~/utils/revalidate";

export const handle: Handle = {
  breadcrumb: msg`Cash Flow`,
  to: path.to.cashFlowStatement
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
    const consolidated = await getConsolidatedCashFlowStatement(
      client,
      companyGroupId,
      selectedCompanyIds,
      parentCurrency,
      { startDate, endDate },
      companiesList.map((c) => ({
        id: c.id,
        baseCurrencyCode: c.baseCurrencyCode
      }))
    );
    if (consolidated.error || !consolidated.data) {
      throw redirect(
        path.to.accounting,
        await flash(
          request,
          error(consolidated.error, "Failed to load cash flow statement")
        )
      );
    }
    return {
      statement: consolidated.data,
      companies: companiesList,
      selectedCompanyIds,
      isMultiCompany: true,
      parentCurrency,
      startDate,
      endDate,
      fiscalStartMonth
    };
  }

  const selectedCompanyId = selectedCompanyIds[0];
  const statement = await getCashFlowStatement(
    client,
    companyGroupId,
    selectedCompanyId,
    { startDate, endDate }
  );

  if (statement.error || !statement.data) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(statement.error, "Failed to load cash flow statement")
      )
    );
  }

  return {
    statement: statement.data,
    companies: companiesList,
    selectedCompanyIds,
    isMultiCompany: false,
    parentCurrency: null as string | null,
    startDate,
    endDate,
    fiscalStartMonth
  };
}

export default function CashFlowRoute() {
  const {
    statement,
    companies,
    selectedCompanyIds,
    isMultiCompany,
    parentCurrency,
    startDate,
    endDate,
    fiscalStartMonth
  } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyIds={selectedCompanyIds}
        isMultiCompany={isMultiCompany}
        parentCurrency={parentCurrency}
        periodVariant="range"
        fiscalStartMonth={fiscalStartMonth}
        search={search}
        onSearchChange={setSearch}
      />
      <CashFlowStatement
        statement={statement}
        startDate={startDate}
        endDate={endDate}
        currencyCode={isMultiCompany ? parentCurrency : null}
        includeCompanyFilter={!isMultiCompany}
      />
      <Outlet />
    </VStack>
  );
}
