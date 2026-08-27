import { describe, expect, it, vi } from "vitest";

vi.mock("~/modules/settings", () => ({
  getNextSequence: vi.fn()
}));

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
  getActiveDimensionsWithValues,
  getCompaniesInGroup,
  getConsolidatedBalances,
  getConsolidatedPeriodSeries,
  getDimensionPivot,
  getFinancialStatementBalances,
  getFinancialStatementPeriodSeries,
  getPurchaseLinePivot
} from "./accounting.service";

describe("getCompaniesInGroup", () => {
  it("requests an exact count so partial company metadata is detectable", async () => {
    const result = queryResult([]);
    const select = vi.fn(() => result);
    const client = {
      from: vi.fn(() => ({ select }))
    };

    await getCompaniesInGroup(client as never, "group-1");

    expect(select).toHaveBeenCalledWith(
      "id, name, baseCurrencyCode, timezone, parentCompanyId, isEliminationEntity",
      { count: "exact" }
    );
  });
});

function makeActiveDimensionsClient(options: {
  dimensions?: unknown[] | null;
  dimensionsError?: { message: string } | null;
  customValues?: unknown[] | null;
  customValuesError?: { message: string } | null;
  entityValues?: unknown[] | null;
  entityValuesError?: { message: string } | null;
}) {
  return {
    from(table: string) {
      if (table === "dimension") {
        return queryResult(
          options.dimensions === undefined
            ? [{ id: "dimension-1", entityType: "Custom" }]
            : options.dimensions,
          options.dimensionsError ?? null
        );
      }
      if (table === "dimensionValue") {
        return queryResult(
          options.customValues === undefined
            ? [
                {
                  id: "value-1",
                  name: "Value 1",
                  dimensionId: "dimension-1"
                }
              ]
            : options.customValues,
          options.customValuesError ?? null
        );
      }
      return queryResult(
        options.entityValues === undefined
          ? [{ id: "value-1", name: "Value 1" }]
          : options.entityValues,
        options.entityValuesError ?? null
      );
    }
  } as never;
}

