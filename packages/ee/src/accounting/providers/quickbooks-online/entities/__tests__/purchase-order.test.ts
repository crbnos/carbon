import { describe, expect, it } from "vitest";
import type { Accounting } from "../../../../core/types";
import type { Qbo } from "../../models";
import {
  mapCarbonPoStatusToQbo,
  mapQboPoStatusToCarbon
} from "../purchase-order";
import { buildQboDocNumberFields, buildQboExpenseLines } from "../shared";

describe("QBO purchase order mapping fixture", () => {
  it("maps a PO line set with item + G/L lines through the shared expense-line builder", () => {
    const accountRefs: ReadonlyMap<string, Qbo.Ref> = new Map([
      ["acc-tooling", { value: "88", name: "Tooling Expense" }]
    ]);

    const lines = buildQboExpenseLines({
      lines: [
        {
          itemId: "item-1",
          accountId: null,
          description: "Raw stock",
          quantity: 100,
          unitPrice: 1.25,
          totalAmount: 125
        },
        {
          itemId: null,
          accountId: "acc-tooling",
          description: "Tooling charge",
          quantity: 1,
          unitPrice: 300,
          totalAmount: 300
        }
      ],
      itemRemoteIds: new Map([["item-1", "55"]]),
      accountRefsById: accountRefs,
      documentLabel: "purchase order PO-000042"
    });

    expect(lines[0]?.DetailType).toBe("ItemBasedExpenseLineDetail");
    expect(lines[0]?.ItemBasedExpenseLineDetail?.ItemRef).toEqual({
      value: "55"
    });
    expect(lines[1]?.DetailType).toBe("AccountBasedExpenseLineDetail");
    expect(lines[1]?.AccountBasedExpenseLineDetail?.AccountRef.value).toBe(
      "88"
    );
  });

  it("applies the 21-char DocNumber rule to PO numbers", () => {
    const longPoNumber = "PO-0000000000000000042"; // 22 chars
    const fields = buildQboDocNumberFields(longPoNumber);
    expect(fields.DocNumber).toBeUndefined();
    expect(fields.PrivateNote).toBe(`Carbon ${longPoNumber}`);
    expect(fields.source).toBe("privateNote");
  });
});

describe("PO status mapping", () => {
  it("maps Carbon locked statuses onto QBO POStatus", () => {
    const open: Accounting.PurchaseOrder["status"][] = [
      "To Receive",
      "To Receive and Invoice",
      "To Invoice"
    ];
    for (const status of open) {
      expect(mapCarbonPoStatusToQbo(status)).toBe("Open");
    }
    expect(mapCarbonPoStatusToQbo("Completed")).toBe("Closed");
    expect(mapCarbonPoStatusToQbo("Closed")).toBe("Closed");
  });

  it("maps QBO POStatus back onto Carbon statuses", () => {
    expect(mapQboPoStatusToCarbon("Open")).toBe("To Receive");
    expect(mapQboPoStatusToCarbon("Closed")).toBe("Closed");
    expect(mapQboPoStatusToCarbon(undefined)).toBeUndefined();
  });
});
