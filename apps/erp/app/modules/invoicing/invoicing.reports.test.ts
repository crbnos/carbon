import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import { aggregateSpend, previousPeriod } from "./invoicing.reports";

describe("previousPeriod", () => {
  it("returns the equal-length window immediately before the range", () => {
    // Jan 1–31 (31 days) → the 31 days before it: Dec 1–31.
    expect(previousPeriod("2026-01-01", "2026-01-31")).toEqual({
      previousStart: "2025-12-01",
      previousEnd: "2025-12-31"
    });
  });

  it("handles a single-day range", () => {
    expect(previousPeriod("2026-03-15", "2026-03-15")).toEqual({
      previousStart: "2026-03-14",
      previousEnd: "2026-03-14"
    });
  });

  it("spans month/year boundaries: previous window ends the day before, same length", () => {
    const start = "2026-02-01";
    const end = "2026-07-31";
    const { previousStart, previousEnd } = previousPeriod(start, end);
    // Ends the day before the range starts...
    expect(previousEnd).toBe("2026-01-31");
    // ...and is exactly as long as the selected range.
    expect(parseDate(previousEnd).compare(parseDate(previousStart))).toBe(
      parseDate(end).compare(parseDate(start))
    );
  });
});

describe("aggregateSpend", () => {
  const start = "2026-01-01";
  const end = "2026-01-31";
  const prevStart = "2025-12-01";
  const prevEnd = "2025-12-31";

  const run = (
    rows: { partyId: string | null; totalAmount: number | null; date: string }[]
  ) => aggregateSpend(rows, start, end, prevStart, prevEnd);

  it("buckets amounts into the current and previous windows", () => {
    const result = run([
      { partyId: "c1", totalAmount: 100, date: "2026-01-10" },
      { partyId: "c1", totalAmount: 50, date: "2026-01-20" },
      { partyId: "c1", totalAmount: 120, date: "2025-12-15" }
    ]);
    expect(result).toEqual([
      { partyId: "c1", total: 150, previousTotal: 120, variance: 25 }
    ]);
  });

  it("marks a party with no prior basis as null variance (new)", () => {
    const result = run([
      { partyId: "c1", totalAmount: 200, date: "2026-01-05" }
    ]);
    expect(result[0]?.variance).toBeNull();
  });

  it("computes a negative variance when spend drops", () => {
    const result = run([
      { partyId: "c1", totalAmount: 40, date: "2026-01-05" },
      { partyId: "c1", totalAmount: 80, date: "2025-12-05" }
    ]);
    expect(result[0]?.variance).toBe(-50);
  });

  it("sorts by current-period total descending", () => {
    const result = run([
      { partyId: "small", totalAmount: 10, date: "2026-01-02" },
      { partyId: "big", totalAmount: 900, date: "2026-01-02" },
      { partyId: "mid", totalAmount: 100, date: "2026-01-02" }
    ]);
    expect(result.map((r) => r.partyId)).toEqual(["big", "mid", "small"]);
  });

  it("drops rows with no party or zero amount, and dates outside both windows", () => {
    const result = run([
      { partyId: null, totalAmount: 500, date: "2026-01-10" },
      { partyId: "c1", totalAmount: 0, date: "2026-01-10" },
      { partyId: "c2", totalAmount: 75, date: "2026-01-10" },
      { partyId: "c2", totalAmount: 999, date: "2025-06-01" } // outside both windows
    ]);
    expect(result).toEqual([
      { partyId: "c2", total: 75, previousTotal: 0, variance: null }
    ]);
  });
});