describe("getActiveDimensionsWithValues", () => {
  it.each([
    {
      name: "top-level query error",
      client: makeActiveDimensionsClient({
        dimensions: null,
        dimensionsError: { message: "dimension lookup failed" }
      })
    },
    {
      name: "top-level null data",
      client: makeActiveDimensionsClient({ dimensions: null })
    },
    {
      name: "top-level row cap",
      client: makeActiveDimensionsClient({
        dimensions: new Array(1000).fill({
          id: "dimension",
          entityType: "Custom"
        })
      })
    }
  ])("fails closed for $name", async ({ client }) => {
    const result = await getActiveDimensionsWithValues(
      client,
      "group-1",
      "company-1"
    );

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it.each([
    {
      name: "custom value query error",
      client: makeActiveDimensionsClient({
        customValues: null,
        customValuesError: { message: "custom value lookup failed" }
      })
    },
    {
      name: "custom value null data",
      client: makeActiveDimensionsClient({ customValues: null })
    },
    {
      name: "custom value row cap",
      client: makeActiveDimensionsClient({
        customValues: new Array(1000).fill({
          id: "value",
          name: "Value",
          dimensionId: "dimension-1"
        })
      })
    }
  ])("fails closed for $name", async ({ client }) => {
    const result = await getActiveDimensionsWithValues(
      client,
      "group-1",
      "company-1"
    );

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it.each([
    {
      name: "entity value query error",
      client: makeActiveDimensionsClient({
        dimensions: [{ id: "dimension-1", entityType: "Location" }],
        entityValues: null,
        entityValuesError: { message: "entity value lookup failed" }
      })
    },
    {
      name: "entity value null data",
      client: makeActiveDimensionsClient({
        dimensions: [{ id: "dimension-1", entityType: "Location" }],
        entityValues: null
      })
    },
    {
      name: "entity value row cap",
      client: makeActiveDimensionsClient({
        dimensions: [{ id: "dimension-1", entityType: "Location" }],
        entityValues: new Array(1000).fill({ id: "location", name: "Location" })
      })
    }
  ])("fails closed for $name", async ({ client }) => {
    const result = await getActiveDimensionsWithValues(
      client,
      "group-1",
      "company-1"
    );

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

const bucket = {
  key: "2026-01",
  start: "2026-01-01",
  end: "2026-01-31",
  fiscalYear: 2026,
  isPartial: false
};

const account = {
  id: "sales",
  parentId: null,
  name: "Sales",
  number: "4000",
  active: true,
  isGroup: false,
  isSystem: false,
  incomeBalance: "Income Statement",
  class: "Revenue",
  consolidatedRate: "Average"
};

type ClientOptions = {
  accounts?: unknown[];
  accountDataNull?: boolean;
  balanceFailureCompanyId?: string;
  balanceDataNull?: boolean;
  balanceRowCount?: number;
  companyDataNull?: boolean;
  companyQueryFailure?: boolean;
  companyRowCount?: number;
  seriesDataNull?: boolean;
  seriesFailureCompanyId?: string;
  translationFailureCompanyId?: string;
  translationRatesData?: unknown;
  translationRatesByCompany?: Record<string, unknown>;
  periodSeriesRows?: Array<{
    accountId: string;
    periodEnd: string;
    netChange: number;
    balanceAtDate: number;
  }>;
  seriesByCompany?: Record<
    string,
    Array<{
      accountId: string;
      periodEnd: string;
      netChange: number;
      balanceAtDate: number;
    }>
  >;
  seriesRowCount?: number;
};

function queryResult<T>(data: T, error: { message: string } | null = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data, error });
  return builder;
}

function makeReportClient(options: ClientOptions = {}) {
  return {
    from(table: string) {
      if (table === "company") {
        if (options.companyQueryFailure) {
          return queryResult(null, { message: "company lookup failed" });
        }
        if (options.companyDataNull) return queryResult(null);
        return queryResult(
          new Array(options.companyRowCount ?? 2)
            .fill(null)
            .map((_, index) => ({
              id: `company-${index + 1}`,
              parentCompanyId: null,
              isEliminationEntity: false
            }))
        );
      }
      if (table === "accounts") {
        return options.accountDataNull
          ? queryResult(null)
          : queryResult(
              options.accounts ??
                (options.seriesByCompany
                  ? [
                      {
                        ...account,
                        id: "revenue-root",
                        name: "Revenue",
                        number: null,
                        isGroup: true,
                        isSystem: true,
                        parentId: null
                      },
                      { ...account, parentId: "revenue-root" }
                    ]
                  : [account])
            );
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const companyId = args.p_company_id as string;
      if (name === "accountTreeBalancesByCompany") {
        if (companyId === options.balanceFailureCompanyId) {
          return { data: null, error: { message: "balances failed" } };
        }
        if (options.balanceDataNull) return { data: null, error: null };
        const row = {
          accountId: account.id,
          number: account.number,
          netChange: 10,
          balance: 10,
          balanceAtDate: 10
        };
        return {
          data: new Array(options.balanceRowCount ?? 1).fill(row),
          error: null
        };
      }
      if (name === "accountTreeBalancePeriodSeries") {
        if (companyId === options.seriesFailureCompanyId) {
          return { data: null, error: { message: "series failed" } };
        }
        if (options.seriesDataNull) return { data: null, error: null };
        const row = {
          accountId: account.id,
          periodEnd: bucket.end,
          netChange: 10,
          balanceAtDate: 10
        };
        return {
          data:
            options.periodSeriesRows ??
            options.seriesByCompany?.[companyId] ??
            new Array(options.seriesRowCount ?? 1).fill(row),
          error: null
        };
      }
      if (name === "getConsolidationRates") {
        if (companyId === options.translationFailureCompanyId) {
          return { data: null, error: { message: "translation failed" } };
        }
        return {
          data:
            options.translationRatesByCompany?.[companyId] ??
            (options.translationRatesData === undefined
              ? {
                  sourceCurrency: "USD",
                  closingRate: 1,
                  averageRate: 1,
                  historicalRate: 1
                }
              : options.translationRatesData),
          error: null
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }
  } as never;
}

describe("financial statement period-series completeness", () => {
  it("marks a series incomplete when an RPC source reaches 1000 rows", async () => {
    const result = await getFinancialStatementPeriodSeries(
      makeReportClient({ seriesRowCount: 1000 }),
      "group-1",
      "company-1",
      { buckets: [bucket] }
    );

    expect(result.error).toBeNull();
    expect(result.isComplete).toBe(false);
  });

  it("fails closed when the period-series RPC returns null data without an error", async () => {
    const result = await getFinancialStatementPeriodSeries(
      makeReportClient({ seriesDataNull: true }),
      "group-1",
      "company-1",
      { buckets: [bucket] }
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain(
      "period-series source returned no data"
    );
  });
});

describe("financial statement balance completeness", () => {
  it("marks balances incomplete when a source reaches 1000 rows", async () => {
    const result = await getFinancialStatementBalances(
      makeReportClient({ balanceRowCount: 1000 }),
      "group-1",
      "company-1",
      { startDate: "2026-01-01", endDate: "2026-01-31" }
    );

    expect(result.error).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.data).not.toBeNull();
  });

  it("fails closed when the balance RPC returns null data without an error", async () => {
    const result = await getFinancialStatementBalances(
      makeReportClient({ balanceDataNull: true }),
      "group-1",
      "company-1",
      { startDate: "2026-01-01", endDate: "2026-01-31" }
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain("balance source returned no data");
  });

  it("fails closed when account metadata returns null data without an error", async () => {
    const result = await getFinancialStatementBalances(
      makeReportClient({ accountDataNull: true }),
      "group-1",
      "company-1",
      { startDate: "2026-01-01", endDate: "2026-01-31" }
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain(
      "account metadata source returned no data"
    );
  });
});

describe("getConsolidatedPeriodSeries", () => {
  it("fails closed when company resolution fails", async () => {
    const result = await getConsolidatedPeriodSeries(
      makeReportClient({ companyQueryFailure: true }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      { buckets: [bucket] }
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain("company lookup failed");
  });

  it("fails closed when company resolution reaches the PostgREST row cap", async () => {
    const result = await getConsolidatedPeriodSeries(
      makeReportClient({ companyRowCount: 1000 }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      { buckets: [bucket] }
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain("company resolution reached");
  });

  it("fails closed when company resolution returns null data", async () => {
    const result = await getConsolidatedPeriodSeries(
      makeReportClient({ companyDataNull: true }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      { buckets: [bucket] }
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain(
      "company resolution returned no data"
    );
  });

  it("returns no partial data when a company series fails", async () => {
    const result = await getConsolidatedPeriodSeries(
      makeReportClient({ seriesFailureCompanyId: "company-2" }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      { buckets: [bucket] }
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain("series failed");
  });

  it("returns no partial data when a company translation fails", async () => {
    const result = await getConsolidatedPeriodSeries(
      makeReportClient({ translationFailureCompanyId: "company-2" }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      { buckets: [bucket] }
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain("translation failed");
  });

  it("returns no partial data when consolidation rates are malformed", async () => {
    const result = await getConsolidatedPeriodSeries(
      makeReportClient({
        translationRatesData: {
          sourceCurrency: "USD",
          closingRate: null,
          averageRate: 1,
          historicalRate: 1
        }
      }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      { buckets: [bucket] }
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain("Consolidation rates");
  });

  it("includes current-year earnings in consolidated balance sheet results", async () => {
    const result = await getConsolidatedPeriodSeries(
      makeReportClient({
        accounts: [
          {
            id: "balance-sheet-root",
            parentId: null,
            name: "Balance Sheet",
            number: "1000",
            active: true,
            isGroup: true,
            isSystem: true,
            incomeBalance: "Balance Sheet",
            class: "Asset",
            consolidatedRate: "Closing"
          },
          {
            id: "asset",
            parentId: "balance-sheet-root",
            name: "Cash",
            number: "1100",
            active: true,
            isGroup: false,
            isSystem: false,
            incomeBalance: "Balance Sheet",
            class: "Asset",
            consolidatedRate: "Closing"
          },
          {
            id: "equity",
            parentId: "balance-sheet-root",
            name: "Equity",
            number: "3000",
            active: true,
            isGroup: true,
            isSystem: false,
            incomeBalance: "Balance Sheet",
            class: "Equity",
            consolidatedRate: "Historical"
          },
          {
            id: "revenue",
            parentId: "income-statement-root",
            name: "Revenue",
            number: "4000",
            active: true,
            isGroup: false,
            isSystem: false,
            incomeBalance: "Income Statement",
            class: "Revenue",
            consolidatedRate: "Average"
          }
        ],
        periodSeriesRows: [
          {
            accountId: "asset",
            periodEnd: bucket.end,
            netChange: 20,
            balanceAtDate: 20
          },
          {
            accountId: "revenue",
            periodEnd: bucket.end,
            netChange: 20,
            balanceAtDate: 20
          }
        ],
        translationRatesByCompany: {
          "company-1": {
            sourceCurrency: "EUR",
            closingRate: 2,
            averageRate: 2,
            historicalRate: 2
          },
          "company-2": {
            sourceCurrency: "EUR",
            closingRate: 3,
            averageRate: 3,
            historicalRate: 3
          }
        }
      }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      {
        buckets: [bucket],
        includeCurrentYearEarnings: true,
        netIncomeLabel: "本年净利润"
      }
    );

    expect(result.error).toBeNull();
    expect(result.data?.find((row) => row.id === "net-income")).toMatchObject({
      name: "本年净利润",
      periods: {
        [bucket.key]: {
          netChange: 40,
          balanceAtDate: 40,
          translatedNetChange: 100,
          translatedBalance: 100
        }
      }
    });
    expect(
      result.data?.find((row) => row.id === "balance-sheet-root")?.periods[
        bucket.key
      ]
    ).toMatchObject({ netChange: 0, balanceAtDate: 0 });
  });

  it("sums translated period flows separately from translated balances", async () => {
    const result = await getConsolidatedPeriodSeries(
      makeReportClient({
        seriesByCompany: {
          "company-1": [
            {
              accountId: "sales",
              periodEnd: bucket.end,
              netChange: 10,
              balanceAtDate: 100
            }
          ],
          "company-2": [
            {
              accountId: "sales",
              periodEnd: bucket.end,
              netChange: 20,
              balanceAtDate: 200
            }
          ]
        },
        translationRatesByCompany: {
          "company-1": {
            sourceCurrency: "EUR",
            closingRate: 2,
            averageRate: 2,
            historicalRate: 2
          },
          "company-2": {
            sourceCurrency: "EUR",
            closingRate: 3,
            averageRate: 3,
            historicalRate: 3
          }
        }
      }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      { buckets: [bucket] }
    );

    const sales = result.data?.find((row) => row.id === "sales");
    expect(sales?.periods[bucket.key]).toMatchObject({
      netChange: 30,
      balanceAtDate: 300,
      translatedNetChange: 80,
      translatedBalance: 800,
      exchangeRate: 2
    });
  });
});

function makePivotClient(options: {
  dimensionLookupError?: boolean;
  dimensionMetadataIncomplete?: boolean;
  dimensionMetadataDataNull?: boolean;
  dimensionValueMetadataIncomplete?: boolean;
  journalPivotDataNull?: boolean;
  purchaseLookupError?: boolean;
  purchaseMetadataIncomplete?: boolean;
  purchaseMetadataDataNull?: boolean;
  purchasePivotDataNull?: boolean;
}) {
  const pivotRows = [
    {
      rowValue1Id: "value-1",
      rowValue2Id: null,
      columnKey: "2026-01-31",
      amount: 10,
      quantity: 1,
      lineCount: 1,
      hasMore: false
    }
  ];

  return {
    from(table: string) {
      if (table === "dimension") {
        return options.dimensionMetadataDataNull
          ? queryResult(null)
          : queryResult(
              options.dimensionMetadataIncomplete
                ? []
                : [{ id: "dimension-1", entityType: "Custom" }]
            );
      }
      if (table === "dimensionValue") {
        if (options.dimensionLookupError) {
          return queryResult(null, {
            message: "dimension value lookup failed"
          });
        }
        return queryResult(
          options.dimensionValueMetadataIncomplete
            ? []
            : [{ id: "value-1", name: "Value 1" }]
        );
      }
      if (table === "supplier") {
        return options.purchaseMetadataDataNull
          ? queryResult(null)
          : options.purchaseLookupError
            ? queryResult(null, { message: "purchase value lookup failed" })
            : queryResult(
                options.purchaseMetadataIncomplete
                  ? []
                  : [{ id: "value-1", name: "Supplier 1" }]
              );
      }
      return queryResult([]);
    },
    async rpc(name: string) {
      if (name === "journalDimensionPivot") {
        if (options.journalPivotDataNull) return { data: null, error: null };
        return { data: pivotRows, error: null };
      }
      if (name === "purchaseLineDimensionPivot") {
        if (options.purchasePivotDataNull) return { data: null, error: null };
        return { data: pivotRows, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    }
  } as never;
}

describe("pivot metadata completeness", () => {
  it("fails closed when the journal pivot RPC returns null data", async () => {
    const result = await getDimensionPivot(
      makePivotClient({ journalPivotDataNull: true }),
      {
        companyId: "company-1",
        companyGroupId: "group-1",
        report: { accountScope: { classes: ["Revenue"] } },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        periodEnds: [bucket.end],
        state: {
          rows: [],
          columnAxis: { type: "period" },
          filters: [],
          accountIds: []
        }
      } as never
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain(
      "Journal pivot source returned no data"
    );
  });

  it("fails closed when the purchase pivot RPC returns null data", async () => {
    const result = await getPurchaseLinePivot(
      makePivotClient({ purchasePivotDataNull: true }),
      {
        companyId: "company-1",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        periodEnds: [bucket.end],
        state: {
          rows: [],
          columnAxis: { type: "period" },
          filters: [],
          accountIds: []
        }
      } as never
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain(
      "Purchase pivot source returned no data"
    );
  });

  it("fails closed when dimension metadata returns null data", async () => {
    const result = await getDimensionPivot(
      makePivotClient({ dimensionMetadataDataNull: true }),
      {
        companyId: "company-1",
        companyGroupId: "group-1",
        report: { accountScope: { classes: ["Revenue"] } },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        periodEnds: [bucket.end],
        state: {
          rows: ["dimension-1"],
          columnAxis: { type: "period" },
          filters: [],
          accountIds: []
        }
      } as never
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain(
      "Dimension metadata source returned no data"
    );
  });

  it("fails closed when requested dimension metadata is omitted", async () => {
    const result = await getDimensionPivot(
      makePivotClient({ dimensionMetadataIncomplete: true }),
      {
        companyId: "company-1",
        companyGroupId: "group-1",
        report: { accountScope: { classes: ["Revenue"] } },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        periodEnds: [bucket.end],
        state: {
          rows: ["dimension-1"],
          columnAxis: { type: "period" },
          filters: [],
          accountIds: []
        }
      } as never
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain(
      "Dimension metadata source returned incomplete data"
    );
  });

  it("fails closed when requested dimension value metadata is omitted", async () => {
    const result = await getDimensionPivot(
      makePivotClient({ dimensionValueMetadataIncomplete: true }),
      {
        companyId: "company-1",
        companyGroupId: "group-1",
        report: { accountScope: { classes: ["Revenue"] } },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        periodEnds: [bucket.end],
        state: {
          rows: ["dimension-1"],
          columnAxis: { type: "period" },
          filters: [],
          accountIds: []
        }
      } as never
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain(
      "Dimension value metadata source returned incomplete data"
    );
  });

  it("propagates dimension value lookup errors", async () => {
    const result = await getDimensionPivot(
      makePivotClient({ dimensionLookupError: true }),
      {
        companyId: "company-1",
        companyGroupId: "group-1",
        report: { accountScope: { classes: ["Revenue"] } },
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        periodEnds: [bucket.end],
        state: {
          rows: ["dimension-1"],
          columnAxis: { type: "period" },
          filters: [],
          accountIds: []
        }
      } as never
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("dimension value lookup failed");
  });

  it("fails closed when purchase value metadata returns null data", async () => {
    const result = await getPurchaseLinePivot(
      makePivotClient({ purchaseMetadataDataNull: true }),
      {
        companyId: "company-1",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        periodEnds: [bucket.end],
        state: {
          rows: ["supplier"],
          columnAxis: { type: "period" },
          filters: [],
          accountIds: []
        }
      } as never
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain(
      "Purchase pivot metadata source returned no data"
    );
  });

  it("fails closed when requested purchase value metadata is omitted", async () => {
    const result = await getPurchaseLinePivot(
      makePivotClient({ purchaseMetadataIncomplete: true }),
      {
        companyId: "company-1",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        periodEnds: [bucket.end],
        state: {
          rows: ["supplier"],
          columnAxis: { type: "period" },
          filters: [],
          accountIds: []
        }
      } as never
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain(
      "Dimension value metadata source returned incomplete data"
    );
  });

  it("propagates purchase value lookup errors", async () => {
    const result = await getPurchaseLinePivot(
      makePivotClient({ purchaseLookupError: true }),
      {
        companyId: "company-1",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        periodEnds: [bucket.end],
        state: {
          rows: ["supplier"],
          columnAxis: { type: "period" },
          filters: [],
          accountIds: []
        }
      } as never
    );

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("purchase value lookup failed");
  });
});

describe("getConsolidatedBalances", () => {
  it("fails closed when a requested company is omitted from company data", async () => {
    const result = await getConsolidatedBalances(
      makeReportClient(),
      "group-1",
      ["company-1", "company-missing"],
      "USD",
      "2026-01-31",
      "2026-01-01"
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain(
      "company resolution omitted requested companies"
    );
  });

  it("returns no partial data when a company balance fails", async () => {
    const result = await getConsolidatedBalances(
      makeReportClient({ balanceFailureCompanyId: "company-2" }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      "2026-01-31",
      "2026-01-01"
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain("balances failed");
  });

  it("fails closed when company resolution reaches the PostgREST row cap", async () => {
    const result = await getConsolidatedBalances(
      makeReportClient({ companyRowCount: 1000 }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      "2026-01-31",
      "2026-01-01"
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain("company resolution reached");
  });

  it("fails closed when consolidation rates are null", async () => {
    const result = await getConsolidatedBalances(
      makeReportClient({ translationRatesData: null }),
      "group-1",
      ["company-1", "company-2"],
      "USD",
      "2026-01-31",
      "2026-01-01"
    );

    expect(result.data).toBeNull();
    expect(result.isComplete).toBe(false);
    expect(result.error?.message).toContain("Consolidation rates");
  });
});
