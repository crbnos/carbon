// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  buildLesseeSchedule,
  generateLeasePayments,
  leaseMonthEnds,
  paymentMonthIndex,
  presentValueOfPayments
} from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  type LeaseLiabilityLease,
  type LeaseLiabilityPayment,
  type LeaseLiabilityScheduleLine,
  leaseLiabilityAssets,
  summarizeLeaseCosts,
  summarizeLeaseLiabilities
} from "./lease-liabilities";

// Two real leases, built by the same lease math activation uses.
function buildLease(args: {
  id: string;
  classification: "Operating" | "Finance";
  commencementDate: string;
  endDate: string;
  months: number;
  paymentAmount: number;
  frequency: "Monthly" | "Annual";
  timing: "Advance" | "Arrears";
  discountRate: number;
}) {
  const rows = generateLeasePayments({
    commencementDate: args.commencementDate,
    endDate: args.endDate,
    paymentAmount: args.paymentAmount,
    frequency: args.frequency,
    timing: args.timing,
    annualEscalationPercent: 0,
    purchaseOptionAmount: 0,
    decimals: 2
  });
  const points = rows.map((row) => ({
    monthIndex: paymentMonthIndex(row, args.commencementDate, args.timing),
    amount: row.amount
  }));
  const liability = presentValueOfPayments({
    payments: points,
    annualRate: args.discountRate
  });
  const schedule = buildLesseeSchedule({
    openingLiability: liability,
    openingRouAsset: liability,
    payments: points,
    months: args.months,
    annualRate: args.discountRate,
    timing: args.timing,
    classification: args.classification,
    amortizationMonths: args.months,
    periodDates: leaseMonthEnds(args.commencementDate, 0, args.months)
  });
  const leaseLineId = `${args.id}-asset`;
  const lease: LeaseLiabilityLease = {
    id: args.id,
    leaseLineId,
    leaseId: args.id.toUpperCase(),
    name: args.id,
    asset: "Asset",
    supplierName: "Lessor",
    status: "Active",
    classification: args.classification,
    commencementDate: args.commencementDate,
    endedOn: null,
    discountRate: args.discountRate,
    initialLiability: liability,
    initialRouAsset: liability
  };
  const lines: LeaseLiabilityScheduleLine[] = schedule.map((line) => ({
    leaseLineId,
    ...line
  }));
  const payments: LeaseLiabilityPayment[] = rows.map((row) => ({
    leaseLineId,
    dueDate: row.dueDate,
    amount: row.amount
  }));
  return { lease, lines, payments, schedule, liability };
}

// A: a 10-year building, 12,000 a year in advance at 5 %.
const buildingArgs = {
  id: "lse-a",
  commencementDate: "2026-07-01",
  endDate: "2036-06-30",
  months: 120,
  paymentAmount: 12000,
  frequency: "Annual",
  timing: "Advance",
  discountRate: 5
} as const;
// B: the spec's worked example — 36 months, 10,000 a month in arrears at 6 %.
const forkliftArgs = {
  id: "lse-b",
  commencementDate: "2026-01-01",
  endDate: "2028-12-31",
  months: 36,
  paymentAmount: 10000,
  frequency: "Monthly",
  timing: "Arrears",
  discountRate: 6
} as const;

const asOf = "2026-12-31";

function summarize(
  a: ReturnType<typeof buildLease>,
  b: ReturnType<typeof buildLease>,
  startMonth = 1
) {
  return summarizeLeaseLiabilities(
    [a.lease, b.lease],
    [...a.lines, ...b.lines],
    [...a.payments, ...b.payments],
    { asOf, startMonth }
  );
}

const sumOf = (values: number[]) => values.reduce((s, v) => s + v, 0);

