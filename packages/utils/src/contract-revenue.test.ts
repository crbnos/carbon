// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/database/precision";
import { describe, expect, it } from "vitest";
import {
  contractPositionPreview,
  lineRevenueDates,
  type RevenueLine,
  revenuePreview
} from "./contract-revenue";

const sum = (rows: { amount: number }[]) =>
  round(rows.reduce((total, row) => total + row.amount, 0));

const line = (overrides: Partial<RevenueLine> = {}): RevenueLine => ({
  id: "implementation",
  revenueType: "One-time",
  method: "Even Period",
  revenueStart: "2026-11-01",
  revenueEnd: "2027-04-30",
  netAmount: 60000,
  ...overrides
});

describe("lineRevenueDates", () => {
  it("prefers go-live, then the revenue start, then the line start", () => {
    const base = {
      startDate: "2026-11-01",
      endDate: "2027-10-31",
      goLiveDate: null,
      revenueStartDate: null,
      revenueEndDate: null
    };
    expect(lineRevenueDates(base)).toEqual({
      start: "2026-11-01",
      end: "2027-10-31"
    });
    expect(
      lineRevenueDates({
        ...base,
        revenueStartDate: "2026-12-01",
        revenueEndDate: "2027-06-30"
      })
    ).toEqual({ start: "2026-12-01", end: "2027-06-30" });
    expect(
      lineRevenueDates({
        ...base,
        goLiveDate: "2027-01-15",
        revenueStartDate: "2026-12-01"
      })
    ).toEqual({ start: "2027-01-15", end: "2027-10-31" });
  });
});

describe("revenuePreview", () => {
  it("Even Period over six full months gives 10,000 a month", () => {
    const rows = revenuePreview(line());
    expect(rows.map((row) => row.amount)).toEqual([
      10000, 10000, 10000, 10000, 10000, 10000
    ]);
    expect(rows[0]).toEqual({
      lineId: "implementation",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      amount: 10000
    });
    expect(rows[5]!.periodEnd).toEqual("2027-04-30");
  });

  it("Daily weights each month by its days and totals exactly", () => {
    const rows = revenuePreview(line({ method: "Daily" }));
    expect(rows).toHaveLength(6);
    expect(rows[0]!.amount).toEqual(round((60000 * 30) / 181));
    expect(sum(rows)).toEqual(60000);
  });

  it("Even Period prorates partial first and last months by that month's days", () => {
    const rows = revenuePreview(
      line({
        revenueStart: "2026-11-15",
        revenueEnd: "2027-01-14",
        netAmount: 2000
      })
    );
    const weight = 16 / 30 + 1 + 14 / 31;
    expect(rows.map((row) => row.periodStart)).toEqual([
      "2026-11-15",
      "2026-12-01",
      "2027-01-01"
    ]);
    expect(rows[0]!.amount).toBeCloseTo((2000 * (16 / 30)) / weight, 4);
    expect(rows[1]!.amount).toBeCloseTo(2000 / weight, 4);
    expect(rows[2]!.amount).toBeCloseTo((2000 * (14 / 31)) / weight, 4);
    expect(sum(rows)).toEqual(2000);
  });

  it("One-time with no end is one row in the start month", () => {
    expect(
      revenuePreview(
        line({ revenueStart: "2026-11-10", revenueEnd: null, netAmount: 500 })
      )
    ).toEqual([
      {
        lineId: "implementation",
        periodStart: "2026-11-10",
        periodEnd: "2026-11-10",
        amount: 500
      }
    ]);
  });
});

describe("contractPositionPreview", () => {
  it("Acme November: invoiced 60,420, recognized 10,420, deferred 50,000", () => {
    const revenue = [
      ...revenuePreview(line()),
      ...revenuePreview(
        line({
          id: "platform",
          revenueType: "Recurring",
          revenueEnd: "2027-10-31",
          netAmount: 3840
        })
      ),
      ...revenuePreview(
        line({
          id: "support",
          revenueType: "Recurring",
          revenueEnd: "2027-10-31",
          netAmount: 1200
        })
      )
    ];
    const invoices = [
      { invoiceDate: "2026-11-01", amount: 60000 },
      { invoiceDate: "2026-11-01", amount: 320 },
      { invoiceDate: "2026-11-01", amount: 100 },
      { invoiceDate: "2026-12-01", amount: 420 }
    ];

    const position = contractPositionPreview(invoices, revenue);
    expect(position[0]).toEqual({
      month: "2026-11-01",
      invoiced: 60420,
      recognized: 10420,
      deferred: 50000
    });
    expect(position[1]).toEqual({
      month: "2026-12-01",
      invoiced: 420,
      recognized: 10420,
      deferred: 40000
    });
    expect(position.at(-1)!.month).toEqual("2027-10-01");
    expect(position).toHaveLength(12);
  });

  it("is empty with nothing invoiced or recognized", () => {
    expect(contractPositionPreview([], [])).toEqual([]);
  });
});
