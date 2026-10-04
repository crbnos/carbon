// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  planRevenueSchedule,
  type RevenuePlanLine,
  reconcileRevenueSchedule,
  revenueTotals,
  validateRevenueEdit
} from "./contract-revenue-schedule.ts";

const recurring: RevenuePlanLine = {
  id: "platform",
  revenueType: "Recurring",
  revenueMethod: "Even Period",
  startDate: "2026-11-01",
  endDate: "2027-10-31",
  goLiveDate: null,
  revenueStartDate: null,
  revenueEndDate: null
};

describe("planRevenueSchedule", () => {
  it("spreads a line's billed total over its months, keyed by month", () => {
    const rows = planRevenueSchedule({
      lines: [recurring],
      totals: new Map([["platform", 42_000]])
    });
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({
      lineId: "platform",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      amount: 3500,
      status: "Planned"
    });
    expect(revenueTotals(rows).get("platform")).toBe(42_000);
  });

  it("keys a mid-month start on the 1st and prorates it", () => {
    const rows = planRevenueSchedule({
      lines: [
        {
          ...recurring,
          revenueMethod: "Daily",
          startDate: "2026-11-16",
          endDate: "2026-12-31"
        }
      ],
      totals: new Map([["platform", 460]])
    });
    expect(rows.map((row) => [row.periodStart, row.amount])).toEqual([
      ["2026-11-01", 150],
      ["2026-12-01", 310]
    ]);
  });

  it("recognizes a One-time line with no end in its start month", () => {
    const rows = planRevenueSchedule({
      lines: [
        {
          ...recurring,
          id: "setup",
          revenueType: "One-time",
          startDate: "2026-11-20",
          endDate: null
        }
      ],
      totals: new Map([["setup", 5000]])
    });
    expect(rows).toEqual([
      {
        lineId: "setup",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        amount: 5000,
        status: "Planned"
      }
    ]);
  });

  it("runs an open-ended Recurring line to its fallback end", () => {
    const rows = planRevenueSchedule({
      lines: [{ ...recurring, endDate: null }],
      totals: new Map([["platform", 7000]]),
      fallbackEnds: new Map([["platform", "2026-12-31"]])
    });
    expect(rows.map((row) => row.amount)).toEqual([3500, 3500]);
  });

  it("marks months before Recognize revenue from as recognized externally", () => {
    const rows = planRevenueSchedule({
      lines: [recurring],
      totals: new Map([["platform", 42_000]]),
      recognizeRevenueFrom: "2027-02-01"
    });
    expect(
      rows.filter((row) => row.status === "Recognized Externally")
    ).toHaveLength(3);
  });

  it("plans nothing for a line with nothing billed", () => {
    expect(
      planRevenueSchedule({ lines: [recurring], totals: new Map() })
    ).toEqual([]);
  });
});

describe("validateRevenueEdit", () => {
  it("passes a schedule that conserves each line's total", () => {
    const result = validateRevenueEdit(new Map([["a", 100]]), [
      { lineId: "a", amount: 60 },
      { lineId: "a", amount: 40 }
    ]);
    expect(result.ok).toBe(true);
  });

  it("reports billed − revenue per line", () => {
    const result = validateRevenueEdit(new Map([["a", 100]]), [
      { lineId: "a", amount: 70 },
      { lineId: "b", amount: 5 }
    ]);
    expect(result.ok).toBe(false);
    expect(result.residuals).toEqual(
      new Map([
        ["a", 30],
        ["b", -5]
      ])
    );
  });
});

describe("reconcileRevenueSchedule", () => {
  const planned = (amounts: [string, number][]) =>
    amounts.map(([periodStart, amount]) => ({
      lineId: "a",
      periodStart,
      periodEnd: periodStart.replace(/-01$/, "-28"),
      amount,
      status: "Planned" as const
    }));

  it("replaces planned months from the change and keeps recognized ones", () => {
    const result = reconcileRevenueSchedule({
      lineId: "a",
      existing: [
        { periodStart: "2026-11-01", amount: 100, status: "Recognized" },
        { periodStart: "2026-12-01", amount: 100, status: "Planned" },
        { periodStart: "2027-01-01", amount: 100, status: "Planned" }
      ],
      planned: planned([
        ["2026-11-01", 100],
        ["2026-12-01", 150],
        ["2027-01-01", 150]
      ]),
      from: "2026-12-10"
    });
    expect(result.replaceFrom).toBe("2026-12-01");
    expect(result.rows.map((row) => [row.periodStart, row.amount])).toEqual([
      ["2026-12-01", 150],
      ["2027-01-01", 150]
    ]);
  });

  it("puts a recognized month's shortfall on the first open month", () => {
    // Cancelled to end 15 Nov after November was recognized in full.
    const result = reconcileRevenueSchedule({
      lineId: "a",
      existing: [
        { periodStart: "2026-11-01", amount: 100, status: "Recognized" },
        { periodStart: "2026-12-01", amount: 100, status: "Planned" }
      ],
      planned: planned([["2026-11-01", 50]]),
      from: "2026-11-15"
    });
    expect(result.rows.map((row) => [row.periodStart, row.amount])).toEqual([
      ["2026-12-01", -50]
    ]);
  });

  it("keeps a planned edit before the change and conserves the total", () => {
    const result = reconcileRevenueSchedule({
      lineId: "a",
      existing: [
        { periodStart: "2026-11-01", amount: 130, status: "Planned" },
        { periodStart: "2026-12-01", amount: 70, status: "Planned" }
      ],
      planned: planned([
        ["2026-11-01", 100],
        ["2026-12-01", 100],
        ["2027-01-01", 100]
      ]),
      from: "2026-12-01"
    });
    // 300 planned − 130 kept = 170 across Dec and Jan.
    expect(result.rows.map((row) => [row.periodStart, row.amount])).toEqual([
      ["2026-12-01", 70],
      ["2027-01-01", 100]
    ]);
  });
});
