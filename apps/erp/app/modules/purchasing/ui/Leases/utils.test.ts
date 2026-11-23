// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  buildLesseeSchedule,
  generateLeasePayments,
  lesseeScheduleSpan,
  paymentMonthIndex,
  presentValueOfPayments
} from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  canCancelLease,
  leaseActivationGaps,
  leaseAssetBalances,
  leaseModifyPaymentAt,
  leaseModifyPreview,
  leasePurchaseOffer,
  leasePurchasePreview,
  leasePurchaseRefusal,
  previewLesseeClassification,
  shortTermPastTwelveMonths,
  skippedPaymentBlockers
} from "./utils";

// A 36-month lease of one asset, 10,000 a month in arrears at 6 %, as the
// lease page reads it.
const LEASE = {
  id: "lse_1",
  status: "Active" as const,
  commencementDate: "2027-01-01",
  endDate: "2029-12-31",
  paymentTiming: "Arrears" as const,
  paymentFrequency: "Monthly" as const,
  annualEscalationPercent: 0,
  discountRate: 6,
  currencyCode: "USD"
};

const LINE = {
  id: "lsln_1",
  description: "Forklift",
  status: "Active" as const,
  paymentAmount: 10000,
  fairValue: null,
  economicLifeMonths: null,
  ownershipTransfers: false,
  specializedAsset: false,
  purchaseOptionAmount: null,
  purchaseOptionReasonablyCertain: false,
  classificationOverride: null,
  lesseeClassification: "Operating" as const,
  initialLiability: null as number | null,
  rouAssetCost: null as number | null
};

const POLICY = {
  majorPartPercent: 75,
  substantiallyAllPercent: 90,
  shortTermExpedient: true,
  accountingCutoverDate: null as string | null
};

type Payment = {
  id: string;
  leaseLineId: string;
  paymentType: "Rent" | "Purchase Option" | "Termination Penalty";
  status: "Pending" | "Invoiced" | "Skipped";
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amount: number;
};

function paymentsOf(
  terms: Parameters<typeof generateLeasePayments>[0],
  leaseLineId = LINE.id
): Payment[] {
  return generateLeasePayments(terms).map((row, index) => ({
    ...row,
    id: `pay_${index}`,
    leaseLineId,
    status: "Pending"
  }));
}

const TERMS = {
  commencementDate: LEASE.commencementDate,
  endDate: LEASE.endDate,
  paymentAmount: 10000,
  frequency: "Monthly" as const,
  timing: "Arrears" as const,
  annualEscalationPercent: 0,
  purchaseOptionAmount: 0,
  decimals: 2
};

/** The asset as activation measures it, with its schedule, the months
 *  before `postedThrough` stamped posted. */
function activated(terms: typeof TERMS, postedThrough: string | null = null) {
  const payments = paymentsOf(terms);
  const points = payments.map((payment) => ({
    monthIndex: paymentMonthIndex(
      payment,
      terms.commencementDate,
      terms.timing
    ),
    amount: payment.amount
  }));
  const liability = presentValueOfPayments({ payments: points, annualRate: 6 });
  const span = lesseeScheduleSpan(terms.commencementDate, terms.endDate);
  const schedule = buildLesseeSchedule({
    openingLiability: liability,
    openingRouAsset: liability,
    payments: points,
    months: span.months,
    annualRate: 6,
    timing: terms.timing,
    classification: "Operating",
    amortizationMonths: span.months,
    periodDates: span.periodDates
  }).map((row, index) => ({
    ...row,
    id: `sch_${index}`,
    leaseLineId: LINE.id,
    journalId: null as string | null,
    postedAt:
      postedThrough && row.periodDate <= postedThrough
        ? "2027-01-01T00:00:00Z"
        : null
  }));
  return {
    line: { ...LINE, initialLiability: liability, rouAssetCost: liability },
    payments,
    schedule
  };
}

describe("previewLesseeClassification", () => {
  it("classifies an asset from its payment rows", () => {
    const result = previewLesseeClassification({
      lease: LEASE,
      line: LINE,
      payments: paymentsOf(TERMS),
      policy: POLICY
    });
    expect(result?.preview?.applied).toBe("Operating");
    expect(result?.preview?.termMonths).toBe(36);
  });

  it("says why the treatment cannot be worked out", () => {
    const result = previewLesseeClassification({
      lease: { ...LEASE, discountRate: -1 },
      line: LINE,
      payments: paymentsOf(TERMS),
      policy: POLICY
    });
    expect(result?.preview).toBeUndefined();
    expect(result?.error).toMatch(/discount rate/);
  });

  it("waits for the dates", () => {
    expect(
      previewLesseeClassification({
        lease: { ...LEASE, endDate: null },
        line: LINE,
        payments: [],
        policy: POLICY
      })
    ).toBeNull();
  });
});

