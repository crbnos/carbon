import type { Database } from "@carbon/database";
import { computeReportPeriodBuckets } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// The settings/glossary barrels evaluate Lingui macros that Vitest does not
// transform. The real translation service needs neither dependency here.
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

import {
  applyCtaToReportPeriodSeries,
  getFinancialStatementPeriodSeries,
  translateCompanyBalances,
  translateCompanyPeriodSeries
} from "./accounting.ee.service";
import type { ChartPeriodSeries } from "./types";
import { NET_INCOME_ACCOUNT_ID } from "./types";

type Balance = Parameters<typeof translateCompanyBalances>[6][number];
type RpcResult = { data: unknown; error: { message: string } | null };
type RateArgs = {
  p_company_group_id: string;
  p_company_id: string;
  p_target_currency: string;
  p_period_end: string;
  p_period_start?: string;
};

const rates = {
  sourceCurrency: "EUR",
  closingRate: 1,
  averageRate: 1,
  historicalRate: 1
};

const balanced: Balance[] = [
  {
    id: "cash",
    balanceAtDate: 80,
    consolidatedRate: "Current",
    isGroup: false,
    class: "Asset"
  },
  {
    id: "sales",
    balanceAtDate: 100,
    consolidatedRate: "Average",
    isGroup: false,
    class: "Revenue"
  },
  {
    id: "expenses",
    balanceAtDate: 20,
    consolidatedRate: "Average",
    isGroup: false,
    class: "Expense"
  }
];

