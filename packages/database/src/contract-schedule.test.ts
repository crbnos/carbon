// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  amendmentEffectiveDate,
  billingGrid,
  type ContractLineTerms,
  type ContractTerms,
  type ExistingRow,
  invoiceLinePricing,
  lineTotals,
  periodUnits,
  planInvoiceSchedule,
  reconcileContractSchedule,
  renewedEndDate,
  rowPricing,
  suggestAmendmentType,
  suggestContractType,
  validateScheduleEdit,
  wholePeriodUnits
} from "./contract-schedule.ts";

// Money in the spec's acceptance criteria is stated in cents; the schedule
// keeps internal scale (5 dp), which settles to the same cents.
const CENTS = 2;

const calendarMonthly = (
  overrides: Partial<ContractTerms> = {}
): ContractTerms => ({
  startDate: "2026-11-01",
  endDate: "2027-10-31",
  billingFrequency: "Month",
  billingAlignment: "Calendar",
  billingTiming: "Advance",
  firstInvoiceDate: null,
  billedThrough: null,
  ...overrides
});

const line = (
  overrides: Partial<ContractLineTerms> & { id: string }
): ContractLineTerms => ({
  kind: "Recurring",
  quantity: 1,
  rate: 0,
  rateUnit: "Month",
  discountPercent: 0,
  startDate: "2026-11-01",
  endDate: null,
  ...overrides
});

const existingRow = (
  overrides: Partial<ExistingRow> & { id: string; lineId: string }
): ExistingRow => ({
  invoiceId: "inv",
  invoiceDate: null,
  invoiceStatus: "Invoiced",
  invoiceIsEdited: false,
  periodStart: "2027-03-01",
  periodEnd: "2027-03-31",
  units: 1,
  unitPrice: 0,
  amount: 0,
  isAdjustment: false,
  memoId: null,
  ...overrides
});

const invoiceTotal = (rows: { amount: number }[]) =>
  rows.reduce((sum, row) => sum + row.amount, 0);

describe("planInvoiceSchedule", () => {
  it("plans Acme: 60,420 on 1 Nov 2026 and 420 on 1 Dec 2026", () => {
    const lines = [
      line({
        id: "implementation",
        kind: "One-time",
        rate: 60000,
        rateUnit: null,
        startDate: "2026-11-01",
        endDate: "2027-04-30"
      }),
      line({ id: "platform", quantity: 10, rate: 40, discountPercent: 0.2 }),
      line({ id: "support", rate: 1200, rateUnit: "Year" })
    ];
    const invoices = planInvoiceSchedule(
      calendarMonthly(),
      lines,
      "2027-10-31"
    );
    const nov = invoices.find((i) => i.invoiceDate === "2026-11-01")!;
    const dec = invoices.find((i) => i.invoiceDate === "2026-12-01")!;
    expect(invoiceTotal(nov.rows)).toBeCloseTo(60420, CENTS);
    expect(invoiceTotal(dec.rows)).toBeCloseTo(420, CENTS);
    expect(nov.rows.map((r) => r.lineId)).toEqual([
      "implementation",
      "platform",
      "support"
    ]);
  });

  it("marks periods ending on or before billedThrough as Billed Externally", () => {
    const terms: ContractTerms = {
      startDate: "2026-05-01",
      endDate: null,
      billingFrequency: "Year",
      billingAlignment: "Anniversary",
      billingTiming: "Advance",
      firstInvoiceDate: null,
      billedThrough: "2027-04-30"
    };
    const invoices = planInvoiceSchedule(
      terms,
      [
        line({
          id: "licence",
          rate: 12000,
          rateUnit: "Year",
          startDate: "2026-05-01"
        })
      ],
      "2028-04-30"
    );
    const planned = invoices.filter((i) => i.status === "Planned");
    expect(planned[0]!.invoiceDate).toBe("2027-05-01");
    const external = invoices.find((i) => i.status === "Billed Externally")!;
    expect(external.rows[0]!.periodStart).toBe("2026-05-01");
    expect(external.rows[0]!.periodEnd).toBe("2027-04-30");
  });
});

describe("rowPricing", () => {
  it("prices 10 per Day over December at 310", () => {
    const units = periodUnits("2026-12-01", "2026-12-31", "Day");
    expect(
      rowPricing({ quantity: 1, rate: 10, discountPercent: 0 }, units)
    ).toEqual({ unitPrice: 310, amount: 310 });
  });

  it("prices 10 per Day over February 2027 at 280", () => {
    const units = periodUnits("2027-02-01", "2027-02-28", "Day");
    expect(
      rowPricing({ quantity: 1, rate: 10, discountPercent: 0 }, units)
    ).toEqual({ unitPrice: 280, amount: 280 });
  });
});

