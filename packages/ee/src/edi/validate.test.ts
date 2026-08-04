import { describe, expect, it } from "vitest";
import type { EdiOrderPayload } from "./types";
import {
  checkDuplicateReference,
  checkPrices,
  checkShipTo,
  resolveOrderLines
} from "./validate";

function order(lines: EdiOrderPayload["lines"]): EdiOrderPayload {
  return {
    partnerReference: "PO-1",
    orderDate: "2026-08-04",
    shipTo: { code: "DC-001" },
    lines
  };
}

describe("resolveOrderLines", () => {
  it("resolves via the part cross-reference (customerPartId + revision)", () => {
    const { lines, issues } = resolveOrderLines(
      order([
        {
          partnerLineNumber: "1",
          partnerPartId: "WIDGET-42",
          partnerPartRevision: "B",
          quantity: 10,
          unitOfMeasure: "EA",
          unitPrice: 5
        }
      ]),
      {
        partMappings: [
          {
            customerPartId: "WIDGET-42",
            customerPartRevision: "B",
            itemId: "item-1"
          }
        ],
        itemsByReadableId: {}
      }
    );
    expect(issues).toHaveLength(0);
    expect(lines[0]?.itemId).toBe("item-1");
  });

  it("falls back to an exact readableId match", () => {
    const { lines, issues } = resolveOrderLines(
      order([
        {
          partnerLineNumber: "1",
          partnerPartId: "PART-100",
          quantity: 1,
          unitOfMeasure: "EA",
          unitPrice: 5
        }
      ]),
      { partMappings: [], itemsByReadableId: { "PART-100": "item-9" } }
    );
    expect(issues).toHaveLength(0);
    expect(lines[0]?.itemId).toBe("item-9");
  });

  it("raises an unknown-part issue naming the buyer part on a miss", () => {
    const { lines, issues } = resolveOrderLines(
      order([
        {
          partnerLineNumber: "1",
          partnerPartId: "MYSTERY-1",
          quantity: 1,
          unitOfMeasure: "EA",
          unitPrice: 5
        }
      ]),
      { partMappings: [], itemsByReadableId: {} }
    );
    expect(lines[0]?.itemId).toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("unknown-part");
    expect(issues[0]?.context?.partnerPartId).toBe("MYSTERY-1");
  });

  it("requires the revision to match the mapping", () => {
    const { lines } = resolveOrderLines(
      order([
        {
          partnerLineNumber: "1",
          partnerPartId: "WIDGET-42",
          partnerPartRevision: "C",
          quantity: 1,
          unitOfMeasure: "EA",
          unitPrice: 5
        }
      ]),
      {
        partMappings: [
          {
            customerPartId: "WIDGET-42",
            customerPartRevision: "B",
            itemId: "item-1"
          }
        ],
        itemsByReadableId: {}
      }
    );
    expect(lines[0]?.itemId).toBeNull();
  });
});

describe("checkPrices", () => {
  it("passes when the deviation is exactly at tolerance", () => {
    const issues = checkPrices(
      [{ itemId: "i", unitPrice: 11, expectedPrice: 10 }],
      0.1
    );
    expect(issues).toHaveLength(0);
  });

  it("flags when the deviation is above tolerance", () => {
    const issues = checkPrices(
      [{ itemId: "i", unitPrice: 12, expectedPrice: 10 }],
      0.1
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("price-mismatch");
  });

  it("with tolerance 0 flags any deviation", () => {
    const issues = checkPrices(
      [{ itemId: "i", unitPrice: 10.01, expectedPrice: 10 }],
      0
    );
    expect(issues).toHaveLength(1);
  });

  it("ignores lines with no expected price", () => {
    const issues = checkPrices(
      [{ itemId: "i", unitPrice: 999, expectedPrice: null }],
      0
    );
    expect(issues).toHaveLength(0);
  });
});

describe("checkShipTo", () => {
  it("resolves a mapped code", () => {
    const { customerLocationId, issues } = checkShipTo("DC-001", [
      { externalCode: "DC-001", customerLocationId: "loc-1" }
    ]);
    expect(customerLocationId).toBe("loc-1");
    expect(issues).toHaveLength(0);
  });

  it("raises an unknown-ship-to issue on a miss", () => {
    const { customerLocationId, issues } = checkShipTo("DC-999", [
      { externalCode: "DC-001", customerLocationId: "loc-1" }
    ]);
    expect(customerLocationId).toBeNull();
    expect(issues[0]?.code).toBe("unknown-ship-to");
  });
});

describe("checkDuplicateReference", () => {
  it("flags a repeated reference", () => {
    const issues = checkDuplicateReference("PO-1", ["PO-1", "PO-2"]);
    expect(issues[0]?.code).toBe("duplicate-reference");
  });

  it("passes a novel reference", () => {
    const issues = checkDuplicateReference("PO-3", ["PO-1", "PO-2"]);
    expect(issues).toHaveLength(0);
  });
});
