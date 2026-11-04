// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentBlock } from "@carbon/documents/template";
import { describe, expect, it } from "vitest";
import { findPrintedText, printedTexts } from "./previewText";

const blocks: DocumentBlock[] = [
  { id: "header", type: "header", visible: true },
  {
    id: "parties",
    type: "parties",
    visible: true,
    text: { supplierTaxId: "GST No.:" },
    hidden: ["supplierEori"]
  },
  { id: "notes", type: "notes", visible: false },
  { id: "lineItems", type: "lineItems", visible: true },
  {
    id: "summary",
    type: "summary",
    visible: true,
    text: { total: "Grand total in {order.currency}" }
  }
];
const texts = printedTexts("purchaseOrder", blocks, {});

describe("printedTexts", () => {
  it("lists the title with the header and leaves out what does not print", () => {
    expect(texts[0]).toEqual({
      scope: "document",
      key: "title",
      text: "Purchase Order"
    });
    expect(texts.some((t) => t.key === "supplierEori")).toBe(false);
    expect(texts.some((t) => t.scope === "notes")).toBe(false);
    expect(texts.at(-1)?.key).toBe("of");
  });
});

// A purchase order page as pdf.js splits it: one array of runs per line.
const page: string[][] = [
  ["Carbon Development", " ", "Purchase Order"],
  ["PO-001042"],
  ["SUPPLIER"],
  ["Steelworks Ltd"],
  ["GST No.:", " ", "TX-998877"],
  ["VAT:", " ", "GB123"],
  ["ORDER INFO"],
  ["Billing documents and"],
  ["enquiries:", " ", "ap@example.com"],
  ["VAT:", " ", "US123"],
  ["#", " ", "Description", " ", "Qty", " ", "Total"],
  ["1", " ", "STEEL-BAR-50", " ", "100", " ", "605.30"],
  ["Subtotal", " ", "(", "USD", ")", " ", "587.00"],
  ["Grand total in USD", " ", "(", "USD", ")", " ", "674.30"],
  ["Page 1 of 2"]
];
const at = (line: number, run: number) => {
  const hit = findPrintedText(page, { line, run }, texts);
  return hit && `${hit.scope}:${hit.key}`;
};

describe("findPrintedText", () => {
  it("finds a text whatever its case", () => {
    expect(at(0, 2)).toBe("document:title");
    expect(at(2, 0)).toBe("parties:supplier");
    expect(at(6, 0)).toBe("parties:orderInfo");
  });

  it("finds a label printed before its value", () => {
    expect(at(4, 0)).toBe("parties:supplierTaxId");
    expect(at(12, 0)).toBe("summary:subtotal");
  });

  it("matches a variable by what it printed", () => {
    expect(at(13, 0)).toBe("summary:total");
  });

  it("tells texts that print the same words apart by their order", () => {
    expect(at(5, 0)).toBe("parties:supplierVat");
    expect(at(9, 0)).toBe("parties:companyVat");
    expect(at(10, 6)).toBe("lineItems:total");
  });

  it("points a click on a value at the label or heading before it", () => {
    expect(at(4, 2)).toBe("parties:supplierTaxId");
    expect(at(3, 0)).toBe("parties:supplier");
    expect(at(11, 2)).toBe("lineItems:total");
  });

  it("finds nothing for a blank run or a run before any text", () => {
    expect(at(4, 1)).toBeNull();
    expect(at(0, 0)).toBeNull();
  });
});
