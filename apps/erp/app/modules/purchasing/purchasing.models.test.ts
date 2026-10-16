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
  leaseClassificationValidator,
  leaseDetailsValidator,
  leaseDurationOf,
  leaseEndDate,
  leaseLineValidator,
  leaseModifyValidator,
  leasePaymentValidator,
  leasePurchaseValidator,
  leaseTermColumns,
  leaseTerminateValidator,
  leaseValidator,
  lockedReturnLineField,
  PURCHASE_ORDER_LOCKED_STATUSES,
  purchaseOrderDeleteRefusal,
  purchaseOrderStatusType,
  purchaseOrderValidator,
  resolveLeaseDates,
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

  it.each(reopenMatrix)(
    "reopen from $currentStatus (orderDate: $orderDate) → eligible: $expected",
    ({ currentStatus, orderDate, expected }) => {
      expect(
        canCreatePurchaseOrderRevision({
          newStatus: "Draft",
          currentStatus,
          orderDate
        })
      ).toBe(expected);
    }
  );

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

describe("lease dates", () => {
  const base = {
    supplierId: "supplier-1",
    commencementDate: "2027-01-01",
    endDate: "2029-12-31",
    paymentFrequency: "Monthly",
    paymentTiming: "Arrears",
    discountRate: "6",
    currencyCode: "USD"
  };

  it("refuses a lease date that is not a YYYY-MM-DD calendar date", () => {
    for (const field of [
      "commencementDate",
      "endDate",
      "noticeDate",
      "invoiceFromDate"
    ]) {
      for (const value of ["2027-02-30", "01/02/2027", "soon"]) {
        const result = leaseValidator.safeParse({ ...base, [field]: value });
        expect(result.success, `${field} = ${value}`).toBe(false);
      }
    }
  });

  it("reports a bad commencement date instead of throwing from the notice refine", () => {
    expect(() =>
      leaseValidator.safeParse({
        ...base,
        commencementDate: "not-a-date",
        duration: "36",
        noticeDate: "2029-06-30"
      })
    ).not.toThrow();
  });

  it("refuses a payment row date, and a Modify date, that is not a date", () => {
    expect(
      leasePaymentValidator.safeParse({
        leaseId: "lease-1",
        leaseLineId: "line-1",
        periodStart: "2027-01-01",
        periodEnd: "2027-01-31",
        dueDate: "2027-01-32",
        amount: "100"
      }).success
    ).toBe(false);
    expect(
      leaseModifyValidator.safeParse({
        effectiveDate: "2028-1-1",
        endDate: "2029-12-31",
        discountRate: "7",
        lines: [],
        paymentFrequency: "Monthly"
      }).success
    ).toBe(false);
  });
});

describe("resolveLeaseDates", () => {
  const current = {
    commencementDate: "2027-01-01",
    invoiceFromDate: "2027-01-01"
  };

  it("moves invoicing with the commencement while it still starts there", () => {
    expect(
      resolveLeaseDates(current, {
        commencementDate: "2027-03-01",
        invoiceFromDate: "2027-01-01"
      }).invoiceFromDate
    ).toBe("2027-03-01");
    expect(
      resolveLeaseDates(current, { commencementDate: "2027-03-01" })
        .invoiceFromDate
    ).toBe("2027-03-01");
  });

  it("keeps an invoice-from date that was moved, or that the same save moves", () => {
    expect(
      resolveLeaseDates(
        { commencementDate: "2027-01-01", invoiceFromDate: "2027-06-01" },
        { commencementDate: "2027-03-01", invoiceFromDate: "2027-06-01" }
      ).invoiceFromDate
    ).toBe("2027-06-01");
    expect(
      resolveLeaseDates(current, {
        commencementDate: "2027-03-01",
        invoiceFromDate: "2027-05-01"
      }).invoiceFromDate
    ).toBe("2027-05-01");
  });

  it("takes the end date from a duration, and defaults invoicing for a new lease", () => {
    expect(
      resolveLeaseDates(null, {
        commencementDate: "2027-01-01",
        duration: "36"
      })
    ).toEqual({
      commencementDate: "2027-01-01",
      endDate: "2029-12-31",
      invoiceFromDate: "2027-01-01"
    });
    expect(
      resolveLeaseDates(null, {
        commencementDate: "2027-01-01",
        duration: "open",
        endDate: "2027-06-30"
      }).endDate
    ).toBeNull();
  });
});

describe("leaseTermColumns", () => {
  it("writes the terms only, never what activation owns", () => {
    const parsed = leaseValidator.parse({
      supplierId: "supplier-1",
      commencementDate: "2027-01-01",
      duration: "12",
      paymentFrequency: "Monthly",
      paymentTiming: "Arrears",
      discountRate: "6",
      currencyCode: "USD",
      noticeDate: ""
    });
    const columns = leaseTermColumns({
      ...parsed,
      // An MCP caller's extra keys reach the service unfiltered.
      ...({ status: "Active", commencementJournalId: "j-1" } as object)
    });
    expect(columns).not.toHaveProperty("status");
    expect(columns).not.toHaveProperty("commencementJournalId");
    expect(columns).toMatchObject({
      endDate: "2027-12-31",
      invoiceFromDate: "2027-01-01",
      noticeDate: null
    });
  });
});

