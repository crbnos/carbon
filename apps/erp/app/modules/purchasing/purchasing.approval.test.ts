// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

import {
  exceedsApprovedAmount,
  isPurchaseOrderEditLocked,
  isPurchaseOrderLocked,
  PURCHASE_ORDER_AMENDABLE_STATUSES,
  PURCHASE_ORDER_RELEASED_STATUSES,
  purchaseOrderEditRefusal,
  purchaseOrderFundsRefusal,
  purchaseOrderLineAmendRefusal,
  purchaseOrderLineDateRefusal,
  purchaseOrderStatusType
} from "./purchasing.models";

const UNRELEASED = purchaseOrderStatusType.filter(
  (status) =>
    !(PURCHASE_ORDER_RELEASED_STATUSES as readonly string[]).includes(status)
);

describe("purchaseOrderFundsRefusal", () => {
  it.each(UNRELEASED)("refuses a %s order", (status) => {
    expect(
      purchaseOrderFundsRefusal({ status, total: 100, approvedAmount: 100 })
    ).toMatch(/must be approved and released/);
  });

  it.each([...PURCHASE_ORDER_RELEASED_STATUSES])(
    "allows a %s order within its approved amount",
    (status) => {
      expect(
        purchaseOrderFundsRefusal({ status, total: 100, approvedAmount: 100 })
      ).toBeNull();
    }
  );

  it("allows a released order with no approval request", () => {
    expect(
      purchaseOrderFundsRefusal({
        status: "To Receive",
        total: 5000,
        approvedAmount: null
      })
    ).toBeNull();
  });

  it("refuses a released order above its approved amount", () => {
    expect(
      purchaseOrderFundsRefusal({
        readableId: "PO000012",
        status: "To Receive",
        total: 100.01,
        approvedAmount: 100
      })
    ).toBe(
      "Purchase order PO000012 totals more than its approved amount. It must be approved again before it can be received or invoiced."
    );
  });
});

describe("exceedsApprovedAmount", () => {
  it("ignores float noise", () => {
    expect(exceedsApprovedAmount(0.1 + 0.2, 0.3)).toBe(false);
  });

  it("never exceeds when nothing was approved", () => {
    expect(exceedsApprovedAmount(1_000_000, null)).toBe(false);
  });

  it("allows a lower total", () => {
    expect(exceedsApprovedAmount(80, 100)).toBe(false);
  });
});

describe("purchaseOrderEditRefusal", () => {
  it("locks an order waiting for approval", () => {
    expect(purchaseOrderEditRefusal("Needs Approval")).toMatch(
      /waiting for approval/
    );
  });

  it.each(["Completed", "Closed"])("locks a %s order", (status) => {
    expect(purchaseOrderEditRefusal(status)).toMatch(/completed or closed/);
  });

  it.each([...PURCHASE_ORDER_AMENDABLE_STATUSES])(
    "allows editing a %s order",
    (status) => {
      expect(purchaseOrderEditRefusal(status)).toBeNull();
    }
  );

  it.each([...PURCHASE_ORDER_AMENDABLE_STATUSES])(
    "refuses a new supplier or currency on a %s order",
    (status) => {
      expect(
        purchaseOrderEditRefusal(status, { changesSupplierOrCurrency: true })
      ).toMatch(/supplier or currency/);
    }
  );

  it("lets a Draft order change its supplier", () => {
    expect(
      purchaseOrderEditRefusal("Draft", { changesSupplierOrCurrency: true })
    ).toBeNull();
  });

  it("is the edit lock the forms read", () => {
    for (const status of purchaseOrderStatusType) {
      expect(isPurchaseOrderEditLocked(status)).toBe(
        purchaseOrderEditRefusal(status) !== null
      );
    }
  });

  it("leaves the reopen lock unchanged", () => {
    expect(isPurchaseOrderLocked("To Receive")).toBe(true);
    expect(isPurchaseOrderEditLocked("To Receive")).toBe(false);
  });
});

describe("purchaseOrderLineAmendRefusal", () => {
  const received = { quantityReceived: 4, quantityInvoiced: 6 };

  it("keeps a line at or above what was invoiced", () => {
    expect(purchaseOrderLineAmendRefusal(received, 5)).toMatch(
      /6 already received or invoiced/
    );
    expect(purchaseOrderLineAmendRefusal(received, 6)).toBeNull();
  });

  it("refuses deleting a line with receipts", () => {
    expect(purchaseOrderLineAmendRefusal(received, null)).toMatch(
      /Cannot delete/
    );
  });

  it("allows deleting a line with nothing received", () => {
    expect(
      purchaseOrderLineAmendRefusal(
        { quantityReceived: 0, quantityInvoiced: null },
        null
      )
    ).toBeNull();
  });

  it("allows an edit that leaves the quantity alone", () => {
    expect(purchaseOrderLineAmendRefusal(received, undefined)).toBeNull();
  });
});

describe("purchaseOrderLineDateRefusal requested date", () => {
  it("is editable on a released order", () => {
    expect(
      purchaseOrderLineDateRefusal("requiredDate", {
        status: "To Receive",
        receivedComplete: false
      })
    ).toBeNull();
  });

  it("is locked while the order waits for approval", () => {
    expect(
      purchaseOrderLineDateRefusal("requiredDate", {
        status: "Needs Approval",
        receivedComplete: false
      })
    ).not.toBeNull();
  });
});