describe("billingGrid and periodUnits", () => {
  it("starts Anniversary periods on the 15th, each exactly one month", () => {
    const grid = billingGrid(
      calendarMonthly({
        startDate: "2027-03-15",
        endDate: null,
        billingAlignment: "Anniversary"
      }),
      "2027-06-30"
    );
    expect(grid.map((p) => p.start)).toEqual([
      "2027-03-15",
      "2027-04-15",
      "2027-05-15",
      "2027-06-15"
    ]);
    expect(grid[0]!.end).toBe("2027-04-14");
    expect(periodUnits("2027-03-15", "2027-04-14", "Month")).toBe(1);
  });

  it("clamps a 31 Jan anchor to 28 Feb, then returns to 31 Mar", () => {
    const grid = billingGrid(
      calendarMonthly({
        startDate: "2027-01-31",
        endDate: null,
        billingAlignment: "Anniversary"
      }),
      "2027-04-15"
    );
    expect(grid.map((p) => p.start)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31"
    ]);
  });

  it("prorates a Calendar first period of 15–31 Oct at 17/31 of a month", () => {
    const grid = billingGrid(
      calendarMonthly({ startDate: "2026-10-15", endDate: null }),
      "2026-11-30"
    );
    expect(grid[0]).toEqual({
      start: "2026-10-15",
      end: "2026-10-31",
      dueDate: "2026-10-15"
    });
    expect(periodUnits("2026-10-15", "2026-10-31", "Month")).toBe(17 / 31);
  });
});

describe("whole-period units", () => {
  it("bills a clamped Anniversary period (28 Feb–30 Mar) as one whole month", () => {
    const invoices = planInvoiceSchedule(
      calendarMonthly({
        startDate: "2027-01-31",
        endDate: null,
        billingAlignment: "Anniversary"
      }),
      [line({ id: "monthly", rate: 100, startDate: "2027-01-31" })],
      "2027-04-30"
    );
    const row = invoices
      .flatMap((i) => i.rows)
      .find((r) => r.periodStart === "2027-02-28")!;
    expect(row.periodEnd).toBe("2027-03-30");
    expect(row.units).toBe(1);
    expect(row.amount).toBe(100);
  });

  it("is exact only for month-based pairs and week-on-week", () => {
    expect(wholePeriodUnits("Month", "Year")).toBe(1 / 12);
    expect(wholePeriodUnits("Quarter", "Month")).toBe(3);
    expect(wholePeriodUnits("Week", "Week")).toBe(1);
    expect(wholePeriodUnits("Month", "Day")).toBeNull();
    expect(wholePeriodUnits("Week", "Month")).toBeNull();
    expect(wholePeriodUnits("Month", "Week")).toBeNull();
  });
});

describe("validateScheduleEdit", () => {
  const computed = lineTotals([
    {
      invoiceDate: "2026-11-01",
      status: "Planned",
      rows: [
        {
          lineId: "implementation",
          periodStart: "2026-11-01",
          periodEnd: "2027-04-30",
          units: 1,
          unitPrice: 60000,
          amount: 60000,
          isAdjustment: false,
          invoiceDate: "2026-11-01",
          status: "Planned"
        }
      ]
    }
  ]);

  it("accepts a split into three installments of 20,000", () => {
    const rows = [20000, 20000, 20000].map((amount) => ({
      lineId: "implementation",
      amount,
      isAdjustment: false
    }));
    expect(validateScheduleEdit(computed, rows).ok).toBe(true);
  });

  it("refuses installments summing to 50,000, residual 10,000", () => {
    const rows = [20000, 20000, 10000].map((amount) => ({
      lineId: "implementation",
      amount,
      isAdjustment: false
    }));
    const result = validateScheduleEdit(computed, rows);
    expect(result.ok).toBe(false);
    expect(result.residuals.get("implementation")).toBe(10000);
  });
});

