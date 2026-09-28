import { describe, expect, it } from "vitest";
import { buildBillMemo } from "./bill";

/**
 * The memo is the only place a pushed bill can name the Carbon invoice and the
 * orders it settles. `invoice_number` belongs to the SUPPLIER's reference (an AP
 * clerk matches it against the paper), and Ramp exposes no writable
 * purchase-order field on a draft — verified live 2026-09-27: it accepts both
 * `purchase_order_id` and `purchase_order_ids` with a 201 and stores neither.
 *
 * The bug: a bill in Ramp read only `CEX-Q-4471`, with nothing tying it to
 * `AP000008` or to the order it billed.
 */
describe("buildBillMemo", () => {
  it("names the Carbon invoice", () => {
    expect(buildBillMemo({ readableId: "AP000008" })).toBe("AP000008");
  });

  it("names the order the invoice bills", () => {
    expect(
      buildBillMemo({
        readableId: "AP000008",
        purchaseOrderReadableIds: ["PO000018"]
      })
    ).toBe("AP000008 · PO000018");
  });

  it("names every order on a consolidated invoice", () => {
    // One invoice against several orders is ordinary — the link lives on the
    // LINE, so naming only the first would misreport what the bill settles.
    expect(
      buildBillMemo({
        readableId: "AP000008",
        purchaseOrderReadableIds: ["PO000018", "PO000019"]
      })
    ).toBe("AP000008 · PO000018, PO000019");
  });

  it("stays a bare id when the invoice bills no order", () => {
    // A standalone payable (no PO) is common. A trailing separator there would
    // read as a missing value rather than an absent one.
    expect(
      buildBillMemo({ readableId: "AP000008", purchaseOrderReadableIds: [] })
    ).toBe("AP000008");
  });

  it("is searchable — bare ids, no prose around them", () => {
    // Somebody typing AP000008 or PO000018 into Ramp's search has to find this
    // bill; wrapping the ids in a sentence is what stops that working.
    const memo = buildBillMemo({
      readableId: "AP000008",
      purchaseOrderReadableIds: ["PO000018"]
    });

    expect(memo.split(" · ")).toEqual(["AP000008", "PO000018"]);
  });
});
