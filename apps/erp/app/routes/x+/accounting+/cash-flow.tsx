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
  getFiscalYearSettings,
  getReportViews
} from "~/modules/accounting";
import {
  CashFlowStatement,
  DownloadPdfButton,
  ExportReportButton,
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

  const [companies, fiscalYearSettings, reportViews] = await Promise.all([
    getCompaniesInGroup(client, companyGroupId),
    getFiscalYearSettings(client, companyId),
    getReportViews(client, companyId, userId, "cash-flow")
  ]);
  const views = reportViews.data;
  const fiscalStartMonth =
    months.indexOf(fiscalYearSettings.data?.startMonth ?? "January") + 1;
  const companiesList = companies.data ?? [];
  const parentCompany = companiesList.find((c) => !c.parentCompanyId);
  const parentCurrency = parentCompany?.baseCurrencyCode ?? null;

  // Constrain the requested company to the group the user actually belongs to
  // (companiesList is RLS-scoped to companyGroupId); fall back to the user's
  // own company for an unknown/foreign id rather than trusting the raw param.
  const companyIdSet = new Set(companiesList.map((c) => c.id));
  const selectedCompanyIds =
    companiesParam === "all"
      ? companiesList.map((c) => c.id)
      : companiesParam && companyIdSet.has(companiesParam)
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
      fiscalStartMonth,
      views
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
    fiscalStartMonth,
    views
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
    fiscalStartMonth,
    views
  } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");

  const csvRows: { section: string; name: string; amount: number }[] = [
    { section: "Operating", name: "Net Income", amount: statement.netIncome },
    ...statement.operating.map((l) => ({
      section: "Operating",
      name: l.name,
      amount: l.amount
    })),
    {
      section: "Operating",
      name: "Net cash from operating activities",
      amount: statement.operatingTotal
    },
    ...statement.investing.map((l) => ({
      section: "Investing",
      name: l.name,
      amount: l.amount
    })),
    {
      section: "Investing",
      name: "Net cash from investing activities",
      amount: statement.investingTotal
    },
    ...statement.financing.map((l) => ({
      section: "Financing",
      name: l.name,
      amount: l.amount
    })),
    {
      section: "Financing",
      name: "Net cash from financing activities",
      amount: statement.financingTotal
    },
    ...statement.unclassified.map((l) => ({
      section: "Unclassified",
      name: l.name,
      amount: l.amount
    })),
    ...(statement.effectOfExchangeRates !== undefined
      ? [
          {
            section: "FX",
            name: "Effect of exchange rate changes on cash",
            amount: statement.effectOfExchangeRates
          }
        ]
      : []),
    {
      section: "Cash",
      name: "Net change in cash",
      amount: statement.netChangeInCash
    },
    {
      section: "Cash",
      name: "Cash at beginning of period",
      amount: statement.beginningCash
    },
    {
      section: "Cash",
      name: "Cash at end of period",
      amount: statement.endingCash
    }
  ];
  const csvName = `cash-flow-${
    endDate || new Date().toISOString().split("T")[0]
  }.csv`;

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyIds={selectedCompanyIds}
        isMultiCompany={isMultiCompany}
        parentCurrency={parentCurrency}
        periodVariant="range"
        fiscalStartMonth={fiscalStartMonth}
        report="cash-flow"
        views={views}
        actions={
          <>
            <ExportReportButton rows={csvRows} filename={csvName} />
            <DownloadPdfButton />
          </>
        }
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
