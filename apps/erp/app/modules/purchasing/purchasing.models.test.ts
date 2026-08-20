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
