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
  getConsolidatedPeriodSeries,
  getFinancialStatementPeriodSeries
} from "./accounting.service";

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
  seriesFailureCompanyId?: string;
  translationFailureCompanyId?: string;
  seriesRowCount?: number;
};

function queryResult<T>(data: T) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data, error: null });
  return builder;
}

function makeReportClient(options: ClientOptions = {}) {
  return {
    from(table: string) {
      if (table === "company") {
        return queryResult([
          {
            id: "company-1",
            parentCompanyId: null,
            isEliminationEntity: false
          },
          {
            id: "company-2",
            parentCompanyId: null,
            isEliminationEntity: false
          }
        ]);
      }
      if (table === "accounts") return queryResult([account]);
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const companyId = args.p_company_id as string;
      if (name === "accountTreeBalancePeriodSeries") {
        if (companyId === options.seriesFailureCompanyId) {
          return { data: null, error: { message: "series failed" } };
        }
        const row = {
          accountId: account.id,
          periodEnd: bucket.end,
          netChange: 10,
          balanceAtDate: 10
        };
        return {
          data: new Array(options.seriesRowCount ?? 1).fill(row),
          error: null
        };
      }
      if (name === "getConsolidationRates") {
        if (companyId === options.translationFailureCompanyId) {
          return { data: null, error: { message: "translation failed" } };
        }
        return {
          data: {
            sourceCurrency: "USD",
            closingRate: 1,
            averageRate: 1,
            historicalRate: 1
          },
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
});

describe("getConsolidatedPeriodSeries", () => {
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
});
