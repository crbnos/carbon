// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { cutLeasePaymentRows } from "~/modules/shared/shared.service";

const lease = {
  commencementDate: "2027-01-01",
  endDate: "2029-12-31" as string | null,
  invoiceFromDate: "2027-01-01",
  paymentFrequency: "Monthly" as const,
  paymentTiming: "Arrears" as const,
  annualEscalationPercent: 0
};

const asset = {
  id: "line-1",
  paymentAmount: 10000,
  purchaseOptionAmount: null as number | null,
  purchaseOptionReasonablyCertain: false
};

describe("cutLeasePaymentRows", () => {
  it("cuts every period of the term for the asset, Pending", () => {
    const { commencementPayment, rows } = cutLeasePaymentRows({
      lease,
      asset,
      decimals: 2
    });
    expect(commencementPayment).toBe(10000);
    expect(rows).toHaveLength(36);
    expect(rows[0]).toEqual({
      leaseLineId: "line-1",
      paymentType: "Rent",
      periodStart: "2027-01-01",
      periodEnd: "2027-01-31",
      dueDate: "2027-01-31",
      amount: 10000,
      status: "Pending"
    });
  });

  it("skips a row due before the invoice-from date: it was paid outside Carbon", () => {
    const { rows } = cutLeasePaymentRows({
      lease: { ...lease, invoiceFromDate: "2027-03-15" },
      asset,
      decimals: 2
    });
    expect(rows.slice(0, 3).map((row) => row.status)).toEqual([
      "Skipped",
      "Skipped",
      "Pending" // due 2027-03-31
    ]);
  });

  it("adds the purchase option only when it is reasonably certain", () => {
    const uncertain = cutLeasePaymentRows({
      lease,
      asset: { ...asset, purchaseOptionAmount: 5000 },
      decimals: 2
    });
    expect(
      uncertain.rows.some((row) => row.paymentType === "Purchase Option")
    ).toBe(false);
    const certain = cutLeasePaymentRows({
      lease,
      asset: {
        ...asset,
        purchaseOptionAmount: 5000,
        purchaseOptionReasonablyCertain: true
      },
      decimals: 2
    });
    expect(certain.rows.at(-1)).toMatchObject({
      paymentType: "Purchase Option",
      dueDate: "2029-12-31",
      amount: 5000
    });
  });

  it("cuts an open-ended lease through the horizon, after the rows it has", () => {
    const { rows } = cutLeasePaymentRows({
      lease: { ...lease, endDate: null },
      asset: {
        ...asset,
        purchaseOptionAmount: 5000,
        purchaseOptionReasonablyCertain: true
      },
      decimals: 2,
      through: "2027-04-01",
      after: "2027-02-01"
    });
    expect(rows.map((row) => row.periodStart)).toEqual([
      "2027-03-01",
      "2027-04-01"
    ]);
    expect(rows.every((row) => row.paymentType === "Rent")).toBe(true);
  });

  describe("from a lease month (Modify)", () => {
    it("escalates on the commencement's anniversaries, from the rate at the date", () => {
      const { commencementPayment, rows } = cutLeasePaymentRows({
        lease: { ...lease, annualEscalationPercent: 3 },
        asset,
        decimals: 2,
        from: { month: 18, paymentAtStart: 10300 }
      });
      expect(commencementPayment).toBeCloseTo(10000, 5);
      expect(rows[0]).toMatchObject({
        periodStart: "2028-07-01",
        dueDate: "2028-07-31",
        amount: 10300
      });
      expect(rows.find((row) => row.dueDate === "2029-01-31")?.amount).toBe(
        10609
      );
      expect(rows).toHaveLength(18);
    });

    it("cuts a period the new frequency started earlier down to its days", () => {
      // Quarterly from the commencement: Jan–Mar, Apr–Jun … A change in
      // February leaves February and March of the first quarter.
      const { rows } = cutLeasePaymentRows({
        lease: { ...lease, paymentFrequency: "Quarterly" },
        asset,
        decimals: 2,
        from: { month: 1, paymentAtStart: 3000 }
      });
      expect(rows[0]).toEqual({
        leaseLineId: "line-1",
        periodStart: "2027-02-01",
        periodEnd: "2027-03-31",
        dueDate: "2027-03-31",
        paymentType: "Rent",
        amount: 1966.67, // 3,000 × 59 / 90 days, at 2 decimals
        status: "Pending"
      });
      expect(rows[1]?.periodStart).toBe("2027-04-01");
    });

    it("keeps the months of a lease from the 31st", () => {
      const { rows } = cutLeasePaymentRows({
        lease: {
          ...lease,
          commencementDate: "2027-01-31",
          endDate: "2030-01-30"
        },
        asset,
        decimals: 2,
        from: { month: 1, paymentAtStart: 1000 }
      });
      expect(rows.slice(0, 3).map((row) => row.periodStart)).toEqual([
        "2027-02-28",
        "2027-03-31",
        "2027-04-30"
      ]);
    });

    it("keeps only the purchase option when the payment from the date is 0", () => {
      const { rows } = cutLeasePaymentRows({
        lease,
        asset: {
          ...asset,
          purchaseOptionAmount: 5000,
          purchaseOptionReasonablyCertain: true
        },
        decimals: 2,
        from: { month: 12, paymentAtStart: 0 }
      });
      expect(rows).toEqual([
        expect.objectContaining({ paymentType: "Purchase Option" })
      ]);
    });
  });
});