describe("leaseDetailsValidator", () => {
  it("refuses a notice date after the end date it is checked against", () => {
    expect(
      leaseDetailsValidator.safeParse({
        noticeDate: "2030-01-31",
        endDate: "2029-12-31"
      }).success
    ).toBe(false);
    expect(
      leaseDetailsValidator.safeParse({
        noticeDate: "2029-09-30",
        endDate: "2029-12-31"
      }).success
    ).toBe(true);
    expect(leaseDetailsValidator.safeParse({ name: "Forklift" }).success).toBe(
      true
    );
  });
});

describe("lease action validators", () => {
  it("terminate: a date, and a penalty that defaults to 0 and is never negative", () => {
    const ok = leaseTerminateValidator.safeParse({
      terminationDate: "2028-06-30"
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.penaltyAmount).toBe(0);
    expect(
      leaseTerminateValidator.safeParse({
        terminationDate: "2028-06-30",
        penaltyAmount: "-1"
      }).success
    ).toBe(false);
    expect(
      leaseTerminateValidator.safeParse({ terminationDate: "" }).success
    ).toBe(false);
  });

  it("purchase: a price of 0 or more, a fixed asset class and a name", () => {
    const terms = {
      exerciseDate: "2029-12-31",
      purchasePrice: "0",
      fixedAssetClassId: "class-1",
      name: "Forklift FL-12"
    };
    expect(leasePurchaseValidator.safeParse(terms).success).toBe(true);
    expect(
      leasePurchaseValidator.safeParse({ ...terms, purchasePrice: "-5" })
        .success
    ).toBe(false);
    expect(
      leasePurchaseValidator.safeParse({ ...terms, fixedAssetClassId: "" })
        .success
    ).toBe(false);
    expect(
      leasePurchaseValidator.safeParse({ ...terms, name: " " }).success
    ).toBe(false);
  });

  it("classification: Operating or Finance, with a reason", () => {
    expect(
      leaseClassificationValidator.safeParse({
        classification: "Finance",
        reason: "Specialized tooling"
      }).success
    ).toBe(true);
    expect(
      leaseClassificationValidator.safeParse({
        classification: "Short-Term",
        reason: "Under a year"
      }).success
    ).toBe(false);
    expect(
      leaseClassificationValidator.safeParse({
        classification: "Operating",
        reason: " "
      }).success
    ).toBe(false);
  });
});

describe("purchaseOrderDeleteRefusal", () => {
  it("allows a Draft or Planned order whoever asks", () => {
    for (const status of ["Draft", "Planned"]) {
      expect(
        purchaseOrderDeleteRefusal({ status, requestedBy: "u2", userId: "u1" })
      ).toBeNull();
    }
  });

  it("refuses every released or closed order", () => {
    for (const status of PURCHASE_ORDER_LOCKED_STATUSES) {
      expect(
        purchaseOrderDeleteRefusal({ status, requestedBy: null, userId: "u1" })
      ).toBe("status");
    }
  });

  it("lets only the requester delete an order that needs approval", () => {
    const needsApproval = { status: "Needs Approval", userId: "u1" };
    expect(
      purchaseOrderDeleteRefusal({ ...needsApproval, requestedBy: "u1" })
    ).toBeNull();
    expect(
      purchaseOrderDeleteRefusal({ ...needsApproval, requestedBy: "u2" })
    ).toBe("notRequester");
    // No pending request left: nothing to protect.
    expect(
      purchaseOrderDeleteRefusal({ ...needsApproval, requestedBy: null })
    ).toBeNull();
  });
});

describe("lockedReturnLineField", () => {
  const saved = {
    quantity: 4,
    itemId: "item-1",
    unitPrice: 10,
    restockFeePercent: 0.1,
    unitOfMeasureCode: "EA",
    purchaseOrderLineId: "pol-1",
    receiptLineId: null,
    purchaseInvoiceLineId: null
  };
  const unchanged = {
    quantity: 4,
    itemId: "item-1",
    unitPrice: 10,
    restockFeePercent: 0.1,
    unitOfMeasureCode: "EA",
    purchaseOrderLineId: "pol-1"
  };

  it("passes a change that moves no locked field", () => {
    expect(lockedReturnLineField(unchanged, saved)).toBeNull();
  });

  it("names the first locked field that moves", () => {
    expect(lockedReturnLineField({ ...unchanged, quantity: 5 }, saved)).toBe(
      "Quantity"
    );
    expect(
      lockedReturnLineField({ ...unchanged, receiptLineId: "rl-1" }, saved)
    ).toBe("Receipt line link");
  });

  it("ignores a field that was not sent", () => {
    expect(
      lockedReturnLineField(
        {
          ...unchanged,
          restockFeePercent: undefined,
          unitOfMeasureCode: undefined
        },
        saved
      )
    ).toBeNull();
  });
});
