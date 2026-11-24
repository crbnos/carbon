// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  effectiveInvoiceAutomation,
  type PlannableLine,
  planAgreementRentalInvoices,
  planRentalInvoices,
  RENTAL_HOLD_CHARGES,
  RENTAL_HOLD_EARLY_RETURN,
  type RentalPlanCharge,
  type RentalPlanPeriod,
  rentalHoldRebill,
  rentalInvoiceTotals,
  rentLineDescription
} from "./rental-invoice-plan";

const line = (
  item: string,
  lineType: PlannableLine<string>["lineType"],
  overrides: Partial<PlannableLine<string>> = {}
): PlannableLine<string> => ({
  item,
  lineType,
  isAdjustment: false,
  invoiceSeparately: false,
  voidedInvoiceReadableId: null,
  ...overrides
});

describe("planRentalInvoices", () => {
  it("Draft Only keeps rent and charges on one unheld invoice", () => {
    expect(
      planRentalInvoices("Draft Only", [
        line("rent", "Rent"),
        line("damage", "Charge")
      ])
    ).toEqual([
      { lines: ["rent", "damage"], holdReason: null, role: "combined" }
    ]);
  });

  it("Post with rent only drafts one unheld rent invoice", () => {
    expect(planRentalInvoices("Post", [line("rent", "Rent")])).toEqual([
      { lines: ["rent"], holdReason: null, role: "rent" }
    ]);
  });

  it("Post splits off separately invoiced charges and holds them", () => {
    expect(
      planRentalInvoices("Post", [
        line("rent", "Rent"),
        line("damage", "Charge", { invoiceSeparately: true }),
        line("buyout", "Purchase Option")
      ])
    ).toEqual([
      { lines: ["rent"], holdReason: null, role: "rent" },
      {
        lines: ["damage", "buyout"],
        holdReason: RENTAL_HOLD_CHARGES,
        role: "charges"
      }
    ]);
  });

  it("puts a charge on the unheld rent invoice by default", () => {
    expect(
      planRentalInvoices("Post and Email", [
        line("rent", "Rent"),
        line("insurance", "Charge"),
        line("damage", "Charge", { invoiceSeparately: true })
      ])
    ).toEqual([
      { lines: ["rent", "insurance"], holdReason: null, role: "rent" },
      { lines: ["damage"], holdReason: RENTAL_HOLD_CHARGES, role: "charges" }
    ]);
  });

  it("drafts a charge unheld when no rent is due", () => {
    expect(planRentalInvoices("Post", [line("insurance", "Charge")])).toEqual([
      { lines: ["insurance"], holdReason: null, role: "rent" }
    ]);
  });

  it("always invoices a Purchase Option separately", () => {
    expect(
      planRentalInvoices("Post", [
        line("rent", "Rent"),
        line("buyout", "Purchase Option")
      ])
    ).toEqual([
      { lines: ["rent"], holdReason: null, role: "rent" },
      { lines: ["buyout"], holdReason: RENTAL_HOLD_CHARGES, role: "charges" }
    ]);
  });

  it("holds a rent invoice re-billing a voided charge", () => {
    expect(
      planRentalInvoices("Post", [
        line("rent", "Rent"),
        line("insurance", "Charge", { voidedInvoiceReadableId: "INV-7" })
      ])
    ).toEqual([
      {
        lines: ["rent", "insurance"],
        holdReason: rentalHoldRebill(["INV-7"]),
        role: "rent"
      }
    ]);
  });

  it("holds a rent invoice carrying an early-return adjustment", () => {
    expect(
      planRentalInvoices("Post and Email", [
        line("rent", "Rent"),
        line("credit", "Rent", { isAdjustment: true })
      ])
    ).toEqual([
      {
        lines: ["rent", "credit"],
        holdReason: RENTAL_HOLD_EARLY_RETURN,
        role: "rent"
      }
    ]);
  });

  it("Post with separate charges only drafts one held charges invoice", () => {
    expect(
      planRentalInvoices("Post", [
        line("damage", "Charge", { invoiceSeparately: true })
      ])
    ).toEqual([
      { lines: ["damage"], holdReason: RENTAL_HOLD_CHARGES, role: "charges" }
    ]);
  });

  it("holds a re-bill of a voided invoice", () => {
    const planned = planRentalInvoices("Post and Email", [
      line("p1", "Rent", { voidedInvoiceReadableId: "INV-7" }),
      line("p2", "Rent", { voidedInvoiceReadableId: "INV-7" }),
      line("p3", "Rent")
    ]);
    expect(planned).toEqual([
      {
        lines: ["p1", "p2", "p3"],
        holdReason: rentalHoldRebill(["INV-7"]),
        role: "rent"
      }
    ]);
    expect(planned[0]?.holdReason).toBe("Re-billing INV-7, which was voided");
  });

  it("the re-bill hold wins over the early-return hold", () => {
    const planned = planRentalInvoices("Post", [
      line("p1", "Rent", { voidedInvoiceReadableId: "INV-7" }),
      line("credit", "Rent", { isAdjustment: true })
    ]);
    expect(planned[0]?.holdReason).toBe(rentalHoldRebill(["INV-7"]));
  });

  it("names every voided invoice once, in first-seen order", () => {
    expect(rentalHoldRebill(["INV-7", "INV-9"])).toBe(
      "Re-billing INV-7, INV-9, which were voided"
    );
    const planned = planRentalInvoices("Post", [
      line("p1", "Rent", { voidedInvoiceReadableId: "INV-9" }),
      line("p2", "Rent", { voidedInvoiceReadableId: "INV-7" }),
      line("p3", "Rent", { voidedInvoiceReadableId: "INV-9" })
    ]);
    expect(planned[0]?.holdReason).toBe(rentalHoldRebill(["INV-9", "INV-7"]));
  });

  it("Draft Only never holds, even a re-bill", () => {
    expect(
      planRentalInvoices("Draft Only", [
        line("p1", "Rent", { voidedInvoiceReadableId: "INV-7" })
      ])
    ).toEqual([{ lines: ["p1"], holdReason: null, role: "combined" }]);
  });

  it("drafts nothing when nothing is due", () => {
    expect(planRentalInvoices("Draft Only", [])).toEqual([]);
    expect(planRentalInvoices("Post", [])).toEqual([]);
    expect(planRentalInvoices("Post and Email", [])).toEqual([]);
  });
});

