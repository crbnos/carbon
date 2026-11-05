// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type DocumentBlock, getTextEntries } from "@carbon/documents/template";
import { describe, expect, it } from "vitest";
import {
  findPrintedText,
  groupTexts,
  type PageRun,
  printedTexts,
  wordName
} from "./previewText";

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

/** A line of runs laid end to end, unless a run says where it starts: `[text, left]`. */
function line(...cells: (string | [string, number])[]): PageRun[] {
  let x = 0;
  return cells.map((cell) => {
    const [text, left] = typeof cell === "string" ? [cell, x] : cell;
    x = left + text.length;
    return { text, left, right: x };
  });
}

// A purchase order page as pdf.js splits it: one array of runs per line.
const page: PageRun[][] = [
  line("Carbon Development", " ", "Purchase Order"),
  line("PO-001042"),
  line("SUPPLIER"),
  line("Steelworks Ltd"),
  line("GST No.:", " ", "TX-998877"),
  line("VAT:", " ", "GB123"),
  line("ORDER INFO"),
  line("Billing documents and"),
  line("enquiries:", " ", "ap@example.com"),
  line("VAT:", " ", "US123"),
  line(["#", 0], " ", ["Description", 5], " ", ["Qty", 60], " ", ["Total", 80]),
  line(["1", 0], " ", ["STEEL-BAR-50", 5], " ", ["100 EA", 59], " ", [
    "605.30",
    79
  ]),
  line(["A very long description that runs far past its heading", 5]),
  line(["Set of 4 bolts", 5]),
  line(["Tax & Fees", 5]),
  line(["2", 0], " ", ["BOLT-M8", 5], " ", ["500 EA", 59], " ", ["69.00", 79]),
  line("Subtotal", " ", "(", "USD", ")", " ", "587.00"),
  line("Grand total in USD", " ", "(", "USD", ")", " ", "674.30"),
  line("TERMS & CONDITIONS"),
  line("Goods remain the property of the buyer."),
  line("Page 1 of 2")
];
const at = (lineIndex: number, run: number) => {
  const hit = findPrintedText(page, { line: lineIndex, run }, texts);
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
    expect(at(16, 0)).toBe("summary:subtotal");
  });

  it("matches a variable by what it printed", () => {
    expect(at(17, 0)).toBe("summary:total");
  });

  it("tells texts that print the same words apart by their order", () => {
    expect(at(5, 0)).toBe("parties:supplierVat");
    expect(at(9, 0)).toBe("parties:companyVat");
    expect(at(10, 6)).toBe("lineItems:total");
  });

  it("points a table cell at the value of the column it sits under", () => {
    expect(at(11, 0)).toBe("lineItems:numberCell");
    expect(at(11, 2)).toBe("lineItems:descriptionCell");
    expect(at(11, 4)).toBe("lineItems:qtyCell");
    expect(at(11, 6)).toBe("lineItems:totalCell");
    expect(at(15, 4)).toBe("lineItems:qtyCell");
  });

  it("keeps a long or second line of a cell in its column", () => {
    expect(at(12, 0)).toBe("lineItems:descriptionCell");
    expect(at(13, 0)).toBe("lineItems:descriptionCell");
  });

  it("points an amount at its own value, not its label", () => {
    expect(at(16, 6)).toBe("summary:subtotalValue");
  });

  it("does not leave the table for a word inside a value", () => {
    expect(at(19, 0)).toBe("terms:termsAndConditions");
  });

  it("points a value outside a table at the label or heading before it", () => {
    expect(at(4, 2)).toBe("parties:supplierTaxId");
    expect(at(3, 0)).toBe("parties:supplier");
  });

  it("reads a value with no label from its own column of the page", () => {
    const columns: PageRun[][] = [
      line(["SUPPLIER", 0], " ", ["DELIVER TO", 100]),
      line(["Steelworks Ltd", 0], " ", ["Main Warehouse", 100]),
      line(["Email: a@example.com", 0], " ", ["1 Dock Road", 100])
    ];
    const hit = (lineIndex: number, run: number) =>
      findPrintedText(columns, { line: lineIndex, run }, texts)?.key;
    expect(hit(1, 0)).toBe("supplier");
    expect(hit(1, 2)).toBe("deliverTo");
    expect(hit(2, 2)).toBe("deliverTo");
  });

  it("does not take a text of only variables and punctuation for a row", () => {
    const rows: PageRun[][] = [
      line("SHIPMENT DETAILS"),
      line("Sales Order: SO-1")
    ];
    const hit = findPrintedText(rows, { line: 1, run: 0 }, [
      {
        scope: "details",
        key: "details",
        text: "Shipment Details",
        kind: "heading"
      },
      { scope: "details", key: "source", text: "{a}: {b}", kind: "field" }
    ]);
    expect(hit?.key).toBe("details");
  });

  it("keeps a total in a table with its label, past the column headings", () => {
    const rows: PageRun[][] = [
      line(["#", 0], " ", ["Unit Price", 40]),
      line(["1", 0], " ", ["12.00", 40]),
      line(["Total (USD)", 20], " ", ["110.00", 60])
    ];
    const hit = findPrintedText(rows, { line: 2, run: 2 }, [
      { scope: "lines", key: "number", text: "#", kind: "column" },
      { scope: "lines", key: "unitPrice", text: "Unit Price", kind: "column" },
      { scope: "lines", key: "total", text: "Total ({c})", kind: "text" },
      {
        scope: "lines",
        key: "totalValue",
        text: "{t}",
        kind: "value",
        of: "total"
      }
    ]);
    expect(hit?.key).toBe("totalValue");
  });

  it("points the summary's tax label and amount at the amount's row", () => {
    const summary: DocumentBlock[] = [
      {
        id: "summary",
        type: "summary",
        visible: true,
        options: { taxLabel: "VAT" }
      }
    ];
    const rows: PageRun[][] = [line("VAT", " ", "(", "USD", ")", " ", "31.98")];
    const all = printedTexts("purchaseOrder", summary, {});
    expect(findPrintedText(rows, { line: 0, run: 0 }, all)?.key).toBe(
      "taxValue"
    );
    expect(findPrintedText(rows, { line: 0, run: 6 }, all)?.key).toBe(
      "taxValue"
    );
  });

  it("finds nothing for a blank run or a run before any text", () => {
    expect(at(4, 1)).toBeNull();
    expect(at(0, 0)).toBeNull();
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

  it("leaves texts with no heading under no title", () => {
    const groups = groupTexts(getTextEntries("purchaseOrder", "summary"), {});
    expect(groups.map((g) => g.title)).toEqual([null]);
  });
});