describe("summarizeLeaseLiabilities", () => {
  const building = buildLease({ ...buildingArgs, classification: "Operating" });
  const forklift = buildLease({ ...forkliftArgs, classification: "Operating" });
  const summary = summarize(building, forklift);
  const rowA = summary.rows.find((row) => row.id === "lse-a")!;
  const rowB = summary.rows.find((row) => row.id === "lse-b")!;
  const operating = summary.totals.find(
    (total) => total.classification === "Operating"
  )!;

  it("starts from the spec's worked example", () => {
    expect(forklift.liability).toBeCloseTo(328710.16, 2);
  });

  it("takes the liability and net ROU from the last month on or before asOf", () => {
    // A's 6th month and B's 12th month both end on 2026-12-31.
    expect(building.schedule[5]!.periodDate).toBe(asOf);
    expect(forklift.schedule[11]!.periodDate).toBe(asOf);
    expect(rowA.liability).toBe(building.schedule[5]!.closingLiability);
    expect(rowA.netRou).toBe(building.schedule[5]!.closingRouAsset);
    expect(rowB.liability).toBe(forklift.schedule[11]!.closingLiability);
    expect(rowA.remainingMonths).toBe(114);
    expect(rowB.remainingMonths).toBe(24);
  });

  it("splits current and non-current by the principal of the next 12 months", () => {
    // B: the principal of months 13–24 is the drop from month 12 to month 24.
    expect(rowB.currentPortion).toBeCloseTo(
      forklift.schedule[11]!.closingLiability -
        forklift.schedule[23]!.closingLiability,
      2
    );
    expect(rowB.nonCurrentPortion).toBeCloseTo(
      forklift.schedule[23]!.closingLiability,
      2
    );
    expect(rowA.currentPortion + rowA.nonCurrentPortion).toBeCloseTo(
      rowA.liability,
      2
    );
  });

  it("buckets the remaining payments by fiscal year, then Thereafter", () => {
    expect(summary.fiscalYears).toEqual([2027, 2028, 2029, 2030, 2031]);
    // A pays each July: 2027–2031 in the five years, 2032–2035 thereafter.
    expect(rowA.maturityByFiscalYear).toEqual({
      2027: 12000,
      2028: 12000,
      2029: 12000,
      2030: 12000,
      2031: 12000
    });
    expect(rowA.maturityThereafter).toBe(48000);
    expect(rowB.maturityByFiscalYear).toEqual({ 2027: 120000, 2028: 120000 });
    expect(rowB.maturityThereafter).toBe(0);
    expect(operating.undiscountedPayments).toBe(348000);
  });

  it("moves the buckets with the fiscal year start", () => {
    // A July year end: FY2027 runs July 2026 – June 2027.
    const julyYear = summarize(building, forklift, 7);
    const a = julyYear.rows.find((row) => row.id === "lse-a")!;
    expect(julyYear.fiscalYears).toEqual([2027, 2028, 2029, 2030, 2031]);
    expect(a.maturityByFiscalYear[2027]).toBeUndefined();
    expect(a.maturityByFiscalYear[2028]).toBe(12000);
    expect(a.maturityThereafter).toBe(5 * 12000);
  });

  it("reconciles: maturity − imputed interest = liability", () => {
    // The imputed interest is what the remaining schedule months charge.
    const remainingInterest = sumOf([
      ...building.schedule.slice(6).map((line) => line.interestAmount),
      ...forklift.schedule.slice(12).map((line) => line.interestAmount)
    ]);
    expect(operating.imputedInterest).toBeCloseTo(remainingInterest, 2);

    const maturity =
      sumOf(Object.values(operating.maturityByFiscalYear)) +
      operating.maturityThereafter;
    expect(maturity - operating.imputedInterest).toBeCloseTo(
      rowA.liability + rowB.liability,
      2
    );
    expect(operating.liability).toBeCloseTo(rowA.liability + rowB.liability, 2);
  });

  it("weights the remaining term by liability and the rate by remaining payments", () => {
    const la = building.schedule[5]!.closingLiability;
    const lb = forklift.schedule[11]!.closingLiability;
    // Term: (LA × 114 + LB × 24) ÷ (LA + LB) months, in years.
    expect(operating.weightedAverageRemainingTermYears).toBeCloseTo(
      (la * 114 + lb * 24) / (la + lb) / 12,
      4
    );
    // Rate: (5 % × 108,000 + 6 % × 240,000) ÷ 348,000.
    expect(operating.weightedAverageDiscountRate).toBeCloseTo(
      (5 * 108000 + 6 * 240000) / 348000,
      4
    );
  });

  it("shows Operating and Finance apart", () => {
    const finance = buildLease({ ...forkliftArgs, classification: "Finance" });
    const split = summarize(building, finance);
    const [op, fin] = split.totals;
    expect(op!.classification).toBe("Operating");
    expect(op!.undiscountedPayments).toBe(108000);
    expect(op!.weightedAverageDiscountRate).toBe(5);
    expect(fin!.classification).toBe("Finance");
    expect(fin!.undiscountedPayments).toBe(240000);
    expect(fin!.weightedAverageDiscountRate).toBe(6);
    expect(fin!.weightedAverageRemainingTermYears).toBe(2);
  });

  it("leaves out leases with nothing outstanding on asOf", () => {
    const later = buildLease({
      ...forkliftArgs,
      id: "lse-later",
      commencementDate: "2027-01-01",
      endDate: "2029-12-31",
      classification: "Operating"
    });
    const terminated = buildLease({
      ...forkliftArgs,
      id: "lse-ended",
      classification: "Operating"
    });
    terminated.lease.status = "Terminated";
    terminated.lease.endedOn = "2026-11-30";
    const shortTerm = buildLease({
      ...forkliftArgs,
      id: "lse-short",
      classification: "Operating"
    });
    shortTerm.lease.classification = "Short-Term";

    const result = summarizeLeaseLiabilities(
      [later.lease, terminated.lease, shortTerm.lease],
      [...later.lines, ...terminated.lines, ...shortTerm.lines],
      [...later.payments, ...terminated.payments, ...shortTerm.payments],
      { asOf, startMonth: 1 }
    );
    expect(result.rows).toEqual([]);
    expect(
      result.totals.map((total) => total.weightedAverageDiscountRate)
    ).toEqual([null, null]);
  });
});