describe("skipped payments at activation", () => {
  const draft = { ...LEASE, status: "Draft" as const };
  const skipped = (dueDate: string): Payment => ({
    id: `skip_${dueDate}`,
    leaseLineId: LINE.id,
    paymentType: "Rent",
    status: "Skipped",
    periodStart: `${dueDate.slice(0, 8)}01`,
    periodEnd: dueDate,
    dueDate,
    amount: 10000
  });
  const gapsOf = (payments: Payment[], policy = POLICY) =>
    leaseActivationGaps({
      lease: draft,
      lines: [LINE],
      payments,
      baseCurrencyCode: "USD",
      policy
    });

  it("refuses a Skipped payment no invoice or opening balance relieves", () => {
    const payments = [skipped("2027-01-31"), ...paymentsOf(TERMS).slice(1)];
    expect(gapsOf(payments)).toEqual(["skippedPayment"]);
    expect(
      skippedPaymentBlockers({
        lease: draft,
        lines: [LINE],
        payments,
        policy: POLICY
      })
    ).toEqual([
      { leaseLineId: LINE.id, description: "Forklift", dueDate: "2027-01-31" }
    ]);
  });

  it("leaves a payment due before the commencement alone", () => {
    expect(gapsOf([skipped("2026-12-31"), ...paymentsOf(TERMS)])).toEqual([]);
  });

  it("accepts a payment the opening balance holds", () => {
    const policy = { ...POLICY, accountingCutoverDate: "2027-04-01" };
    expect(
      gapsOf([skipped("2027-03-31"), ...paymentsOf(TERMS).slice(3)], policy)
    ).toEqual([]);
    // April is not over on the cutover: its payment is still owed.
    expect(
      gapsOf(
        [
          skipped("2027-04-30"),
          ...paymentsOf(TERMS).filter((row) => row.dueDate !== "2027-04-30")
        ],
        policy
      )
    ).toEqual(["skippedPayment"]);
  });

  it("strikes the opening balance on the first open date after the cutover", () => {
    const policy = {
      ...POLICY,
      accountingCutoverDate: "2027-04-01",
      openingAsOf: "2027-05-01"
    };
    expect(
      gapsOf(
        [
          skipped("2027-04-30"),
          ...paymentsOf(TERMS).filter((row) => row.dueDate !== "2027-04-30")
        ],
        policy
      )
    ).toEqual([]);
  });

  it("ignores a short-term asset, which posts nothing", () => {
    const terms = { ...TERMS, endDate: "2027-12-31" };
    expect(
      leaseActivationGaps({
        lease: { ...draft, endDate: "2027-12-31" },
        lines: [LINE],
        payments: [skipped("2027-01-31"), ...paymentsOf(terms).slice(1)],
        baseCurrencyCode: "USD",
        policy: POLICY
      })
    ).toEqual([]);
  });
});

describe("canCancelLease", () => {
  const { line, payments, schedule } = activated(TERMS);
  const args = { lease: LEASE, lines: [line], payments, schedule, events: [] };

  it("allows an activation with nothing after it", () => {
    expect(canCancelLease(args)).toBe(true);
  });

  it("refuses once an asset has ended or an event exists", () => {
    expect(
      canCancelLease({ ...args, lines: [{ ...line, status: "Terminated" }] })
    ).toBe(false);
    expect(canCancelLease({ ...args, events: [{ id: "evt_1" }] })).toBe(false);
  });

  it("refuses once a payment is invoiced or a lease run has posted", () => {
    expect(
      canCancelLease({
        ...args,
        payments: [{ ...payments[0]!, status: "Invoiced" }]
      })
    ).toBe(false);
    expect(
      canCancelLease({
        ...args,
        schedule: [{ ...schedule[0]!, journalId: "jnl_1" }]
      })
    ).toBe(false);
  });
});

