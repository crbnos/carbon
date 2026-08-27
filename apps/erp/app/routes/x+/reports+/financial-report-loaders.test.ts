import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCompaniesInGroup,
  getConsolidatedBalances,
  getConsolidatedPeriodSeries,
  getFinancialStatementBalances,
  getFinancialStatementPeriodSeries,
  getFiscalYearSettings
} from "~/modules/accounting";
import { loader as balanceSheetLoader } from "./balance-sheet";
import { loader as executivePnlLoader } from "./executive-pnl";
import { loader as incomeStatementLoader } from "./income-statement";
import { loader as trialBalanceLoader } from "./trial-balance";

vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn(),
  error: vi.fn((cause: unknown, message: string) => ({ cause, message })),
  success: vi.fn()
}));

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));

vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({}))
}));

vi.mock("@carbon/react", () => ({
  VStack: vi.fn()
}));

vi.mock("@carbon/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@carbon/utils")>()),
  computeReportPeriodBuckets: vi.fn(() => []),
  datetime: { today: vi.fn(() => ({ toString: () => "2026-08-26" })) },
  defaultReportRange: vi.fn(() => ({
    startDate: "2026-03-01",
    endDate: "2026-08-26"
  }))
}));

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => strings[0]
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: vi.fn(() => ({ t: (value: unknown) => value }))
}));

vi.mock("@react-aria/i18n", () => ({
  useLocale: vi.fn(() => ({ locale: "en-US" }))
}));

vi.mock("~/modules/accounting", () => ({
  financialReportParamsValidator: {
    safeParse: vi.fn(() => ({
      success: true,
      data: { companies: "all", columns: "month", showTranslated: false }
    }))
  },
  getCompaniesInGroup: vi.fn(),
  getConsolidatedBalances: vi.fn(),
  getConsolidatedPeriodSeries: vi.fn(),
  getFinancialStatementBalances: vi.fn(),
  getFinancialStatementPeriodSeries: vi.fn(),
  getFiscalYearSettings: vi.fn()
}));

vi.mock("~/modules/accounting/ui/Reports", () => ({
  ExecutivePnlSummary: vi.fn(),
  MultiPeriodStatementTree: vi.fn(),
  ReportFilters: vi.fn(),
  TrialBalanceTree: vi.fn(),
  canExportExecutivePnl: vi.fn(),
  canExportFilteredReport: vi.fn(),
  exportExecutivePnl: vi.fn(),
  exportPeriodReport: vi.fn(),
  exportTrialBalance: vi.fn(),
  getPeriodColumnLabel: vi.fn()
}));

vi.mock("~/modules/shared", () => ({
  months: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ]
}));

vi.mock("~/modules/shared/timezone.server", () => ({
  getCompanyTimeZone: vi.fn(async () => "UTC")
}));

vi.mock("~/utils/path", () => ({
  path: { to: { accounting: "/x/accounting" } }
}));

vi.mock("~/utils/revalidate", () => ({
  revalidateIgnoringOffset: vi.fn()
}));

const loaders = [
  ["income statement", incomeStatementLoader],
  ["balance sheet", balanceSheetLoader],
  ["executive P&L", executivePnlLoader],
  ["trial balance", trialBalanceLoader]
] as const;

const rootCompany = {
  id: "company-root",
  name: "Root",
  baseCurrencyCode: "USD",
  parentCompanyId: null,
  isEliminationEntity: false
};
const childCompany = {
  id: "company-child",
  name: "Child",
  baseCurrencyCode: "USD",
  parentCompanyId: rootCompany.id,
  isEliminationEntity: false
};

type Company = {
  id: string;
  name: string;
  baseCurrencyCode: string | null;
  parentCompanyId: string | null;
  isEliminationEntity: boolean;
};

function companySource(companies: Company[] = [rootCompany, childCompany]) {
  return { data: companies, count: companies.length, error: null };
}

