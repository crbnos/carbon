// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// @carbon/content/glossary's terms.ts evaluates Lingui `msg` macros at module load,
// which vitest doesn't transform. Nothing under test touches the glossary
// (it's pulled in via the ../shared barrel), so stub the whole package.
vi.mock("@carbon/content/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (t: string) => t,
  terms: {}
}));

import * as purchasingModels from "./purchasing.models";
import {
  canCreatePurchaseOrderRevision,
  isPurchaseOrderLocked,
  leaseDurationOf,
  leaseEndDate,
  leaseLineValidator,
  leaseModifyValidator,
  leasePaymentValidator,
  leaseValidator,
  PURCHASE_ORDER_LOCKED_STATUSES,
  purchaseOrderStatusType,
  purchaseOrderValidator,
  supplierQuoteValidator
} from "./purchasing.models";

const ORDER_DATE = "2026-06-01";

describe("canCreatePurchaseOrderRevision", () => {
  // Full eligibility matrix for reopening (newStatus = "Draft").
  const reopenMatrix: Array<{
    currentStatus: (typeof purchaseOrderStatusType)[number];
    orderDate: string | null;
    expected: boolean;
  }> = [
    { currentStatus: "Draft", orderDate: null, expected: false },
    { currentStatus: "Draft", orderDate: ORDER_DATE, expected: false },
    { currentStatus: "Planned", orderDate: null, expected: false },
    { currentStatus: "Planned", orderDate: ORDER_DATE, expected: false },
    { currentStatus: "Needs Approval", orderDate: null, expected: false },
    { currentStatus: "Needs Approval", orderDate: ORDER_DATE, expected: false },
    { currentStatus: "To Review", orderDate: null, expected: false },
    { currentStatus: "To Review", orderDate: ORDER_DATE, expected: false },
    { currentStatus: "Rejected", orderDate: null, expected: false },
    { currentStatus: "Rejected", orderDate: ORDER_DATE, expected: false },
    { currentStatus: "To Receive", orderDate: ORDER_DATE, expected: true },
    {
      currentStatus: "To Receive and Invoice",
      orderDate: ORDER_DATE,
      expected: true
    },
    { currentStatus: "To Invoice", orderDate: ORDER_DATE, expected: true },
    { currentStatus: "Completed", orderDate: ORDER_DATE, expected: true },
    { currentStatus: "Closed", orderDate: ORDER_DATE, expected: true },
    { currentStatus: "Closed", orderDate: null, expected: false },
    { currentStatus: "To Receive", orderDate: null, expected: false }
  ];

  it.each(
    reopenMatrix
  )("reopen from $currentStatus (orderDate: $orderDate) → eligible: $expected", ({
    currentStatus,
    orderDate,
    expected
  }) => {
    expect(
      canCreatePurchaseOrderRevision({
        newStatus: "Draft",
        currentStatus,
        orderDate
      })
    ).toBe(expected);
  });

  it("follows the same matrix when reopening to Planned", () => {
    for (const { currentStatus, orderDate, expected } of reopenMatrix) {
      expect(
        canCreatePurchaseOrderRevision({
          newStatus: "Planned",
          currentStatus,
          orderDate
        })
      ).toBe(expected);
    }
  });

  it("is never eligible for a target status that is not a reopen", () => {
    for (const newStatus of purchaseOrderStatusType) {
      if (newStatus === "Draft" || newStatus === "Planned") continue;
      for (const currentStatus of purchaseOrderStatusType) {
        expect(
          canCreatePurchaseOrderRevision({
            newStatus,
            currentStatus,
            orderDate: ORDER_DATE
          })
        ).toBe(false);
      }
    }
  });

  it("is not eligible for an unknown or missing current status", () => {
    expect(
      canCreatePurchaseOrderRevision({
        newStatus: "Draft",
        currentStatus: null,
        orderDate: ORDER_DATE
      })
    ).toBe(false);
    expect(
      canCreatePurchaseOrderRevision({
        newStatus: "Draft",
        currentStatus: undefined,
        orderDate: ORDER_DATE
      })
    ).toBe(false);
  });

  it("locked statuses stay consistent with the reopen matrix", () => {
    const bumpingStatuses = reopenMatrix
      .filter((row) => row.expected)
      .map((row) => row.currentStatus)
      .sort();
    expect(bumpingStatuses).toEqual([...PURCHASE_ORDER_LOCKED_STATUSES].sort());
    for (const status of PURCHASE_ORDER_LOCKED_STATUSES) {
      expect(isPurchaseOrderLocked(status)).toBe(true);
    }
  });
});

describe("the document validators carry no contact requirement (D-2)", () => {
  /**
   * The requirement is on the SUPPLIER RECORD, checked once at the release
   * boundary by `checkPartyContactRequirement` — not on the document. The
   * `make*Validator` factories that made `supplierContactId` /
   * `supplierLocationId` required were absent from every create action (so the
   * API, MCP and curl wrote a null contact anyway) and refused to save an
   * EXISTING draft whose optional location was null, which blocked editing
   * unrelated fields such as `supplierReference`.
   */
  it("offers no strict variant to build a document-level rule from", () => {
    const exported = Object.keys(purchasingModels);
    expect(exported).not.toContain("makePurchaseOrderValidator");
    expect(exported).not.toContain("makeSupplierQuoteValidator");
  });

  it("saves a draft whose optional supplier location is null", () => {
    // The concrete regression: a Draft PO with no location could no longer have
    // its supplier reference changed.
    expect(
      purchaseOrderValidator.safeParse({
        id: "po_1",
        purchaseOrderType: "Purchase",
        supplierId: "sup_1",
        supplierReference: "PO-4417"
      }).success
    ).toBe(true);

    expect(
      supplierQuoteValidator.safeParse({
        id: "sq_1",
        supplierQuoteType: "Purchase",
        supplierId: "sup_1",
        supplierReference: "RFQ-9"
      }).success
    ).toBe(true);
  });
});

