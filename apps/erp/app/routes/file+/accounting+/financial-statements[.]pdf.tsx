import { requirePermissions } from "@carbon/auth/auth.server";
import { ensureFont, FinancialStatementsPDF } from "@carbon/documents/pdf";
import { getLogger } from "@carbon/logger";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import {
  getCashFlowStatement,
  getCompaniesInGroup,
  getConsolidatedBalances,
  getConsolidatedCashFlowStatement,
  getFinancialStatementBalances,
  NET_INCOME_ACCOUNT_ID,
  type StatementRow
} from "~/modules/accounting";
import { getCompany } from "~/modules/settings";

const logger = getLogger("erp", "financial-statements", "pdf");

// Minimal shape needed to flatten the account tree — a structural subset of the
// accounting module's `Chart` rows returned by the balance services.
type FlattenAccount = {
  id: string;
  parentId: string | null;
  name: string | null;
  number: string | null;
  isGroup: boolean;
  isComputed?: boolean;
  balanceAtDate?: number;
  netChange?: number;
};

/**
 * Flatten the account tree to a depth-indented `StatementRow[]`, reproducing
 * `FinancialStatementTree.accountsToFlatTree` ordering (non-groups before
 * groups, the computed Net Income line last, otherwise by name) and depth from
 * the parent chain. `measure` picks the amount column: `balanceAtDate` for the
 * balance sheet (closing balance as of endDate), `netChange` for the income
 * statement (activity within the range).
 */
