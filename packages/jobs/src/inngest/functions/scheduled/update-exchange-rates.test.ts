import { describe, expect, it, vi } from "vitest";
import { buildExchangeRateRows } from "./update-exchange-rates";

// buildExchangeRateRows is pure, but its module's neighbors are not:
// @carbon/env validates required vars at module scope and
// @carbon/auth/client.server pulls it in too. vi.mock hoists above the
// imports, so the module under test never needs a configured environment.
vi.mock("@carbon/env", () => ({ EXCHANGE_RATES_API_KEY: undefined }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));

const EFFECTIVE_DATE = "2026-09-02";
const UPDATED_AT = "2026-09-02T00:00:00.000Z";

const build = (
  ratesEur: { [code: string]: number | undefined },
  codes: string[]
) => buildExchangeRateRows(ratesEur, codes, EFFECTIVE_DATE, UPDATED_AT);

describe("buildExchangeRateRows", () => {
  it("anchors on USD: 1 USD is exactly 1", () => {
    const { rows } = build({ USD: 1.086, EUR: 1 }, ["USD"]);
    expect(rows).toEqual([
      {
        currencyCode: "USD",
        effectiveDate: EFFECTIVE_DATE,
        rate: 1,
        updatedAt: UPDATED_AT
      }
    ]);
  });

  it("re-bases the EUR feed to units per 1 USD at internal scale", () => {
    // Feed is EUR-based, so EUR itself becomes 1 / feed[USD]
    const { rows } = build({ USD: 1.086, EUR: 1, GBP: 0.86 }, ["EUR", "GBP"]);
    expect(rows.map((r) => [r.currencyCode, r.rate])).toEqual([
      ["EUR", 0.92081], // 1 / 1.086
      ["GBP", 0.7919] // 0.86 / 1.086
    ]);
  });

  it("partitions codes missing from the feed into staleCodes", () => {
    const { rows, staleCodes } = build({ USD: 1.086 }, ["USD", "XYZ", "ABC"]);
    expect(rows.map((r) => r.currencyCode)).toEqual(["USD"]);
    expect(staleCodes).toEqual(["XYZ", "ABC"]);
  });

  it("does not warn about obsolete codes no live feed quotes", () => {
    const { rows, staleCodes } = build({ USD: 1.086 }, [
      "USD",
      "VEF",
      "ZMK",
      "XYZ"
    ]);
    expect(rows.map((r) => r.currencyCode)).toEqual(["USD"]);
    expect(staleCodes).toEqual(["XYZ"]);
  });

  it("filters non-finite, zero, and negative feed values", () => {
    const { rows, staleCodes } = build(
      { USD: 1.086, AAA: 0, BBB: -2, CCC: Number.NaN, DDD: Infinity },
      ["USD", "AAA", "BBB", "CCC", "DDD"]
    );
    expect(rows.map((r) => r.currencyCode)).toEqual(["USD"]);
    expect(staleCodes).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  it("stamps every row with the given effectiveDate and updatedAt", () => {
    const { rows } = build({ USD: 1.086, EUR: 1 }, ["USD", "EUR"]);
    for (const row of rows) {
      expect(row.effectiveDate).toBe(EFFECTIVE_DATE);
      expect(row.updatedAt).toBe(UPDATED_AT);
    }
  });

  it("throws when the feed has no usable USD quote to anchor on", () => {
    // A partial payload may succeed on retry, so this must be a throw
    expect(() => build({ EUR: 1, GBP: 0.86 }, ["EUR"])).toThrow(
      "USD rate missing from feed"
    );
    expect(() => build({ USD: 0, EUR: 1 }, ["EUR"])).toThrow(
      "USD rate missing from feed"
    );
  });
});
