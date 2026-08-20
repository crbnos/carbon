import { describe, expect, it } from "vitest";
import {
  computeReportPeriodBuckets,
  defaultReportRange,
  fiscalYearAndPeriodFor,
  MAX_REPORT_PERIOD_BUCKETS
} from "./accounting";

describe("defaultReportRange", () => {
  it("spans the current partial month plus the five preceding whole months", () => {
    // End mid-month → start is the 1st of the month five months earlier.
    expect(defaultReportRange("2026-08-09")).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-08-09"
    });
  });

  it("crosses the year boundary without drift", () => {
    expect(defaultReportRange("2026-02-15")).toEqual({
      startDate: "2025-09-01",
      endDate: "2026-02-15"
    });
  });
});

describe("computeReportPeriodBuckets — month", () => {
  it("splits a calendar range into calendar months", () => {
    const buckets = computeReportPeriodBuckets(
      "2026-01-01",
      "2026-03-31",
      "month",
      1
    );
    expect(buckets.map((b) => [b.key, b.start, b.end])).toEqual([
      ["2026-01", "2026-01-01", "2026-01-31"],
      ["2026-02", "2026-02-01", "2026-02-28"],
      ["2026-03", "2026-03-01", "2026-03-31"]
    ]);
    expect(buckets.every((b) => !b.isPartial)).toBe(true);
  });

  it("starts the first bucket mid-month without flagging it partial", () => {
    const buckets = computeReportPeriodBuckets(
      "2026-01-15",
      "2026-02-28",
      "month",
      1
    );
    expect(buckets[0]?.start).toBe("2026-01-15");
    expect(buckets[0]?.end).toBe("2026-01-31");
    expect(buckets[0]?.isPartial).toBe(false);
  });

  it("clamps and flags the trailing partial month", () => {
    const buckets = computeReportPeriodBuckets(
      "2026-01-01",
      "2026-02-15",
      "month",
      1
    );
    expect(buckets).toHaveLength(2);
    expect(buckets[1]?.end).toBe("2026-02-15");
    expect(buckets[1]?.isPartial).toBe(true);
    expect(buckets[0]?.isPartial).toBe(false);
  });

  it("handles a single-bucket range", () => {
    const buckets = computeReportPeriodBuckets(
      "2026-02-01",
      "2026-02-28",
      "month",
      1
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.isPartial).toBe(false);
  });

  it("returns empty for an inverted range", () => {
    expect(
      computeReportPeriodBuckets("2026-03-01", "2026-01-01", "month", 1)
    ).toEqual([]);
  });

  it("keeps the most recent buckets when the cap is exceeded", () => {
    const buckets = computeReportPeriodBuckets(
      "2000-01-01",
      "2026-12-31",
      "month",
      1
    );
    expect(buckets).toHaveLength(MAX_REPORT_PERIOD_BUCKETS);
    expect(buckets[buckets.length - 1]?.end).toBe("2026-12-31");
    expect(buckets[0]?.key).toBe("2022-01");
  });
});

describe("computeReportPeriodBuckets — quarter", () => {
  it("uses calendar quarters for a January fiscal start", () => {
    const buckets = computeReportPeriodBuckets(
      "2026-01-01",
      "2026-12-31",
      "quarter",
      1
    );
    expect(buckets.map((b) => [b.key, b.start, b.end, b.quarter])).toEqual([
      ["FY2026-Q1", "2026-01-01", "2026-03-31", 1],
      ["FY2026-Q2", "2026-04-01", "2026-06-30", 2],
      ["FY2026-Q3", "2026-07-01", "2026-09-30", 3],
      ["FY2026-Q4", "2026-10-01", "2026-12-31", 4]
    ]);
  });

  it("uses fiscal quarters for an April fiscal start", () => {
    // April start: Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar.
    // FY named by its ending calendar year: Apr 2025 belongs to FY2026.
    const buckets = computeReportPeriodBuckets(
      "2025-04-01",
      "2026-03-31",
      "quarter",
      4
    );
    expect(buckets.map((b) => [b.key, b.start, b.end])).toEqual([
      ["FY2026-Q1", "2025-04-01", "2025-06-30"],
      ["FY2026-Q2", "2025-07-01", "2025-09-30"],
      ["FY2026-Q3", "2025-10-01", "2025-12-31"],
      ["FY2026-Q4", "2026-01-01", "2026-03-31"]
    ]);
  });

  it("aligns a mid-quarter start to the containing fiscal quarter's end", () => {
    const buckets = computeReportPeriodBuckets(
      "2025-05-15",
      "2025-08-31",
      "quarter",
      4
    );
    expect(buckets.map((b) => [b.key, b.start, b.end, b.isPartial])).toEqual([
      ["FY2026-Q1", "2025-05-15", "2025-06-30", false],
      ["FY2026-Q2", "2025-07-01", "2025-08-31", true]
    ]);
  });
});

describe("computeReportPeriodBuckets — year", () => {
  it("splits on fiscal-year boundaries for a January start", () => {
    const buckets = computeReportPeriodBuckets(
      "2024-01-01",
      "2026-06-30",
      "year",
      1
    );
    expect(buckets.map((b) => [b.key, b.start, b.end, b.isPartial])).toEqual([
      ["FY2024", "2024-01-01", "2024-12-31", false],
      ["FY2025", "2025-01-01", "2025-12-31", false],
      ["FY2026", "2026-01-01", "2026-06-30", true]
    ]);
  });

  it("splits on fiscal-year boundaries for a July start", () => {
    // July start: FY2026 runs Jul 2025 - Jun 2026
    const buckets = computeReportPeriodBuckets(
      "2025-07-01",
      "2026-06-30",
      "year",
      7
    );
    expect(buckets.map((b) => [b.key, b.start, b.end, b.isPartial])).toEqual([
      ["FY2026", "2025-07-01", "2026-06-30", false]
    ]);
  });

  it("aligns a mid-fiscal-year start to the fiscal year end", () => {
    const buckets = computeReportPeriodBuckets(
      "2025-10-01",
      "2026-09-30",
      "year",
      7
    );
    expect(buckets.map((b) => [b.key, b.start, b.end, b.isPartial])).toEqual([
      ["FY2026", "2025-10-01", "2026-06-30", false],
      ["FY2027", "2026-07-01", "2026-09-30", true]
    ]);
  });
});

describe("fiscalYearAndPeriodFor (bucket key grounding)", () => {
  it("names the fiscal year by its ending calendar year", () => {
    expect(fiscalYearAndPeriodFor(2025, 7, 7)).toEqual({
      fiscalYear: 2026,
      periodNumber: 1
    });
    expect(fiscalYearAndPeriodFor(2026, 6, 7)).toEqual({
      fiscalYear: 2026,
      periodNumber: 12
    });
    expect(fiscalYearAndPeriodFor(2026, 2, 1)).toEqual({
      fiscalYear: 2026,
      periodNumber: 2
    });
  });
});
