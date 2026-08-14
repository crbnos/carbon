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
  PURCHASE_ORDER_LOCKED_STATUSES,
  purchaseOrderStatusType
} from "./purchasing.models";

const ORDER_DATE = "2026-06-01";

describe("canCreatePurchaseOrderRevision", () => {
  // The full ELIGIBILITY matrix for reopening (newStatus = "Draft"). The bump
  // itself additionally requires the explicit createRevision flag posted by
  // the "Create PO Revision" action — this predicate is the guard that keeps
  // that flag inert outside a released-order reopen.
  const reopenMatrix: Array<{
    currentStatus: (typeof purchaseOrderStatusType)[number];
    orderDate: string | null;
    expected: boolean;
  }> = [
    // Never-released statuses: no bump regardless of orderDate
    { currentStatus: "Draft", orderDate: null, expected: false },
    { currentStatus: "Draft", orderDate: ORDER_DATE, expected: false },
    { currentStatus: "Planned", orderDate: null, expected: false },
    { currentStatus: "Planned", orderDate: ORDER_DATE, expected: false },
    { currentStatus: "Needs Approval", orderDate: null, expected: false },
    // orderDate is set at finalize, before approval — a pending-approval order
    // still hasn't reached the supplier, so no bump.
    { currentStatus: "Needs Approval", orderDate: ORDER_DATE, expected: false },
    { currentStatus: "To Review", orderDate: null, expected: false },
    { currentStatus: "To Review", orderDate: ORDER_DATE, expected: false },
    { currentStatus: "Rejected", orderDate: null, expected: false },
    { currentStatus: "Rejected", orderDate: ORDER_DATE, expected: false },
    // Released (locked) statuses: bump — the supplier has the current document
    { currentStatus: "To Receive", orderDate: ORDER_DATE, expected: true },
    {
      currentStatus: "To Receive and Invoice",
      orderDate: ORDER_DATE,
      expected: true
    },
    { currentStatus: "To Invoice", orderDate: ORDER_DATE, expected: true },
    { currentStatus: "Completed", orderDate: ORDER_DATE, expected: true },
    { currentStatus: "Closed", orderDate: ORDER_DATE, expected: true },
    // Closed straight from Draft (never finalized, so no orderDate): no bump
    { currentStatus: "Closed", orderDate: null, expected: false },
    // Defensive: a locked status without an orderDate should not bump
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
    // If a status is ever added to PURCHASE_ORDER_LOCKED_STATUSES, the matrix
    // above must gain rows for it — this guard fails until it does.
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
