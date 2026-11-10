// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type DocumentBlock, getTextEntries } from "@carbon/documents/template";
import { describe, expect, it } from "vitest";
import { groupTexts, printedTexts, wordName } from "./previewText";

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
  { id: "terms", type: "terms", visible: true },
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
      text: "Purchase Order",
      kind: "heading"
    });
    expect(texts.some((t) => t.key === "supplierEori")).toBe(false);
    expect(texts.some((t) => t.scope === "notes")).toBe(false);
    expect(texts.at(-1)?.key).toBe("of");
  });
});

describe("wordName", () => {
  const labels = { "supplier.name": "Supplier Name", "a.b": "A", "c.d": "C" };

  it("names a text by its words before any variable", () => {
    expect(wordName("PO Number: {order.id}", labels)).toBe("PO Number");
    expect(wordName("Subtotal ({order.currency})", labels)).toBe("Subtotal");
    expect(wordName("Billing enquiries:", labels)).toBe("Billing enquiries");
    expect(wordName("#", labels)).toBe("#");
  });

  it("names a text with one letter or a dash before its variable", () => {
    expect(wordName("V{job.revision}", { "job.revision": "Revision" })).toBe(
      "Revision"
    );
    expect(wordName("- Tax ({line.taxPercent})", {})).toBe("Tax");
  });

  it("names a text of only variables by their names", () => {
    expect(wordName("{supplier.name}", labels)).toBe("Supplier Name");
    expect(wordName("{a.b}: {c.d}", labels)).toBe("A C");
    expect(wordName("{gone.token}", labels)).toBe("{gone.token}");
  });
});

describe("groupTexts", () => {
  it("groups a table's texts by column, and a page's by heading", () => {
    const table = groupTexts(getTextEntries("purchaseOrder", "lineItems"), {});
    expect(table.map((g) => g.title).slice(0, 3)).toEqual([
      "#",
      "Description",
      "Qty"
    ]);
    expect(table[1].entries.map((e) => e.key)).toEqual([
      "description",
      "descriptionCell",
      "detailsCell",
      "supplierPartCell",
      "operationCell",
      "shipping"
    ]);

    const page = groupTexts(getTextEntries("purchaseOrder", "parties"), {});
    expect(page.map((g) => g.title)).toEqual([
      "Supplier",
      "Order Info",
      "Deliver To"
    ]);
    // A value of a label is not a table column: it stays in the label's box.
    expect(page[1].entries.map((e) => e.key)).toContain("billingEmail");
  });

  it("does not put a table's total under its last column", () => {
    const groups = groupTexts(getTextEntries("salesReturnOrder", "lineItems"), {
      "line.reason": "Return Reason"
    });
    expect(groups.at(-1)?.title).toBe("Total");
    expect(groups.at(-1)?.entries.map((e) => e.key)).toEqual([
      "total",
      "totalValue"
    ]);
    expect(groups.at(-2)?.entries.map((e) => e.key)).toEqual([
      "reason",
      "reasonCell"
    ]);
  });

  it("leaves texts with no heading under no title", () => {
    const groups = groupTexts(getTextEntries("purchaseOrder", "summary"), {});
    expect(groups.map((g) => g.title)).toEqual([null]);
  });
});