describe("reconcileContractSchedule", () => {
  const terms = calendarMonthly({ startDate: "2027-03-01" });
  const tenSeats = line({
    id: "platform-10",
    quantity: 10,
    rate: 40,
    discountPercent: 0.2,
    startDate: "2027-03-01",
    endDate: "2027-03-11"
  });
  const fifteenSeats = line({
    id: "platform-15",
    quantity: 15,
    rate: 40,
    discountPercent: 0.2,
    startDate: "2027-03-12"
  });
  const marchInvoiced = existingRow({
    id: "row-march",
    lineId: "platform-10",
    invoiceId: "inv-march",
    invoiceDate: "2027-03-01",
    unitPrice: 40,
    amount: 320
  });

  it("adjusts −206.45 and creates 309.68 for 12–31 Mar on the 1 Apr invoice", () => {
    const result = reconcileContractSchedule({
      terms,
      lines: [tenSeats, fifteenSeats],
      existing: [marchInvoiced],
      from: "2027-03-12",
      through: "2027-10-31"
    });

    expect(result.adjustments).toHaveLength(1);
    const adjustment = result.adjustments[0]!;
    expect(adjustment.amount).toBeCloseTo(-206.45, CENTS);
    expect(adjustment.periodStart).toBe("2027-03-12");
    expect(adjustment.periodEnd).toBe("2027-03-31");
    expect(adjustment.invoiceDate).toBe("2027-04-01");

    const april = result.create.find((i) => i.invoiceDate === "2027-04-01")!;
    const partial = april.rows.find(
      (r) => r.lineId === "platform-15" && r.periodStart === "2027-03-12"
    )!;
    expect(partial.periodEnd).toBe("2027-03-31");
    expect(partial.amount).toBeCloseTo(309.68, CENTS);
    // The ten-seat March row is billed; nothing re-creates it.
    expect(
      result.create
        .flatMap((i) => i.rows)
        .some((r) => r.lineId === "platform-10")
    ).toBe(false);
  });

  describe("a split one-time line on Planned invoices before `from`", () => {
    const splitTerms = calendarMonthly();
    const implementation = (rate: number) =>
      line({
        id: "implementation",
        kind: "One-time",
        rateUnit: null,
        rate,
        startDate: "2026-11-01",
        endDate: "2027-04-30"
      });
    const installments = ["2026-11-01", "2026-12-01", "2027-01-01"].map(
      (invoiceDate, index) =>
        existingRow({
          id: `inst-${index}`,
          lineId: "implementation",
          invoiceId: `inv-${index}`,
          invoiceDate,
          invoiceStatus: "Planned",
          invoiceIsEdited: true,
          periodStart: "2026-11-01",
          periodEnd: "2027-04-30",
          units: 1 / 3,
          unitPrice: 60000,
          amount: 20000
        })
    );

    it("keeps the installments when the line total is unchanged", () => {
      const result = reconcileContractSchedule({
        terms: splitTerms,
        lines: [implementation(60000)],
        existing: installments,
        from: "2027-03-12",
        through: "2027-10-31"
      });
      expect(result.recut).toEqual([]);
      expect(result.deleteRowIds).toEqual([]);
      expect(
        result.create
          .flatMap((i) => i.rows)
          .some((r) => r.lineId === "implementation")
      ).toBe(false);
    });

    it("re-cuts the installments by share and conserves the new total", () => {
      const result = reconcileContractSchedule({
        terms: splitTerms,
        lines: [implementation(66000)],
        existing: installments,
        from: "2027-03-12",
        through: "2027-10-31"
      });
      expect(result.recut).toHaveLength(3);
      expect(result.recut.map((r) => r.amount)).toEqual([22000, 22000, 22000]);
      expect(invoiceTotal(result.recut)).toBe(66000);
    });
  });

  it("does not add a second adjustment when one already exists", () => {
    const result = reconcileContractSchedule({
      terms,
      lines: [tenSeats, fifteenSeats],
      existing: [
        marchInvoiced,
        existingRow({
          id: "row-adjustment",
          lineId: "platform-10",
          invoiceId: "inv-april",
          invoiceDate: "2027-04-01",
          invoiceStatus: "Invoiced",
          periodStart: "2027-03-12",
          periodEnd: "2027-03-31",
          units: -20 / 31,
          unitPrice: 40,
          amount: -206.45161,
          isAdjustment: true
        })
      ],
      from: "2027-03-12",
      through: "2027-10-31"
    });
    expect(result.adjustments).toHaveLength(0);
  });

  it("re-creates an adjustment whose Planned invoice the reconciliation deletes", () => {
    const first = reconcileContractSchedule({
      terms,
      lines: [tenSeats, fifteenSeats],
      existing: [marchInvoiced],
      from: "2027-03-12",
      through: "2027-10-31"
    });
    const adjustment = first.adjustments[0]!;
    const rerun = reconcileContractSchedule({
      terms,
      lines: [tenSeats, fifteenSeats],
      existing: [
        marchInvoiced,
        existingRow({
          ...adjustment,
          id: "row-adjustment",
          invoiceId: "inv-april",
          invoiceStatus: "Planned"
        })
      ],
      from: "2027-03-12",
      through: "2027-10-31"
    });
    expect(rerun.deleteInvoiceIds).toEqual(["inv-april"]);
    expect(rerun.adjustments).toHaveLength(1);
  });

  it("credits −140 when a 420 September period is cancelled after the 20th", () => {
    const service = line({
      id: "service",
      rate: 420,
      startDate: "2027-09-01",
      endDate: "2027-09-20"
    });
    const september = existingRow({
      id: "row-september",
      lineId: "service",
      invoiceId: "inv-september",
      invoiceDate: "2027-09-01",
      periodStart: "2027-09-01",
      periodEnd: "2027-09-30",
      unitPrice: 420,
      amount: 420
    });
    const result = reconcileContractSchedule({
      terms: calendarMonthly({
        startDate: "2027-09-01",
        endDate: "2027-09-20"
      }),
      lines: [service],
      existing: [september],
      from: "2027-09-21",
      through: "2027-09-20"
    });
    expect(result.adjustments).toHaveLength(1);
    expect(result.adjustments[0]!.amount).toBe(-140);
    expect(result.adjustments[0]!.periodStart).toBe("2027-09-21");
    expect(result.create).toHaveLength(0);

    // Re-running with the cancellation's memo-borne adjustment present.
    const rerun = reconcileContractSchedule({
      terms: calendarMonthly({
        startDate: "2027-09-01",
        endDate: "2027-09-20"
      }),
      lines: [service],
      existing: [
        september,
        existingRow({
          id: "row-credit",
          lineId: "service",
          invoiceId: null,
          invoiceDate: null,
          invoiceStatus: null,
          periodStart: "2027-09-21",
          periodEnd: "2027-09-30",
          units: -1 / 3,
          unitPrice: 420,
          amount: -140,
          isAdjustment: true,
          memoId: "memo-1"
        })
      ],
      from: "2027-09-21",
      through: "2027-09-20"
    });
    expect(rerun.adjustments).toHaveLength(0);
  });
});

