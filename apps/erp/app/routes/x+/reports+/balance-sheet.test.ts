import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCompaniesInGroup,
  getFinancialStatementPeriodSeries,
  getFiscalYearSettings
} from "~/modules/accounting";
import { getConsolidatedPeriodSeriesForReport } from "~/modules/accounting/accounting.ee.server";
import type { ChartPeriodSeries } from "~/modules/accounting/types";
import { NET_INCOME_ACCOUNT_ID } from "~/modules/accounting/types";
import { exportPeriodReport } from "~/modules/accounting/ui/Reports/exportReport";
import { loader } from "./balance-sheet";

vi.mock("@carbon/auth", () => ({
  error: (cause: unknown, message: string) => ({
    cause,
    message,
    success: false
  }),
  getAppUrl: () => "http://localhost",
  getMESUrl: () => "http://localhost",
  CARBON_API_URL: "http://localhost"
}));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions: vi.fn() }));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({}))
}));
vi.mock("@carbon/react", () => ({ VStack: () => null }));
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("~/modules/settings", () => ({ getNextSequence: vi.fn() }));
vi.mock("@carbon/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (term: string) => term,
  terms: {}
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
  getCompanyTimeZone: vi.fn(async () => "America/New_York")
}));
vi.mock("~/modules/accounting", async () => ({
  ...(await import("~/modules/accounting/accounting.ee.service")),
  ...(await import("~/modules/accounting/accounting.models")),
  getCompaniesInGroup: vi.fn(),
  getFinancialStatementPeriodSeries: vi.fn(),
  getFiscalYearSettings: vi.fn()
}));
vi.mock("~/modules/accounting/accounting.ee.server", async () => ({
  ...(await vi.importActual("~/modules/accounting/accounting.ee.server")),
  getConsolidatedPeriodSeriesForReport: vi.fn()
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("~/modules/accounting/ui/Reports", () => ({
  exportPeriodReport: vi.fn(),
  getPeriodColumnLabel: vi.fn(),
  MultiPeriodStatementTree: () => null,
  ReportFilters: () => null
}));

const keys = ["2026-07", "2026-08"];
const companies = [
  {
    id: "parent",
    name: "Parent",
    baseCurrencyCode: "USD",
    parentCompanyId: null,
    timezone: "America/New_York",
    isEliminationEntity: false
  },
  {
    id: "child",
    name: "Child",
    baseCurrencyCode: "EUR",
    parentCompanyId: "parent",
    timezone: "Europe/Berlin",
    isEliminationEntity: false
  }
];

function account(
  id: string,
  parentId: string | null,
  accountClass: ChartPeriodSeries["class"],
  amounts: number[],
  extra: Partial<ChartPeriodSeries> = {}
): ChartPeriodSeries {
  return {
    id,
    parentId,
    class: accountClass,
    name: id,
    number: null,
    active: true,
    companyGroupId: "group",
    isGroup: false,
    isSystem: false,
    incomeBalance: "Balance Sheet",
    accountType: "Equity - No Close",
    consolidatedRate: "Current",
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: "user",
    updatedAt: null,
    updatedBy: null,
    customFields: {},
    tags: null,
    periods: Object.fromEntries(
      keys.map((key, index) => [
        key,
        {
          balanceAtDate: 0,
          netChange: 0,
          translatedBalance: amounts[index] ?? 0,
          translatedNetChange: amounts[index] ?? 0
        }
      ])
    ),
    ...extra
  };
}

function chart(bookedCta = 0): ChartPeriodSeries[] {
  return [
    account("balance-sheet", null, "Asset", [40, 20], {
      isGroup: true,
      isSystem: true
    }),
    account(
      "assets",
      "balance-sheet",
      "Asset",
      [160 + bookedCta, 80 + bookedCta],
      { isGroup: true }
    ),
    account("cash", "assets", "Asset", [160 + bookedCta, 80 + bookedCta]),
    account(
      "equity",
      "balance-sheet",
      "Equity",
      [120 + bookedCta, 60 + bookedCta],
      { isGroup: true }
    ),
    account("reserves", "equity", "Equity", [bookedCta, bookedCta], {
      isGroup: true
    }),
    account("custom-cta", "reserves", "Equity", [bookedCta, bookedCta], {
      name: "FX Reserve Renamed",
      number: "3999"
    }),
    account("child-cta", "reserves", "Equity", [0, 0], { number: "3200" }),
    account(NET_INCOME_ACCOUNT_ID, "equity", "Equity", [120, 60]),
    account("income-statement", null, "Revenue", [120, 60], {
      incomeBalance: "Income Statement",
      isGroup: true,
      isSystem: true
    }),
    account("sales", "income-statement", "Revenue", [150, 75], {
      incomeBalance: "Income Statement"
    }),
    account("expense", "income-statement", "Expense", [30, 15], {
      incomeBalance: "Income Statement"
    })
  ];
}

let sourceChart: ChartPeriodSeries[];
let defaults: Record<string, string | null>;
let defaultError: { message: string } | null;
let rootGroup: string;
let rootParent: string | null;
let client: SupabaseClient<Database>;
let reads: Array<{ table: string; filters: Record<string, unknown> }>;

beforeEach(() => {
  vi.clearAllMocks();
  sourceChart = chart();
  defaults = { parent: "custom-cta", child: "child-cta" };
  defaultError = null;
  rootGroup = "group";
  rootParent = null;
  reads = [];
  client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (field: string, value: unknown) => {
          filters[field] = value;
          return builder;
        },
        is: (field: string, value: unknown) => {
          filters[field] = value;
          return builder;
        },
        single: async () => {
          reads.push({ table, filters: { ...filters } });
          if (table === "company") {
            const row = {
              id: "parent",
              companyGroupId: rootGroup,
              parentCompanyId: rootParent
            };
            const visible = Object.entries(filters).every(
              ([key, value]) => row[key as keyof typeof row] === value
            );
            return {
              data: visible ? { id: row.id } : null,
              error: visible
                ? null
                : { message: "Root company is not in the authorized group" }
            };
          }
          if (table === "accountDefault") {
            return {
              data: {
                currencyTranslationAccount: defaults[String(filters.companyId)]
              },
              error: defaultError
            };
          }
          if (table === "account") {
            const data =
              sourceChart.find(
                (row) =>
                  row.id === filters.id &&
                  row.companyGroupId === filters.companyGroupId
              ) ?? null;
            return { data, error: null };
          }
          throw new Error(`Unexpected table ${table}`);
        }
      };
      return builder;
    }
  } as unknown as SupabaseClient<Database>;
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "child",
    companyGroupId: "group",
    userId: "user"
  } as Awaited<ReturnType<typeof requirePermissions>>);
  vi.mocked(getCompaniesInGroup).mockResolvedValue({
    data: companies,
    error: null
  } as Awaited<ReturnType<typeof getCompaniesInGroup>>);
  vi.mocked(getFiscalYearSettings).mockResolvedValue({
    data: { startMonth: "January" },
    error: null
  } as Awaited<ReturnType<typeof getFiscalYearSettings>>);
  vi.mocked(getFinancialStatementPeriodSeries).mockImplementation(async () => ({
    data: sourceChart,
    ctaByBucket: { "2026-07": 40, "2026-08": 20 },
    error: null
  }));
  vi.mocked(getConsolidatedPeriodSeriesForReport).mockImplementation(
    async () => ({
      data: sourceChart,
      ctaByBucket: { "2026-07": 40, "2026-08": 20 },
      error: null
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

function runLoader(
  companiesParam = "all",
  showTranslated = true,
  headers?: HeadersInit
) {
  const params = new URLSearchParams({
    companies: companiesParam,
    showTranslated: String(showTranslated),
    startDate: "2026-07-01",
    endDate: "2026-08-31"
  });
  return loader({
    request: new Request(`http://localhost/x/reports/balance-sheet?${params}`, {
      headers
    }),
    params: {},
    context: {}
  } as Parameters<typeof loader>[0]);
}

function amount(rows: ChartPeriodSeries[], id: string, key = "2026-07") {
  return rows.find((row) => row.id === id)?.periods[key]?.translatedBalance;
}

describe("balance sheet configured CTA", () => {
  it("translates a subsidiary for an accountant who cannot read parent defaults", async () => {
    const deniedClient = {
      from: () => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        single: async () => ({
          data: null,
          error: { message: "Parent defaults are not visible" }
        })
      })
    } as unknown as SupabaseClient<Database>;
    vi.mocked(requirePermissions).mockImplementation(
      async (_request, permissions) =>
        ({
          client: permissions.bypassRls ? client : deniedClient,
          companyId: "child",
          companyGroupId: "group",
          userId: "user"
        }) as Awaited<ReturnType<typeof requirePermissions>>
    );
    const result = await runLoader("child");
    expect(amount(result.balanceSheet, "custom-cta")).toBe(40);
    expect(amount(result.balanceSheet, "balance-sheet")).toBe(0);
    expect(reads).toContainEqual({
      table: "company",
      filters: { id: "parent", companyGroupId: "group", parentCompanyId: null }
    });
  });

  it.each([
    "cross-group",
    "non-root"
  ])("refuses %s configuration before reading defaults", async (caseName) => {
    if (caseName === "cross-group") rootGroup = "other-group";
    else rootParent = "another-parent";
    await expect(runLoader("child")).rejects.toMatchObject({ status: 302 });
    expect(reads.some((read) => read.table === "accountDefault")).toBe(false);
  });

  it("does not escalate an API key when auth returns an RLS client", async () => {
    defaultError = {
      message: "Parent defaults are not visible to this API key"
    };
    await expect(
      runLoader("child", true, { "carbon-key": "test-report-key" })
    ).rejects.toMatchObject({ status: 302 });
    expect(getCarbonServiceRole).not.toHaveBeenCalled();
  });

  it("does not read root configuration after permission denial", async () => {
    vi.mocked(requirePermissions).mockRejectedValue(
      new Response("Forbidden", { status: 403 })
    );
    await expect(runLoader("child")).rejects.toMatchObject({ status: 403 });
    expect(reads).toEqual([]);
  });

  it.each([
    "all",
    "child"
  ])("uses the reporting parent's renamed account and recomputes every total for %s", async (companySelection) => {
    const result = await runLoader(companySelection);
    expect(amount(result.balanceSheet, "custom-cta")).toBe(40);
    expect(amount(result.balanceSheet, "child-cta")).toBe(0);
    expect(amount(result.balanceSheet, "reserves")).toBe(40);
    expect(amount(result.balanceSheet, "equity")).toBe(160);
    expect(amount(result.balanceSheet, "balance-sheet")).toBe(0);
    expect(amount(result.balanceSheet, "equity", "2026-08")).toBe(80);
    expect(amount(result.balanceSheet, "balance-sheet", "2026-08")).toBe(0);
    expect(reads).toContainEqual({
      table: "accountDefault",
      filters: { companyId: "parent" }
    });
  });

  it("fills single-company translated synthetic income from the full income statement", async () => {
    const income = sourceChart.find((row) => row.id === NET_INCOME_ACCOUNT_ID)!;
    for (const key of keys) {
      income.periods[key] = { netChange: 80, balanceAtDate: 80 };
    }
    const result = await runLoader("child");
    expect(amount(result.balanceSheet, NET_INCOME_ACCOUNT_ID)).toBe(120);
    expect(amount(result.balanceSheet, "equity")).toBe(160);
    expect(amount(result.balanceSheet, "balance-sheet")).toBe(0);
  });

  it("preserves booked CTA and repeated calculations do not mutate the input chart", async () => {
    sourceChart = chart(10);
    const original = structuredClone(sourceChart);
    const first = await runLoader();
    const second = await runLoader();
    expect(amount(first.balanceSheet, "custom-cta")).toBe(50);
    expect(amount(first.balanceSheet, "equity")).toBe(170);
    expect(amount(first.balanceSheet, "balance-sheet")).toBe(0);
    expect(second.balanceSheet).toEqual(first.balanceSheet);
    expect(sourceChart).toEqual(original);
  });

  it.each([
    {
      label: "missing default",
      change: () => {
        defaults.parent = null;
      }
    },
    {
      label: "missing chart account",
      change: () => {
        defaults.parent = "missing";
      }
    },
    {
      label: "inactive",
      change: () => {
        sourceChart.find((row) => row.id === "custom-cta")!.active = false;
      }
    },
    {
      label: "group",
      change: () => {
        sourceChart.find((row) => row.id === "custom-cta")!.isGroup = true;
      }
    },
    {
      label: "wrong class",
      change: () => {
        sourceChart.find((row) => row.id === "custom-cta")!.class = "Revenue";
      }
    },
    {
      label: "wrong statement",
      change: () => {
        sourceChart.find((row) => row.id === "custom-cta")!.incomeBalance =
          "Income Statement";
      }
    },
    {
      label: "other company group",
      change: () => {
        sourceChart.find((row) => row.id === "custom-cta")!.companyGroupId =
          "other-group";
      }
    },
    {
      label: "missing period cell",
      change: () => {
        delete sourceChart.find((row) => row.id === "custom-cta")!.periods[
          "2026-08"
        ];
      }
    },
    {
      label: "default lookup failure",
      change: () => {
        defaultError = { message: "Default lookup failed" };
      }
    }
  ])("refuses $label without returning a partial report", async ({
    change
  }) => {
    change();
    await expect(runLoader()).rejects.toMatchObject({ status: 302 });
    expect(flash).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ success: false })
    );
  });

  it("propagates a subsidiary error before applying CTA", async () => {
    vi.mocked(getConsolidatedPeriodSeriesForReport).mockResolvedValue({
      data: null,
      ctaByBucket: {},
      error: "Source balances do not balance"
    });
    await expect(runLoader()).rejects.toMatchObject({ status: 302 });
    expect(reads).toEqual([]);
  });

  it("preserves the untranslated report without resolving CTA defaults", async () => {
    const original = structuredClone(sourceChart);
    const result = await runLoader("child", false);
    expect(result.showTranslated).toBe(false);
    expect(sourceChart).toEqual(original);
    expect(reads).toEqual([]);
  });

  it("exports the corrected leaf, intermediate equity group, and root values", async () => {
    const result = await runLoader();
    let downloaded: Blob | undefined;
    vi.stubGlobal("window", {
      URL: {
        createObjectURL: (blob: Blob) => {
          downloaded = blob;
          return "blob:report";
        },
        revokeObjectURL: vi.fn()
      }
    });
    vi.stubGlobal("document", {
      createElement: () => ({ click: vi.fn() }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() }
    });
    exportPeriodReport({
      accounts: result.balanceSheet,
      periods: result.periods.map((bucket) => ({
        ...bucket,
        label: bucket.key
      })),
      measure: "balanceAtDate",
      showTranslated: true,
      search: "",
      filename: "balance-sheet.csv"
    });
    const csv = await downloaded?.text();
    expect(csv).toContain("3999,FX Reserve Renamed,40,20");
    expect(csv).toContain(",reserves,40,20");
    expect(csv).toContain(",equity,160,80");
    expect(csv).toContain(",balance-sheet,0,0");
  });
});
