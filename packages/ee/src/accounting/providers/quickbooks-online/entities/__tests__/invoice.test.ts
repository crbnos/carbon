import { describe, expect, it } from "vitest";
import type { Accounting } from "../../../../core/types";
import { buildQboInvoiceLines, deriveCarbonInvoiceStatus } from "../invoice";
import { buildQboDocNumberFields, QBO_DOC_NUMBER_MAX_LENGTH } from "../shared";

const makeLine = (
  overrides?: Partial<Accounting.SalesInvoiceLine>
): Accounting.SalesInvoiceLine => ({
  id: "line-1",
  invoiceLineType: "Part",
  itemId: "item-1",
  itemCode: "PART-000123",
  description: "Widget Bracket",
  quantity: 3,
  unitPrice: 19.999,
  taxPercent: 0,
  lineAmount: 59.997,
  ...overrides
});

describe("buildQboInvoiceLines (invoice mapping fixture)", () => {
  it("builds SalesItemLineDetail lines with ItemRef + Qty/UnitPrice and a rounded Amount", () => {
    const lines = buildQboInvoiceLines(
      [makeLine()],
      new Map([["item-1", "77"]])
    );

    expect(lines).toEqual([
      {
        Description: "Widget Bracket",
        Amount: 60,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "77" },
          Qty: 3,
          UnitPrice: 19.999
        }
      }
    ]);
  });

  it("ships lines without an item without an ItemRef", () => {
    const lines = buildQboInvoiceLines(
      [
        makeLine({
          itemId: null,
          itemCode: null,
          description: "Expedite fee",
          quantity: 1,
          unitPrice: 50
        })
      ],
      new Map()
    );

    expect(lines[0]?.SalesItemLineDetail?.ItemRef).toBeUndefined();
    expect(lines[0]?.Amount).toBe(50);
  });
});

describe("buildQboDocNumberFields (21-char DocNumber cap)", () => {
  it("uses DocNumber when the readable id fits (boundary: exactly 21 chars)", () => {
    const id = "I".repeat(QBO_DOC_NUMBER_MAX_LENGTH);
    expect(buildQboDocNumberFields(id)).toEqual({
      DocNumber: id,
      PrivateNote: undefined,
      source: "docNumber"
    });
  });

  it("moves a longer id to PrivateNote and lets QBO auto-number", () => {
    const id = "INV-000000000000000042"; // 22 chars
    expect(id.length).toBe(QBO_DOC_NUMBER_MAX_LENGTH + 1);

    const fields = buildQboDocNumberFields(id);
    expect(fields.DocNumber).toBeUndefined();
    expect(fields.PrivateNote).toBe(`Carbon ${id}`);
    expect(fields.source).toBe("privateNote");
  });

  it("joins an extra note onto the PrivateNote carrier", () => {
    const id = "I".repeat(QBO_DOC_NUMBER_MAX_LENGTH + 1);
    expect(buildQboDocNumberFields(id, "Ref PO-9").PrivateNote).toBe(
      `Carbon ${id} | Ref PO-9`
    );
    expect(buildQboDocNumberFields("INV-42", "Ref PO-9")).toEqual({
      DocNumber: "INV-42",
      PrivateNote: "Ref PO-9",
      source: "docNumber"
    });
  });
});

describe("deriveCarbonInvoiceStatus (pull status from Balance/TotalAmt)", () => {
  it("derives Paid / Partially Paid / Submitted from the balance", () => {
    expect(deriveCarbonInvoiceStatus(100, 0)).toBe("Paid");
    expect(deriveCarbonInvoiceStatus(100, 40)).toBe("Partially Paid");
    expect(deriveCarbonInvoiceStatus(100, 100)).toBe("Submitted");
  });

  it("returns undefined when QBO reports no balance", () => {
    expect(deriveCarbonInvoiceStatus(100, undefined)).toBeUndefined();
  });
});
