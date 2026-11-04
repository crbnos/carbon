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
  type PurchaseOrderRestoreLine,
  type PurchaseOrderVersion,
  planPurchaseOrderRestore,
  purchaseOrderEditRefusal,
  purchaseOrderFundsRefusal,
  purchaseOrderLineAmendRefusal,
  purchaseOrderLineDateRefusal,
  purchaseOrderLineDeleteRefusal,
  purchaseOrderLineRemainingToInvoice,
  purchaseOrderStatusType
} from "./purchasing.models";

const UNRELEASED = purchaseOrderStatusType.filter(
  (status) =>
    !(PURCHASE_ORDER_RELEASED_STATUSES as readonly string[]).includes(status)
);

describe("purchaseOrderFundsRefusal", () => {
  const order = (
    overrides: Partial<Parameters<typeof purchaseOrderFundsRefusal>[0]> = {}
  ) => ({
    status: "To Receive",
    total: 100,
    approvedAmount: 100,
    receivedQuantity: 1,
    ...overrides
  });

  it.each(UNRELEASED)("refuses to receive against a %s order", (status) => {
    expect(
      purchaseOrderFundsRefusal(order({ status }), "receive")
    ).not.toBeNull();
  });

  it.each(UNRELEASED.filter((status) => status !== "Closed"))(
    "refuses to invoice a %s order",
    (status) => {
      expect(
        purchaseOrderFundsRefusal(order({ status }), "invoice")
      ).not.toBeNull();
    }
  );

  it.each([...PURCHASE_ORDER_RELEASED_STATUSES])(
    "allows a %s order within its approved amount",
    (status) => {
      expect(
        purchaseOrderFundsRefusal(order({ status }), "receive")
      ).toBeNull();
      expect(
        purchaseOrderFundsRefusal(order({ status }), "invoice")
      ).toBeNull();
    }
  );

  it("bills what a closed order already received", () => {
    expect(
      purchaseOrderFundsRefusal(order({ status: "Closed" }), "invoice")
    ).toBeNull();
  });

  it("refuses to invoice a closed order with nothing received", () => {
    expect(
      purchaseOrderFundsRefusal(
        order({ status: "Closed", receivedQuantity: 0 }),
        "invoice"
      )
    ).not.toBeNull();
  });

  it("holds a closed order to its approved amount", () => {
    expect(
      purchaseOrderFundsRefusal(
        order({ status: "Closed", total: 100.01 }),
        "invoice"
      )
    ).not.toBeNull();
  });

  it("allows a released order with no approval request", () => {
    expect(
      purchaseOrderFundsRefusal(
        order({ total: 5000, approvedAmount: null }),
        "receive"
      )
    ).toBeNull();
  });

  it("refuses a released order above its approved amount", () => {
    expect(
      purchaseOrderFundsRefusal(order({ total: 100.01 }), "receive")
    ).not.toBeNull();
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

describe("purchaseOrderLineAmendRefusal identity", () => {
  const received = {
    quantityReceived: 3,
    quantityInvoiced: 0,
    purchaseOrderLineType: "Part",
    itemId: "a",
    assetId: null,
    purchaseUnitOfMeasureCode: "EA",
    conversionFactor: 1
  };

  it.each([
    { purchaseOrderLineType: "G/L Account" },
    { itemId: "b" },
    { assetId: "fa_1" },
    { purchaseUnitOfMeasureCode: "BX" },
    { conversionFactor: 10 }
  ])("keeps a received line's %o", (edit) => {
    expect(purchaseOrderLineAmendRefusal(received, 5, edit)).not.toBeNull();
  });

  it("accepts the line's own values sent back", () => {
    expect(
      purchaseOrderLineAmendRefusal(received, 5, {
        itemId: "a",
        purchaseUnitOfMeasureCode: "EA",
        conversionFactor: 1
      })
    ).toBeNull();
  });

  it("lets an unreceived line change its item", () => {
    expect(
      purchaseOrderLineAmendRefusal({ ...received, quantityReceived: 0 }, 5, {
        itemId: "b"
      })
    ).toBeNull();
  });
});

describe("purchaseOrderLineDeleteRefusal", () => {
  it.each([...PURCHASE_ORDER_AMENDABLE_STATUSES])(
    "keeps every line of a %s order",
    (status) => {
      expect(purchaseOrderLineDeleteRefusal(status)).not.toBeNull();
    }
  );

  it.each(["Draft", "Planned"])("lets a %s order lose a line", (status) => {
    expect(purchaseOrderLineDeleteRefusal(status)).toBeNull();
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

describe("planPurchaseOrderRestore", () => {
  // The approved version: one line of 10 at 8.
  const version: PurchaseOrderVersion = {
    exchangeRate: 1,
    delivery: null,
    lines: [{ id: "l1", purchaseQuantity: 10, supplierUnitPrice: 8 }]
  };
  const line = (
    overrides: Partial<PurchaseOrderRestoreLine> = {}
  ): PurchaseOrderRestoreLine => ({
    id: "l1",
    purchaseQuantity: 20,
    quantityReceived: 0,
    quantityInvoiced: 0,
    receivedComplete: false,
    ...overrides
  });

  it("puts a raised line back and removes a line the edit added", () => {
    expect(
      planPurchaseOrderRestore(version, [line(), line({ id: "l2" })])
    ).toEqual({
      restorable: true,
      updates: [
        {
          id: "l1",
          data: {
            purchaseQuantity: 10,
            supplierUnitPrice: 8,
            receivedComplete: false,
            invoicedComplete: false
          }
        }
      ],
      deleteIds: ["l2"]
    });
  });

  it("keeps a line at what was received since, and completes it", () => {
    const plan = planPurchaseOrderRestore(version, [
      line({ quantityReceived: 12 })
    ]);
    expect(plan).toMatchObject({
      restorable: true,
      updates: [{ data: { purchaseQuantity: 12, receivedComplete: true } }]
    });
  });

  it("is not restorable once a line of the version is gone", () => {
    expect(planPurchaseOrderRestore(version, [line({ id: "other" })])).toEqual({
      restorable: false
    });
  });

  it("is not restorable when an added line has been received", () => {
    expect(
      planPurchaseOrderRestore(version, [
        line(),
        line({ id: "l2", quantityReceived: 1 })
      ])
    ).toEqual({ restorable: false });
  });

  it("writes only the columns a version may restore", () => {
    const plan = planPurchaseOrderRestore(
      {
        ...version,
        lines: [{ id: "l1", purchaseQuantity: 10, quantityReceived: 99 }]
      },
      [line()]
    );
    expect(plan.restorable && plan.updates[0]!.data).not.toHaveProperty(
      "quantityReceived"
    );
  });
});

describe("purchaseOrderLineRemainingToInvoice", () => {
  // 10 ordered, 4 received, 1 invoiced, still open for receiving.
  const line = {
    purchaseQuantity: 10,
    quantityReceived: 4,
    quantityInvoiced: 1,
    receivedComplete: false
  };

  it("bills the rest of the order while it is open", () => {
    expect(purchaseOrderLineRemainingToInvoice("To Receive", line)).toBe(9);
  });

  it("bills only what was received once the order is closed", () => {
    expect(purchaseOrderLineRemainingToInvoice("Closed", line)).toBe(3);
  });

  it("bills nothing on a closed order with nothing received", () => {
    expect(
      purchaseOrderLineRemainingToInvoice("Closed", {
        ...line,
        quantityReceived: 0,
        quantityInvoiced: 0
      })
    ).toBe(0);
  });
});