describe("leaseValidator", () => {
  const base = {
    supplierId: "supplier-1",
    commencementDate: "2027-01-01",
    endDate: "2029-12-31",
    paymentFrequency: "Monthly",
    paymentTiming: "Arrears",
    discountRate: "6",
    currencyCode: "USD"
  };
  const parse = (overrides: Record<string, string>) =>
    leaseValidator.safeParse({ ...base, ...overrides });

  it("accepts a lease with only the required terms", () => {
    const result = parse({});
    expect(result.success).toBe(true);
    expect(result.data?.annualEscalationPercent).toBe(0);
  });

  it("refuses an end date before the commencement date", () => {
    expect(parse({ endDate: "2026-12-31" }).success).toBe(false);
  });

  it("refuses a notice date after the end date", () => {
    expect(parse({ noticeDate: "2030-01-31" }).success).toBe(false);
    expect(parse({ noticeDate: "2029-09-30" }).success).toBe(true);
  });

  it("refuses invoicing that starts before commencement", () => {
    expect(parse({ invoiceFromDate: "2026-12-01" }).success).toBe(false);
  });
});

describe("lease durations", () => {
  it("ends a preset the day before the same date N months on", () => {
    expect(leaseEndDate("2027-01-01", "36")).toBe("2029-12-31");
    expect(leaseEndDate("2027-01-31", "12")).toBe("2028-01-30");
    expect(leaseEndDate("2027-01-01", "open")).toBeNull();
    expect(leaseEndDate("2027-01-01", "custom", "2027-06-30")).toBe(
      "2027-06-30"
    );
  });

  it("reads the duration back from the dates", () => {
    const of = (endDate: string | null) =>
      leaseDurationOf({ commencementDate: "2027-01-01", endDate });
    expect(of("2029-12-31")).toBe("36");
    expect(of(null)).toBe("open");
    expect(of("2029-06-30")).toBe("custom");
  });

  it("needs an end date only for a custom duration", () => {
    const parse = (overrides: Record<string, string>) =>
      leaseValidator.safeParse({
        supplierId: "supplier-1",
        commencementDate: "2027-01-01",
        paymentFrequency: "Monthly",
        paymentTiming: "Arrears",
        discountRate: "6",
        currencyCode: "USD",
        ...overrides
      });
    expect(parse({ duration: "open" }).success).toBe(true);
    expect(parse({ duration: "36" }).success).toBe(true);
    expect(parse({ duration: "custom" }).success).toBe(false);
    expect(parse({ duration: "custom", endDate: "2026-12-31" }).success).toBe(
      false
    );
    expect(parse({ duration: "custom", endDate: "2027-06-30" }).success).toBe(
      true
    );
  });
});

describe("leaseLineValidator", () => {
  const parse = (overrides: Record<string, string>) =>
    leaseLineValidator.safeParse({
      leaseId: "lease-1",
      description: "Forklift FL-12",
      paymentAmount: "10000",
      ...overrides
    });

  it("accepts an asset with only a description and a payment", () => {
    const result = parse({});
    expect(result.success).toBe(true);
    expect(result.data?.ownershipTransfers).toBe(false);
  });

  it("needs a description", () => {
    expect(parse({ description: " " }).success).toBe(false);
  });

  it("needs an amount for a reasonably certain purchase option", () => {
    expect(parse({ purchaseOptionReasonablyCertain: "on" }).success).toBe(
      false
    );
    expect(
      parse({
        purchaseOptionReasonablyCertain: "on",
        purchaseOptionAmount: "20000"
      }).success
    ).toBe(true);
  });
});

describe("leasePaymentValidator", () => {
  it("refuses a period that ends before it starts", () => {
    expect(
      leasePaymentValidator.safeParse({
        leaseId: "lease-1",
        leaseLineId: "line-1",
        periodStart: "2027-02-01",
        periodEnd: "2027-01-31",
        dueDate: "2027-01-31",
        amount: "100"
      }).success
    ).toBe(false);
  });
});

describe("leaseModifyValidator", () => {
  const terms = {
    effectiveDate: "2028-01-01",
    endDate: "2029-12-31",
    discountRate: "7",
    lines: [{ leaseLineId: "line-1", paymentAmount: "10000" }],
    paymentFrequency: "Monthly"
  };

  it("takes a payment for each asset", () => {
    const result = leaseModifyValidator.safeParse(terms);
    expect(result.success).toBe(true);
    expect(result.data?.lines).toEqual([
      { leaseLineId: "line-1", paymentAmount: 10000 }
    ]);
  });

  it("refuses an end date before the effective date", () => {
    expect(
      leaseModifyValidator.safeParse({ ...terms, endDate: "2027-12-31" })
        .success
    ).toBe(false);
  });
});