function request() {
  return new Request(
    "http://localhost/x/reports/income-statement?companies=all"
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client: {},
    companyId: childCompany.id,
    companyGroupId: "group-1",
    userId: "user-1"
  } as never);
  vi.mocked(getCompaniesInGroup).mockResolvedValue(companySource() as never);
  vi.mocked(getFiscalYearSettings).mockResolvedValue({
    data: { startMonth: "January" },
    error: null
  } as never);
  vi.mocked(getConsolidatedPeriodSeries).mockResolvedValue({
    data: [],
    ctaByBucket: {},
    isComplete: true,
    error: null
  } as never);
  vi.mocked(getConsolidatedBalances).mockResolvedValue({
    data: [],
    isComplete: true,
    error: null
  } as never);
  vi.mocked(getFinancialStatementPeriodSeries).mockResolvedValue({
    data: [],
    ctaByBucket: {},
    isComplete: true,
    error: null
  } as never);
  vi.mocked(getFinancialStatementBalances).mockResolvedValue({
    data: [],
    isComplete: true,
    error: null
  } as never);
});

describe("financial report loader completeness", () => {
  it.each(
    loaders
  )("%s redirects when all-company metadata contains only a visible child company", async (_name, loader) => {
    vi.mocked(getCompaniesInGroup).mockResolvedValue(
      companySource([childCompany]) as never
    );

    await expect(loader({ request: request() } as never)).rejects.toMatchObject(
      { status: 302 }
    );
    expect(getConsolidatedPeriodSeries).not.toHaveBeenCalled();
    expect(getConsolidatedBalances).not.toHaveBeenCalled();
    expect(getFinancialStatementPeriodSeries).not.toHaveBeenCalled();
    expect(getFinancialStatementBalances).not.toHaveBeenCalled();
  });

  it("passes current-year earnings through to consolidated balance sheet loading", async () => {
    await expect(
      balanceSheetLoader({ request: request() } as never)
    ).resolves.toMatchObject({ isMultiCompany: true });

    expect(getConsolidatedPeriodSeries).toHaveBeenCalledWith(
      {},
      "group-1",
      [rootCompany.id, childCompany.id],
      "USD",
      {
        buckets: [],
        includeCurrentYearEarnings: true,
        netIncomeLabel: "Net Income"
      }
    );
  });

  it.each(
    loaders
  )("%s redirects when all-company metadata omits the parent currency", async (_name, loader) => {
    vi.mocked(getCompaniesInGroup).mockResolvedValue(
      companySource([
        { ...rootCompany, baseCurrencyCode: null },
        childCompany
      ]) as never
    );

    await expect(loader({ request: request() } as never)).rejects.toMatchObject(
      { status: 302 }
    );
    expect(getConsolidatedPeriodSeries).not.toHaveBeenCalled();
    expect(getConsolidatedBalances).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "fiscal settings query error",
      result: {
        data: null,
        error: { code: "XX", message: "fiscal lookup failed" }
      }
    },
    {
      name: "fiscal settings null without explicit not-configured error",
      result: { data: null, error: null }
    }
  ])("each loader redirects for $name", async ({ result }) => {
    vi.mocked(getFiscalYearSettings).mockResolvedValue(result as never);

    for (const [_name, loader] of loaders) {
      await expect(
        loader({ request: request() } as never)
      ).rejects.toMatchObject({ status: 302 });
    }
    expect(getConsolidatedPeriodSeries).not.toHaveBeenCalled();
    expect(getConsolidatedBalances).not.toHaveBeenCalled();
    expect(getFinancialStatementPeriodSeries).not.toHaveBeenCalled();
    expect(getFinancialStatementBalances).not.toHaveBeenCalled();
  });

  it.each(
    loaders
  )("%s allows an explicit not-configured fiscal settings result", async (_name, loader) => {
    vi.mocked(getFiscalYearSettings).mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "No rows found" }
    } as never);

    await expect(
      loader({ request: request() } as never)
    ).resolves.toMatchObject({
      fiscalStartMonth: 1
    });
  });
});
