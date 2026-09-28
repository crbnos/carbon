import { describe, expect, it, vi } from "vitest";

// @carbon/glossary's terms.ts evaluates Lingui `msg` macros at module load,
// which vitest doesn't transform. Nothing under test touches the glossary
// (it's pulled in via the ../shared barrel), so stub the whole package.
vi.mock("@carbon/glossary", () => ({
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

import {
  canCreatePurchaseOrderRevision,
  isPurchaseOrderLocked,
  makePurchaseOrderValidator,
  PURCHASE_ORDER_LOCKED_STATUSES,
  purchaseOrderStatusType,
  purchaseOrderValidator
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

  it("is never eligible for a non-Draft target status", () => {
    for (const newStatus of purchaseOrderStatusType) {
      if (newStatus === "Draft") continue;
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

describe("makePurchaseOrderValidator", () => {
  /**
   * `requireSupplierContactAndLocation` is a company setting, so the schema is built per
   * request. Enforcing it in the SCHEMA rather than in the action is what makes
   * the error land on the field: a route-level check could only flash after the
   * fact, and when the flash was miswired it failed silently — the document just
   * did not finalize and nothing said why.
   */
  const base = {
    purchaseOrderType: "Purchase" as const,
    supplierId: "sup_1"
  };

  it("leaves the contact optional by default", () => {
    const result = makePurchaseOrderValidator().safeParse(base);
    expect(result.success).toBe(true);
  });

  it("is byte-identical to the exported validator when the setting is off", () => {
    // The common path must not change shape — a ternary inside `z.object`
    // widened the inferred type and made the field look required to every
    // existing caller.
    expect(makePurchaseOrderValidator()).toBe(purchaseOrderValidator);
    expect(
      makePurchaseOrderValidator({ requireSupplierContactAndLocation: false })
    ).toBe(purchaseOrderValidator);
  });

  it("requires BOTH the contact and the location when the setting is on", () => {
    // Ramp refuses a vendor create missing either one (no `country` → 422, no
    // `business_vendor_contacts` → 422; verified live 2026-09-28), so requiring
    // only the contact would still let the document post and fail at push time.
    const validatorWith = makePurchaseOrderValidator({
      requireSupplierContactAndLocation: true
    });

    const missing = validatorWith.safeParse(base);
    expect(missing.success).toBe(false);
    const issues = JSON.stringify(missing.error?.issues);
    expect(issues).toContain("Supplier contact is required");
    expect(issues).toContain("Supplier location is required");

    const contactOnly = validatorWith.safeParse({
      ...base,
      supplierContactId: "cnt_1"
    });
    expect(contactOnly.success).toBe(false);

    const locationOnly = validatorWith.safeParse({
      ...base,
      supplierLocationId: "loc_1"
    });
    expect(locationOnly.success).toBe(false);

    const present = validatorWith.safeParse({
      ...base,
      supplierContactId: "cnt_1",
      supplierLocationId: "loc_1"
    });
    expect(present.success).toBe(true);
  });

  it("rejects empty values, not just absent ones", () => {
    // An empty select posts "" rather than omitting the field.
    const result = makePurchaseOrderValidator({
      requireSupplierContactAndLocation: true
    }).safeParse({ ...base, supplierContactId: "", supplierLocationId: "" });

    expect(result.success).toBe(false);
  });
});