describe("effectiveInvoiceAutomation", () => {
  it("falls back to the company mode", () => {
    expect(effectiveInvoiceAutomation(null, "Post")).toBe("Post");
  });

  it("prefers the agreement's override", () => {
    expect(effectiveInvoiceAutomation("Draft Only", "Post and Email")).toBe(
      "Draft Only"
    );
  });
});

describe("rentLineDescription", () => {
  const descriptionPeriod = {
    cycle: "Calendar Month" as const,
    periodStart: "2026-10-07",
    periodEnd: "2026-10-31",
    days: 25,
    rateUnitApplied: "Week" as const,
    isAdjustment: false
  };

  it("names the unit by its asset name and serial number", () => {
    expect(
      rentLineDescription({
        ...descriptionPeriod,
        assetName: "Skid Steer 4",
        serialNumber: "SN-1001"
      })
    ).toBe(
      "2026-10-07 – 2026-10-31 · 25 days · 4 × Week rate — Skid Steer 4 SN-1001"
    );
  });

  it("does not repeat a serial number the asset's name already carries", () => {
    expect(
      rentLineDescription({
        ...descriptionPeriod,
        assetName: "Reaction Wheel 0.010 Nm RW-SN-T2",
        serialNumber: "RW-SN-T2"
      })
    ).toBe(
      "2026-10-07 – 2026-10-31 · 25 days · 4 × Week rate — Reaction Wheel 0.010 Nm RW-SN-T2"
    );
  });

  it("a Monthly unit on a Monthly agreement names the month rate, not a unit count", () => {
    expect(
      rentLineDescription({
        ...descriptionPeriod,
        cycle: "Monthly",
        periodStart: "2026-10-07",
        periodEnd: "2026-11-06",
        days: 31,
        rateUnitApplied: "Month",
        assetName: "Skid Steer 4",
        serialNumber: "SN-1001"
      })
    ).toBe(
      "2026-10-07 – 2026-11-06 · 31 days · Month rate — Skid Steer 4 SN-1001"
    );
  });
});