describe("summarizeLeaseLiabilities current portion", () => {
  const principal = (
    schedule: ReturnType<typeof buildLease>["schedule"],
    from: number,
    to: number
  ) => sumOf(schedule.slice(from, to).map((line) => line.principalAmount));

  it("takes the next 12 schedule lines on a leap-year as-of", () => {
    // Month ends from 2026-03-31; the 12 lines after 2027-02-28 run through
    // 2028-02-29, which a 12-month date window (to 2028-02-28) leaves out.
    const lease = buildLease({
      ...forkliftArgs,
      commencementDate: "2026-03-01",
      endDate: "2029-02-28",
      classification: "Operating"
    });
    expect(lease.schedule[11]!.periodDate).toBe("2027-02-28");
    expect(lease.schedule[23]!.periodDate).toBe("2028-02-29");
    const [row] = summarizeLeaseLiabilities(
      [lease.lease],
      lease.lines,
      lease.payments,
      { asOf: "2027-02-28", startMonth: 1 }
    ).rows;
    expect(row!.currentPortion).toBeCloseTo(
      principal(lease.schedule, 12, 24),
      2
    );
    expect(row!.nonCurrentPortion).toBeCloseTo(
      lease.schedule[23]!.closingLiability,
      2
    );
  });

  it("takes the next 12 schedule lines on a mid-month as-of", () => {
    const lease = buildLease({ ...forkliftArgs, classification: "Finance" });
    const [row] = summarizeLeaseLiabilities(
      [lease.lease],
      lease.lines,
      lease.payments,
      { asOf: "2026-12-15", startMonth: 1 }
    ).rows;
    // The last line on or before 2026-12-15 is November's (index 10).
    expect(row!.liability).toBe(lease.schedule[10]!.closingLiability);
    expect(row!.remainingMonths).toBe(25);
    expect(row!.currentPortion).toBeCloseTo(
      principal(lease.schedule, 11, 23),
      2
    );
  });
});

describe("summarizeLeaseLiabilities on a terminated asset", () => {
  // The forklift terminated on 2027-06-15: termination deletes the schedule
  // lines after that day and the payments due after it.
  function terminatedForklift() {
    const lease = buildLease({ ...forkliftArgs, classification: "Operating" });
    const endedOn = "2027-06-15";
    lease.lease.endedOn = endedOn;
    lease.lines = lease.lines.filter((line) => line.periodDate <= endedOn);
    lease.payments = lease.payments.filter(
      (payment) => payment.dueDate <= endedOn
    );
    return lease;
  }

  const summarizeAt = (
    lease: ReturnType<typeof buildLease>,
    asOfDate: string
  ) =>
    summarizeLeaseLiabilities([lease.lease], lease.lines, lease.payments, {
      asOf: asOfDate,
      startMonth: 1
    }).rows;

  it("keeps the asset until its own end, all of it current", () => {
    const lease = terminatedForklift();
    expect(lease.lines.at(-1)!.periodDate).toBe("2027-05-31");
    // No schedule line is left after 2027-06-10, but the asset is still on
    // the books until 2027-06-15.
    const [row] = summarizeAt(lease, "2027-06-10");
    expect(row).toBeDefined();
    expect(row!.liability).toBe(lease.schedule[16]!.closingLiability);
    expect(row!.remainingMonths).toBe(0);
    expect(row!.currentPortion).toBe(row!.liability);
    expect(row!.nonCurrentPortion).toBe(0);
  });

  it("makes the liability current when the end falls within the next 12 lines", () => {
    const [row] = summarizeAt(terminatedForklift(), "2027-03-31");
    expect(row!.remainingMonths).toBe(2);
    expect(row!.currentPortion).toBe(row!.liability);
  });

  it("drops the asset on its end date", () => {
    expect(summarizeAt(terminatedForklift(), "2027-06-15")).toEqual([]);
  });
});