function flattenAccounts(
  accounts: FlattenAccount[],
  measure: "balanceAtDate" | "netChange"
): StatementRow[] {
  const byParent = new Map<string, FlattenAccount[]>();
  for (const a of accounts) {
    const key = a.parentId ?? "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(a);
  }

  const rows: StatementRow[] = [];

  function walk(parentId: string | null, depth: number) {
    const children = (byParent.get(parentId ?? "__root__") ?? []).sort(
      (a, b) => {
        const aIsGroup = a.isGroup ? 1 : 0;
        const bIsGroup = b.isGroup ? 1 : 0;
        if (aIsGroup !== bIsGroup) return aIsGroup - bIsGroup;
        if (a.id === NET_INCOME_ACCOUNT_ID) return 1;
        if (b.id === NET_INCOME_ACCOUNT_ID) return -1;
        return (a.name ?? "").localeCompare(b.name ?? "");
      }
    );
    for (const account of children) {
      rows.push({
        name: account.name ?? "",
        number: account.number,
        depth,
        amount: account[measure] ?? 0,
        isGroup: account.isGroup,
        isComputed: account.isComputed
      });
      walk(account.id, depth + 1);
    }
  }

  walk(null, 0);
  return rows;
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
  const searchParams = new URLSearchParams(url.search);
  const companiesParam = searchParams.get("companies");
  const startDate = searchParams.get("startDate") || null;
  const endDate = searchParams.get("endDate") || null;

  const companies = await getCompaniesInGroup(client, companyGroupId);
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

  let balanceSheet: StatementRow[] = [];
  let incomeStatement: StatementRow[] = [];
  let cashFlow: Awaited<ReturnType<typeof getCashFlowStatement>>["data"] = null;
  let displayCompanyId = selectedCompanyIds[0] ?? companyId;
  let currencyCode = "";

  if (isMultiCompany && parentCurrency) {
    const periodEnd = endDate ?? new Date().toISOString().split("T")[0];
    const [consolidated, consolidatedCashFlow] = await Promise.all([
      getConsolidatedBalances(
        client,
        companyGroupId,
        selectedCompanyIds,
        parentCurrency,
        periodEnd,
        startDate ?? undefined
      ),
      getConsolidatedCashFlowStatement(
        client,
        companyGroupId,
        selectedCompanyIds,
        parentCurrency,
        { startDate, endDate },
        companiesList.map((c) => ({
          id: c.id,
          baseCurrencyCode: c.baseCurrencyCode
        }))
      )
    ]);

    balanceSheet = flattenAccounts(
      consolidated.data.filter(
        (a) => a.incomeBalance === "Balance Sheet"
      ) as unknown as FlattenAccount[],
      "balanceAtDate"
    );
    incomeStatement = flattenAccounts(
      consolidated.data.filter(
        (a) => a.incomeBalance === "Income Statement"
      ) as unknown as FlattenAccount[],
      "netChange"
    );

    if (consolidatedCashFlow.error || !consolidatedCashFlow.data) {
      logger.error("Failed to load consolidated cash flow", {
        error: consolidatedCashFlow.error
      });
      throw new Error("Failed to load cash flow statement");
    }
    cashFlow = consolidatedCashFlow.data;
    currencyCode = parentCurrency;
    displayCompanyId = parentCompany?.id ?? displayCompanyId;
  } else {
    // NOTE: For a single foreign-currency company the on-screen statements honor
    // a `showTranslated` toggle (parent-currency translation via
    // `translateCompanyBalances`), but this PDF always renders base-currency
    // figures. Translated single-company export is a follow-up — it needs the
    // tree's translated group-subtotal recomputation, which the flat `flattenAccounts`
    // path here does not reproduce. Consolidated (multi-company) reports above are
    // already parent-currency.
    const selectedCompanyId = selectedCompanyIds[0] ?? companyId;
    displayCompanyId = selectedCompanyId;

    const [balances, cashFlowResult] = await Promise.all([
      getFinancialStatementBalances(client, companyGroupId, selectedCompanyId, {
        startDate,
        endDate,
        includeCurrentYearEarnings: true
      }),
      getCashFlowStatement(client, companyGroupId, selectedCompanyId, {
        startDate,
        endDate
      })
    ]);

    if (balances.error) {
      logger.error("Failed to load financial statement balances", {
        error: balances.error
      });
      throw new Error("Failed to load financial statements");
    }
    if (cashFlowResult.error || !cashFlowResult.data) {
      logger.error("Failed to load cash flow", {
        error: cashFlowResult.error
      });
      throw new Error("Failed to load cash flow statement");
    }

    balanceSheet = flattenAccounts(
      (balances.data ?? []).filter(
        (a) => a.incomeBalance === "Balance Sheet"
      ) as unknown as FlattenAccount[],
      "balanceAtDate"
    );
    incomeStatement = flattenAccounts(
      (balances.data ?? []).filter(
        (a) => a.incomeBalance === "Income Statement"
      ) as unknown as FlattenAccount[],
      "netChange"
    );
    cashFlow = cashFlowResult.data;

    const selectedCompany = companiesList.find(
      (c) => c.id === selectedCompanyId
    );
    currencyCode = selectedCompany?.baseCurrencyCode ?? parentCurrency ?? "";
  }

  // Resolve the display company's name + logo for the report header.
  const company = await getCompany(client, displayCompanyId);
  if (company.error) {
    logger.error("Failed to load company", { error: company.error });
  }
  const companyName = company.data?.name ?? "";
  const companyLogo = company.data?.logoLight ?? null;

  if (!cashFlow) {
    throw new Error("Failed to load cash flow statement");
  }

  await ensureFont("Inter");

  const stream = await renderToStream(
    <FinancialStatementsPDF
      company={{ name: companyName, logo: companyLogo }}
      currencyCode={currencyCode}
      startDate={startDate}
      endDate={endDate}
      balanceSheet={balanceSheet}
      incomeStatement={incomeStatement}
      cashFlow={cashFlow}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const filenameDate = endDate ?? new Date().toISOString().split("T")[0];
  // Strip characters that would break the quoted `filename` parameter — a
  // company name is DB-sourced and may contain a `"` or CR/LF.
  const safeCompanyName = companyName.replace(/["\r\n]/g, "");
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${safeCompanyName} - Financial Statements ${filenameDate}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
