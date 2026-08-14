import { describe, expect, it } from "vitest";
import { getPurchaseOrderDisplayId } from "./purchase-order";

describe("getPurchaseOrderDisplayId", () => {
  it("returns the bare id for the original order (revision 0)", () => {
    expect(
      getPurchaseOrderDisplayId({ purchaseOrderId: "PO-001042", revisionId: 0 })
    ).toBe("PO-001042");
  });

  it("treats a null revision as the original", () => {
    expect(
      getPurchaseOrderDisplayId({
        purchaseOrderId: "PO-001042",
        revisionId: null
      })
    ).toBe("PO-001042");
  });

  it("suffixes the revision for an amended order", () => {
    expect(
      getPurchaseOrderDisplayId({ purchaseOrderId: "PO-001042", revisionId: 1 })
    ).toBe("PO-001042-1");
    expect(
      getPurchaseOrderDisplayId({
        purchaseOrderId: "PO-001042",
        revisionId: 12
      })
    ).toBe("PO-001042-12");
  });

  it("returns an empty string when the id is missing, even with a revision", () => {
    expect(
      getPurchaseOrderDisplayId({ purchaseOrderId: null, revisionId: 0 })
    ).toBe("");
    expect(
      getPurchaseOrderDisplayId({ purchaseOrderId: null, revisionId: 2 })
    ).toBe("");
  });
});
