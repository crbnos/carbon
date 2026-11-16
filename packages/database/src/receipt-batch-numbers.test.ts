import { describe, expect, it } from "vitest";
import {
  planReceiptBatchNumbers,
  receiptBatchNumberBase
} from "./receipt-batch-numbers";

describe("receiptBatchNumberBase", () => {
  it("joins the purchase order and the zero-padded day", () => {
    expect(
      receiptBatchNumberBase("PO000123", { year: 2026, month: 3, day: 7 })
    ).toBe("PO000123-20260307");
  });
});

describe("planReceiptBatchNumbers", () => {
  const base = "PO1-20261116";

  it("gives different items on one delivery the same number", () => {
    const plan = planReceiptBatchNumbers(
      base,
      [
        { id: "l1", itemId: "a" },
        { id: "l2", itemId: "b" }
      ],
      []
    );
    expect([...plan]).toEqual([
      ["l1", base],
      ["l2", base]
    ]);
  });

  it("suffixes a second line of one item and an earlier same-day delivery", () => {
    const plan = planReceiptBatchNumbers(
      base,
      [
        { id: "l1", itemId: "a" },
        { id: "l2", itemId: "a" },
        { id: "l3", itemId: "b" }
      ],
      [{ itemId: "a", readableId: base }]
    );
    expect(plan.get("l1")).toBe(`${base}-2`);
    expect(plan.get("l2")).toBe(`${base}-3`);
    expect(plan.get("l3")).toBe(base);
  });

  it("leaves a line unnumbered once every candidate is taken", () => {
    const taken = Array.from({ length: 20 }, (_, i) => ({
      itemId: "a",
      readableId: i === 0 ? base : `${base}-${i + 1}`
    }));
    const plan = planReceiptBatchNumbers(
      base,
      [{ id: "l1", itemId: "a" }],
      taken
    );
    expect(plan.has("l1")).toBe(false);
  });
});