function makeRateClient(resolve: (args: RateArgs) => RpcResult) {
  const rpc = vi.fn(async (name: string, args: RateArgs) => {
    if (name !== "getConsolidationRates") {
      throw new Error(`Unexpected RPC: ${name}`);
    }
    return resolve(args);
  });
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

async function translate(
  balances: Balance[] = balanced,
  data: unknown = [rates]
) {
  const { client } = makeRateClient(() => ({ data, error: null }));
  return translateCompanyBalances(
    client,
    "group",
    "subsidiary",
    "USD",
    "2026-08-31",
    "2026-08-01",
    balances
  );
}

describe("translateCompanyBalances", () => {
  it("keeps a balanced income statement at zero CTA with identity rates", async () => {
    const result = await translate();
    expect(result.error).toBeNull();
    expect(result.cta).toBe(0);
    expect(result.data).toEqual([
      {
        accountId: "cash",
        localBalance: 80,
        translatedBalance: 80,
        exchangeRate: 1
      },
      {
        accountId: "sales",
        localBalance: 100,
        translatedBalance: 100,
        exchangeRate: 1
      },
      {
        accountId: "expenses",
        localBalance: 20,
        translatedBalance: 20,
        exchangeRate: 1
      }
    ]);
  });

  it("preserves negative asset balances in the debit-minus-credit sum", async () => {
    const result = await translate(
      balanced
        .filter((row) => row.id !== "sales")
        .map((row) =>
          row.id === "cash" ? { ...row, balanceAtDate: -20 } : row
        )
    );
    expect(result.error).toBeNull();
    expect(result.cta).toBe(0);
    expect(
      result.data?.find((row) => row.accountId === "cash")?.translatedBalance
    ).toBe(-20);
  });

  it("reports CTA 40 from closing cash 160 and translated income 120", async () => {
    const result = await translate(balanced, [
      { ...rates, closingRate: 2, averageRate: 1.5 }
    ]);
    expect(result.error).toBeNull();
    expect(result.cta).toBe(40);
    expect(result.data?.map((row) => row.translatedBalance)).toEqual([
      160, 150, 30
    ]);
  });

  it("subtracts liability and historical equity balances without changing their signs", async () => {
    const result = await translate(
      [
        {
          id: "cash",
          class: "Asset",
          balanceAtDate: 80,
          consolidatedRate: "Current",
          isGroup: false
        },
        {
          id: "payables",
          class: "Liability",
          balanceAtDate: 30,
          consolidatedRate: "Current",
          isGroup: false
        },
        {
          id: "capital",
          class: "Equity",
          balanceAtDate: 50,
          consolidatedRate: "Historical",
          isGroup: false
        }
      ],
      [{ ...rates, closingRate: 2, historicalRate: 1.5 }]
    );
    expect(result.error).toBeNull();
    expect(result.cta).toBe(25);
    expect(result.data?.map((row) => row.translatedBalance)).toEqual([
      160, 60, 75
    ]);
  });

  it("rejects a source imbalance instead of concealing it as CTA", async () => {
    const result = await translate(
      balanced.map((row) =>
        row.id === "cash" ? { ...row, balanceAtDate: 79 } : row
      )
    );
    expect(result).toEqual({
      data: null,
      cta: 0,
      error: expect.stringMatching(/source.*balanc/i)
    });
  });

  it("retains the existing 0.001 journal tolerance for source validation", async () => {
    const within = await translate(
      balanced.map((row) =>
        row.id === "cash" ? { ...row, balanceAtDate: 80.0005 } : row
      )
    );
    const outside = await translate(
      balanced.map((row) =>
        row.id === "cash" ? { ...row, balanceAtDate: 80.0015 } : row
      )
    );
    expect(within.error).toBeNull();
    expect(outside.error).toEqual(expect.stringMatching(/source.*balanc/i));
  });

  it.each([
    "Unknown",
    null
  ])("rejects invalid leaf account class %s", async (accountClass) => {
    const result = await translate(
      balanced.map((row) =>
        row.id === "cash" ? { ...row, class: accountClass } : row
      )
    );
    expect(result).toEqual({
      data: null,
      cta: 0,
      error: expect.stringMatching(/class.*cash|cash.*class/i)
    });
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ])("rejects nonfinite source balance %s", async (balanceAtDate) => {
    const result = await translate(
      balanced.map((row) =>
        row.id === "cash" ? { ...row, balanceAtDate } : row
      )
    );
    expect(result).toEqual({
      data: null,
      cta: 0,
      error: expect.stringMatching(/balanc.*cash|cash.*balanc/i)
    });
  });

  it("excludes groups and synthetic income before both validation and translation", async () => {
    const result = await translate(
      [
        ...balanced,
        {
          id: "group-header",
          class: null,
          balanceAtDate: Number.NaN,
          consolidatedRate: "Historical",
          isGroup: true
        },
        {
          id: NET_INCOME_ACCOUNT_ID,
          class: "Equity",
          balanceAtDate: 80,
          consolidatedRate: "Historical",
          isGroup: false
        }
      ],
      [{ ...rates, historicalRate: null }]
    );
    expect(result.error).toBeNull();
    expect(result.cta).toBe(0);
    expect(result.data).toHaveLength(3);
  });

  it.each([
    { label: "null", payload: null },
    { label: "undefined", payload: undefined },
    { label: "empty array", payload: [] },
    { label: "empty object", payload: {} },
    { label: "null row", payload: [null] }
  ])("rejects empty or malformed rate payload $label", async ({ payload }) => {
    const { client } = makeRateClient(() => ({ data: payload, error: null }));
    const result = await translateCompanyBalances(
      client,
      "group",
      "subsidiary",
      "USD",
      "2026-08-31",
      undefined,
      balanced
    );
    expect(result).toEqual({
      data: null,
      cta: 0,
      error: expect.stringMatching(/rate|currency/i)
    });
  });

  it.each([
    null,
    "",
    "   "
  ])("rejects missing source currency %j", async (sourceCurrency) => {
    const result = await translate(balanced, [{ ...rates, sourceCurrency }]);
    expect(result).toEqual({
      data: null,
      cta: 0,
      error: expect.stringMatching(/source currency/i)
    });
  });

  it.each([
    null,
    undefined,
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY
  ])("rejects invalid applicable rate %s", async (closingRate) => {
    const result = await translate(balanced, [{ ...rates, closingRate }]);
    expect(result).toEqual({
      data: null,
      cta: 0,
      error: expect.stringMatching(/rate/i)
    });
  });

  it.each([
    "Average",
    "Historical"
  ])("validates applicable %s rates", async (consolidatedRate) => {
    const result = await translate(
      balanced.map((row) => ({ ...row, consolidatedRate })),
      [{ ...rates, averageRate: 0, historicalRate: Number.NaN }]
    );
    expect(result).toEqual({
      data: null,
      cta: 0,
      error: expect.stringMatching(/rate/i)
    });
  });

  it("uses identity when the source currency equals the requested currency", async () => {
    const result = await translate(balanced, [
      { ...rates, sourceCurrency: "USD", closingRate: 2, averageRate: 1.5 }
    ]);
    expect(result.error).toBeNull();
    expect(result.cta).toBe(0);
    expect(result.data?.map((row) => row.exchangeRate)).toEqual([1, 1, 1]);
  });

  it("propagates a missing-pair RPC error with its original message", async () => {
    const { client } = makeRateClient(() => ({
      data: null,
      error: { message: "No exchange rate for EUR/USD" }
    }));
    const result = await translateCompanyBalances(
      client,
      "group",
      "subsidiary",
      "USD",
      "2026-08-31",
      undefined,
      balanced
    );
    expect(result).toEqual({
      data: null,
      cta: 0,
      error: "No exchange rate for EUR/USD"
    });
  });
});

describe("translateCompanyPeriodSeries", () => {
  const buckets = computeReportPeriodBuckets(
    "2026-07-01",
    "2026-08-31",
    "month",
    1
  );
  const series = balanced.map(({ balanceAtDate, ...row }) => ({
    ...row,
    periods: Object.fromEntries(
      buckets.map((bucket) => [
        bucket.key,
        { balanceAtDate, netChange: balanceAtDate }
      ])
    )
  }));

  it("selects rates by the company and period arguments for concurrent buckets", async () => {
    const { client, rpc } = makeRateClient((args) => ({
      data: [
        {
          ...rates,
          closingRate: args.p_period_end === "2026-08-31" ? 2 : 1,
          averageRate: args.p_period_end === "2026-08-31" ? 1.5 : 1
        }
      ],
      error: null
    }));
    const result = await translateCompanyPeriodSeries(
      client,
      "group",
      "subsidiary",
      "USD",
      buckets,
      series
    );
    expect(result.error).toBeNull();
    expect(result.byBucket["2026-07"]?.cta).toBe(0);
    expect(result.byBucket["2026-08"]?.cta).toBe(40);
    for (const bucket of buckets) {
      expect(rpc).toHaveBeenCalledWith("getConsolidationRates", {
        p_company_group_id: "group",
        p_company_id: "subsidiary",
        p_target_currency: "USD",
        p_period_end: bucket.end,
        p_period_start: bucket.start
      });
    }
  });

  it("returns no partial report when one bucket has no rate payload", async () => {
    const { client } = makeRateClient((args) => ({
      data: args.p_period_end === "2026-08-31" ? [] : [rates],
      error: null
    }));
    const result = await translateCompanyPeriodSeries(
      client,
      "group",
      "subsidiary",
      "USD",
      buckets,
      series
    );
    expect(result).toEqual({
      byBucket: {},
      error: expect.stringMatching(/rate|currency/i)
    });
  });
});

describe("single-company period series and configured CTA", () => {
  it("derives translated synthetic income, then rolls CTA into Equity without changing source cells", async () => {
    const buckets = computeReportPeriodBuckets(
      "2026-08-01",
      "2026-08-31",
      "month",
      1
    );
    const row = (
      id: string,
      parentId: string | null,
      accountClass: ChartPeriodSeries["class"],
      extra: Partial<ChartPeriodSeries> = {}
    ) => ({
      id,
      parentId,
      class: accountClass,
      companyGroupId: "group",
      active: true,
      isGroup: false,
      isSystem: false,
      incomeBalance: "Balance Sheet",
      consolidatedRate: "Current",
      ...extra
    });
    const chart = [
      row("balance-sheet", null, "Asset", { isGroup: true, isSystem: true }),
      row("assets", "balance-sheet", "Asset", { isGroup: true }),
      row("cash", "assets", "Asset"),
      row("equity", "balance-sheet", "Equity", { isGroup: true }),
      row("reserves", "equity", "Equity", { isGroup: true }),
      row("custom-cta", "reserves", "Equity", {
        number: "3999",
        name: "Renamed FX Reserve"
      }),
      row("income-statement", null, "Revenue", {
        isGroup: true,
        isSystem: true,
        incomeBalance: "Income Statement"
      }),
      row("sales", "income-statement", "Revenue", {
        consolidatedRate: "Average",
        incomeBalance: "Income Statement"
      }),
      row("expenses", "income-statement", "Expense", {
        consolidatedRate: "Average",
        incomeBalance: "Income Statement"
      })
    ];
    const client = {
      rpc(name: string, args: RateArgs) {
        if (name === "getConsolidationRates") {
          expect(args.p_company_id).toBe("subsidiary");
          expect(args.p_target_currency).toBe("USD");
          return Promise.resolve({
            data: [{ ...rates, closingRate: 2, averageRate: 1.5 }],
            error: null
          });
        }
        if (name === "accountTreeBalancePeriodSeries") {
          return Promise.resolve({
            data: balanced.map((account) => ({
              accountId: account.id,
              periodEnd: "2026-08-31",
              netChange: account.balanceAtDate,
              balanceAtDate: account.balanceAtDate
            })),
            error: null
          });
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const builder = {
          select: () => builder,
          eq: (field: string, value: unknown) => {
            filters[field] = value;
            return builder;
          },
          order: () => builder,
          single: async () => {
            expect(table).toBe("accountDefault");
            expect(filters.companyId).toBe("parent");
            return {
              data: { currencyTranslationAccount: "custom-cta" },
              error: null
            };
          },
          then: (resolve: (value: unknown) => unknown) => {
            expect(table).toBe("accounts");
            expect(filters.companyGroupId).toBe("group");
            return resolve({ data: chart, error: null });
          }
        };
        return builder;
      }
    } as unknown as SupabaseClient<Database>;

    const source = await getFinancialStatementPeriodSeries(
      client,
      "group",
      "subsidiary",
      {
        buckets,
        includeCurrentYearEarnings: true,
        translate: { targetCurrency: "USD" }
      }
    );
    expect(source.error).toBeNull();
    expect(source.ctaByBucket).toEqual({ "2026-08": 40 });
    if (!source.data) throw new Error("Missing source report");
    const original = structuredClone(source.data);
    const args = {
      accounts: source.data,
      bucketKeys: ["2026-08"],
      ctaByBucket: source.ctaByBucket
    };
    const adjusted = await applyCtaToReportPeriodSeries(
      client,
      "group",
      "parent",
      args
    );
    const repeated = await applyCtaToReportPeriodSeries(
      client,
      "group",
      "parent",
      args
    );
    expect(adjusted.error).toBeNull();
    const cells = new Map(
      adjusted.data?.map((account) => [account.id, account.periods["2026-08"]])
    );
    expect(cells.get("cash")?.translatedBalance).toBe(160);
    expect(cells.get(NET_INCOME_ACCOUNT_ID)).toMatchObject({
      balanceAtDate: 80,
      netChange: 80,
      translatedBalance: 120,
      translatedNetChange: 120
    });
    expect(cells.get("custom-cta")?.translatedBalance).toBe(40);
    expect(cells.get("reserves")?.translatedBalance).toBe(40);
    expect(cells.get("equity")?.translatedBalance).toBe(160);
    expect(cells.get("balance-sheet")?.translatedBalance).toBe(0);
    expect(repeated).toEqual(adjusted);
    expect(source.data).toEqual(original);
  });
});