const period = (
  overrides: Partial<RentalPlanPeriod> = {}
): RentalPlanPeriod => ({
  id: "period-1",
  rentalAgreementLineId: "line-1",
  periodStart: "2026-12-07",
  periodEnd: "2027-01-06",
  days: 31,
  amount: 305,
  rateUnitApplied: "Month",
  isAdjustment: false,
  voidedSalesInvoiceId: null,
  assetName: "Van 1",
  serialNumber: null,
  ...overrides
});

const charge = (
  overrides: Partial<RentalPlanCharge> = {}
): RentalPlanCharge => ({
  id: "charge-1",
  rentalAgreementLineId: "line-1",
  chargeType: "Charge",
  description: "Delivery",
  amount: 50,
  taxPercent: 0,
  taxCodeId: null,
  invoiceSeparately: false,
  voidedSalesInvoiceId: null,
  ...overrides
});

const plan = (
  overrides: Partial<Parameters<typeof planAgreementRentalInvoices>[0]> = {}
) =>
  planAgreementRentalInvoices({
    billingCycle: "Monthly",
    taxPercent: 0.2,
    taxCodeId: null,
    exchangeRate: 1,
    mode: "Draft Only",
    periods: [period()],
    charges: [],
    voidedReadableIds: new Map(),
    ...overrides
  });

describe("planAgreementRentalInvoices", () => {
  it("puts every due period and charge on one invoice under Draft Only", () => {
    const invoices = plan({
      periods: [
        period(),
        period({ id: "period-2", rentalAgreementLineId: "line-2" })
      ],
      charges: [charge()]
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.holdReason).toBeNull();
    expect(
      invoices[0]!.lines.map((line) => [
        line.rentalLineType,
        line.unitPrice,
        line.taxPercent
      ])
    ).toEqual([
      ["Rent", 305, 0.2],
      ["Rent", 305, 0.2],
      ["Charge", 50, 0]
    ]);
  });

  it("drafts a charge invoiced separately on its own held invoice under a posting mode", () => {
    const invoices = plan({
      mode: "Post",
      charges: [charge({ invoiceSeparately: true })]
    });
    expect(
      invoices.map((invoice) => [
        invoice.role,
        invoice.holdReason,
        invoice.lines.length
      ])
    ).toEqual([
      ["rent", null, 1],
      ["charges", RENTAL_HOLD_CHARGES, 1]
    ]);
  });

  it("leaves early-return adjustments off the invoice", () => {
    const invoices = plan({
      periods: [
        period(),
        period({ id: "credit", amount: -100, isAdjustment: true })
      ]
    });
    expect(
      invoices[0]!.lines.map((line) => line.rentalBillingPeriodId)
    ).toEqual(["period-1"]);
  });

  it("plans nothing when nothing is due", () => {
    expect(plan({ periods: [] })).toEqual([]);
  });
});

describe("rentalInvoiceTotals", () => {
  it("charges the line tax on each line: £305.00 at 20% is £61.00 tax, £366.00 total", () => {
    expect(rentalInvoiceTotals([{ unitPrice: 305, taxPercent: 0.2 }])).toEqual({
      subtotal: 305,
      totalTax: 61,
      totalAmount: 366
    });
  });
});