describe("amendmentEffectiveDate", () => {
  it("snaps Next Period on 12 Mar 2027 to 1 Apr 2027", () => {
    expect(
      amendmentEffectiveDate(
        calendarMonthly(),
        "Next Period",
        "2027-03-12",
        "2027-10-31"
      )
    ).toBe("2027-04-01");
  });
});

describe("invoiceLinePricing", () => {
  it("keeps quantity, list price and discount when the row still matches", () => {
    expect(
      invoiceLinePricing(
        { amount: 320, unitPrice: 40 },
        { quantity: 10, discountPercent: 0.2 }
      )
    ).toEqual({ quantity: 10, unitPrice: 40, discountPercent: 0.2 });
  });

  it("drafts a split installment as one unit at the row's amount", () => {
    expect(
      invoiceLinePricing(
        { amount: 20000, unitPrice: 60000 },
        { quantity: 1, discountPercent: 0 }
      )
    ).toEqual({ quantity: 1, unitPrice: 20000, discountPercent: 0 });
  });

  it("prices the 12–31 Mar row of 15 seats at 25.80645 and keeps the discount", () => {
    const units = periodUnits("2027-03-12", "2027-03-31", "Month");
    const pricing = rowPricing(
      { quantity: 15, rate: 40, discountPercent: 0.2 },
      units
    );
    expect(pricing.unitPrice).toBe(25.80645);
    expect(pricing.amount).toBeCloseTo(309.68, CENTS);
    expect(
      invoiceLinePricing(pricing, { quantity: 15, discountPercent: 0.2 })
    ).toEqual({ quantity: 15, unitPrice: 25.80645, discountPercent: 0.2 });
  });
});

describe("suggestions and renewal", () => {
  it("suggests the contract type from previous contracts", () => {
    expect(suggestContractType([])).toBe("New Sales");
    expect(suggestContractType([{ status: "Ended" }])).toBe("Reactivation");
    expect(suggestContractType([{ status: "Active" }])).toBe("New Sales");
  });

  it("suggests Expansion when the recurring value rises", () => {
    expect(suggestAmendmentType(400, 600)).toBe("Expansion");
  });

  it("renews 31 Oct 2027 by 12 months to 31 Oct 2028", () => {
    expect(renewedEndDate("2027-10-31", 12)).toBe("2028-10-31");
  });
});