describe("leaseLiabilityAssets", () => {
  const lease = {
    id: "lse-1",
    leaseId: "LSE000001",
    name: "Forklifts",
    supplierName: "Lessor",
    status: "Active" as const,
    commencementDate: "2026-01-01",
    discountRate: 6
  };
  const asset = {
    leaseId: "lse-1",
    lesseeClassification: "Operating" as const,
    initialLiability: 1000,
    initialRouAsset: 1100
  };

  it("gives each asset its lease's terms and its own end", () => {
    const result = leaseLiabilityAssets(
      [lease],
      [
        { ...asset, id: "a-active", description: "FL-12", status: "Active" },
        {
          ...asset,
          id: "a-terminated",
          description: "FL-13",
          status: "Terminated"
        },
        {
          ...asset,
          id: "a-purchased",
          description: "FL-14",
          status: "Purchased"
        },
        // A Draft or Cancelled lease is not read, so its assets have no lease.
        {
          ...asset,
          id: "a-draft",
          leaseId: "lse-draft",
          description: "FL-15",
          status: "Active"
        }
      ],
      [
        {
          leaseLineId: "a-terminated",
          eventType: "Modification",
          effectiveDate: "2026-06-01"
        },
        {
          leaseLineId: "a-terminated",
          eventType: "Termination",
          effectiveDate: "2027-06-15"
        },
        {
          leaseLineId: "a-purchased",
          eventType: "Purchase",
          effectiveDate: "2027-09-30"
        }
      ]
    );
    expect(result).toEqual([
      {
        id: "lse-1",
        leaseLineId: "a-active",
        leaseId: "LSE000001",
        name: "Forklifts",
        asset: "FL-12",
        supplierName: "Lessor",
        status: "Active",
        classification: "Operating",
        commencementDate: "2026-01-01",
        endedOn: null,
        discountRate: 6,
        initialLiability: 1000,
        initialRouAsset: 1100
      },
      expect.objectContaining({
        leaseLineId: "a-terminated",
        status: "Active",
        endedOn: "2027-06-15"
      }),
      expect.objectContaining({
        leaseLineId: "a-purchased",
        endedOn: "2027-09-30"
      })
    ]);
  });
});

describe("summarizeLeaseLiabilities with several assets", () => {
  it("gives each asset of a lease its own row", () => {
    const first = buildLease({ ...forkliftArgs, classification: "Operating" });
    const second = buildLease({
      ...forkliftArgs,
      classification: "Finance"
    });
    // The same lease, a second asset.
    second.lease.leaseLineId = "lse-b-second";
    second.lease.asset = "Second";
    for (const line of second.lines) line.leaseLineId = "lse-b-second";
    for (const payment of second.payments) {
      payment.leaseLineId = "lse-b-second";
    }

    const result = summarize(first, second);
    expect(result.rows.map((row) => [row.id, row.asset])).toEqual([
      ["lse-b", "Asset"],
      ["lse-b", "Second"]
    ]);
    expect(result.rows.map((row) => row.classification)).toEqual([
      "Operating",
      "Finance"
    ]);
    expect(result.rows[0]!.liability).toBe(result.rows[1]!.liability);
  });
});

describe("summarizeLeaseCosts", () => {
  it("splits posted rows and Lease lines by classification", () => {
    const classification = new Map([
      ["op", "Operating" as const],
      ["fin", "Finance" as const],
      ["short", "Short-Term" as const]
    ]);
    const costs = summarizeLeaseCosts(
      classification,
      [
        { leaseLineId: "op", type: "Interest", amount: 1643.55 },
        { leaseLineId: "op", type: "Amortization", amount: 8356.45 },
        { leaseLineId: "fin", type: "Interest", amount: 1643.55 },
        { leaseLineId: "fin", type: "Amortization", amount: 9130.84 }
      ],
      [
        { leaseLineId: "op", leasePaymentId: "pay-1", amount: 10000 },
        { leaseLineId: "fin", leasePaymentId: "pay-2", amount: 10000 },
        { leaseLineId: "short", leasePaymentId: "pay-3", amount: 750 },
        { leaseLineId: null, leasePaymentId: null, amount: 120.5 },
        { leaseLineId: null, leasePaymentId: null, amount: 30 }
      ]
    );
    expect(costs).toEqual({
      operatingLeaseCost: 10000,
      financeAmortization: 9130.84,
      financeInterest: 1643.55,
      shortTermLeaseCost: 750,
      variableLeaseCost: 150.5,
      cashPaidOperating: 10000,
      cashPaidFinance: 10000
    });
  });
});