describe("purchasing a leased asset", () => {
  it("offers the purchase option at its price", () => {
    expect(
      leasePurchaseOffer(LEASE, { ...LINE, purchaseOptionAmount: 5000 })
    ).toEqual({ kind: "option", price: 5000 });
  });

  it("takes an asset whose ownership transfers on the end date, for nothing", () => {
    expect(
      leasePurchaseOffer(LEASE, { ...LINE, ownershipTransfers: true })
    ).toEqual({ kind: "ownership", exerciseDate: "2029-12-31" });
  });

  it("offers nothing without an option or a transfer, or for a short-term asset", () => {
    expect(leasePurchaseOffer(LEASE, LINE)).toBeNull();
    expect(
      leasePurchaseOffer(LEASE, {
        ...LINE,
        purchaseOptionAmount: 5000,
        lesseeClassification: "Short-Term"
      })
    ).toBeNull();
  });

  it("refuses what post-lease refuses", () => {
    const ownership = {
      kind: "ownership" as const,
      exerciseDate: "2029-12-31"
    };
    const base = { invoicedOption: null, assetCost: 100 };
    expect(
      leasePurchaseRefusal({
        ...base,
        offer: ownership,
        exerciseDate: "2029-11-30",
        price: 0
      })
    ).toBe("ownershipDate");
    expect(
      leasePurchaseRefusal({
        ...base,
        offer: ownership,
        exerciseDate: "2029-12-31",
        price: 1
      })
    ).toBe("ownershipPrice");
    expect(
      leasePurchaseRefusal({
        offer: { kind: "option", price: 5000 },
        exerciseDate: "2029-12-31",
        price: 4000,
        invoicedOption: 5000,
        assetCost: 100
      })
    ).toBe("invoicedPrice");
    expect(
      leasePurchaseRefusal({
        offer: { kind: "option", price: 5000 },
        exerciseDate: "2029-12-31",
        price: 0,
        invoicedOption: null,
        assetCost: -1
      })
    ).toBe("negativeCost");
    expect(
      leasePurchaseRefusal({
        ...base,
        offer: ownership,
        exerciseDate: "2029-12-31",
        price: 0
      })
    ).toBeNull();
  });

  it("previews the price an invoiced option already settles as nothing more payable", () => {
    const { line, payments, schedule } = activated(TERMS, "2029-11-30");
    const option: Payment = {
      id: "opt",
      leaseLineId: line.id,
      paymentType: "Purchase Option",
      status: "Invoiced",
      periodStart: "2029-11-30",
      periodEnd: "2029-11-30",
      dueDate: "2029-11-30",
      amount: 5000
    };
    const preview = leasePurchasePreview({
      line,
      payments: [...payments, option],
      schedule,
      exerciseDate: "2029-11-30",
      price: 5000
    });
    expect(preview.invoicedOption).toBe(5000);
    expect(
      preview.legs.find((leg) => leg.description === "Purchase price payable")
        ?.amount
    ).toBe(0);
  });
});

describe("modifying a lease", () => {
  const escalating = { ...TERMS, annualEscalationPercent: 3 };
  const lease = { ...LEASE, annualEscalationPercent: 3 };

  it("pre-fills the payment the asset pays at the effective date", () => {
    expect(leaseModifyPaymentAt(lease, LINE, "2027-12-01", 2)).toBe(10000);
    expect(leaseModifyPaymentAt(lease, LINE, "2028-07-01", 2)).toBe(10300);
    expect(leaseModifyPaymentAt(lease, LINE, "2029-01-01", 2)).toBe(10609);
  });

  it("remeasures nothing when the terms do not change", () => {
    // Escalation keeps the commencement's anniversaries: cut from the
    // effective date instead, the 3 % step would land in July 2029 and the
    // liability would fall.
    const { line, payments, schedule } = activated(escalating, "2028-06-30");
    const preview = leaseModifyPreview({
      lease,
      lines: [line],
      payments,
      schedule,
      terms: {
        effectiveDate: "2028-07-01",
        endDate: lease.endDate,
        discountRate: 6,
        paymentFrequency: "Monthly",
        annualEscalationPercent: 3
      },
      paymentOf: () => leaseModifyPaymentAt(lease, line, "2028-07-01", 2),
      decimals: 2
    });
    expect(preview).toHaveLength(1);
    expect(Math.abs(preview![0]!.result.adjustment)).toBeLessThan(0.05);
  });

  it("warns before a short-term asset runs past twelve months", () => {
    const shortTerm = { ...LINE, lesseeClassification: "Short-Term" as const };
    expect(shortTermPastTwelveMonths(LEASE, [shortTerm], "2027-12-31")).toBe(
      false
    );
    expect(shortTermPastTwelveMonths(LEASE, [shortTerm], "2028-01-01")).toBe(
      true
    );
    expect(shortTermPastTwelveMonths(LEASE, [LINE], "2028-01-01")).toBe(false);
  });
});

describe("leaseAssetBalances", () => {
  it("reads the balances after the last posted month", () => {
    const { line, schedule } = activated(TERMS, "2027-02-28");
    const balances = leaseAssetBalances(line, schedule);
    expect(balances?.postedThrough).toBe("2027-02-28");
    expect(balances?.liability).toBe(schedule[1]!.closingLiability);
    expect(balances?.netRouAsset).toBeCloseTo(schedule[1]!.closingRouAsset, 5);
  });

  it("has none for a short-term or ended asset", () => {
    const { line, schedule } = activated(TERMS);
    expect(
      leaseAssetBalances(
        { ...line, lesseeClassification: "Short-Term" },
        schedule
      )
    ).toBeNull();
    expect(
      leaseAssetBalances({ ...line, status: "Purchased" }, schedule)
    ).toBeNull();
  });
});
