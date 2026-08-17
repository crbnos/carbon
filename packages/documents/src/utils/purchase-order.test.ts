import { describe, expect, it } from "vitest";
import { getPurchaseOrderDisplayId } from "./purchase-order";

// The suffix rules themselves are covered once in revision.test.ts — this only
// pins that the PO helper reads the right two fields and tolerates a missing
// order (call sites pass `routeData?.purchaseOrder`).
describe("getPurchaseOrderDisplayId", () => {
  it("reads purchaseOrderId and revisionId off the order", () => {
    expect(
      getPurchaseOrderDisplayId({ purchaseOrderId: "PO-001042", revisionId: 0 })
    ).toBe("PO-001042");
    expect(
      getPurchaseOrderDisplayId({ purchaseOrderId: "PO-001042", revisionId: 2 })
    ).toBe("PO-001042-2");
  });

  it("returns an empty string for a missing order", () => {
    expect(getPurchaseOrderDisplayId(undefined)).toBe("");
    expect(getPurchaseOrderDisplayId(null)).toBe("");
  });
});
