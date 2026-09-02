import { describe, expect, it } from "vitest";
import { getPurchaseOrderDisplayId } from "./purchase-order";

// Suffix rules live in revision.test.ts; this pins field mapping only.
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
