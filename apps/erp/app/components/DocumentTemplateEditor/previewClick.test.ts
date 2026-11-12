// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CollectedValues,
  DocumentBlock
} from "@carbon/documents/template";
import { describe, expect, it } from "vitest";
import {
  findFooterText,
  findPrintedText,
  isHeaderDetails,
  type PageRun,
  resolveClick
} from "./previewClick";
import {
  fillPrintedTexts,
  type PrintedText,
  printedTexts
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

describe("a click with the record's values", () => {
  const collected: CollectedValues = {
    document: {
      "order.number": "PO-1",
      "supplier.name": "Steelworks Ltd",
      "supplier.addressLine1": "200 Foundry Rd",
      "supplier.contactName": "",
      "buyer.name": "Pat"
    },
    rows: [
      {
        key: "line:a",
        prefix: "line",
        values: { "line.description": "WIDGET", "line.details": "Blue widget" }
      }
    ]
  };
  const filled = fillPrintedTexts(
    [
      {
        scope: "document",
        key: "title",
        text: "Purchase Order",
        kind: "heading"
      },
      {
        scope: "document",
        key: "documentNumber",
        text: "{order.number}",
        kind: "field"
      },
      { scope: "parties", key: "supplier", text: "Supplier", kind: "heading" },
      { scope: "parties", key: "name", text: "{supplier.name}", kind: "field" },
      {
        scope: "parties",
        key: "address",
        text: "{supplier.addressLine1}",
        kind: "field"
      },
      {
        scope: "parties",
        key: "supplierContact",
        text: "Contact: {supplier.contactName}",
        kind: "field"
      },
      {
        scope: "parties",
        key: "buyerContact",
        text: "Contact: {buyer.name}",
        kind: "field"
      },
      { scope: "parties", key: "taxLabel", text: "Tax:", kind: "text" },
      {
        scope: "parties",
        key: "taxValue",
        text: "{supplier.contactName}",
        kind: "value",
        of: "taxLabel"
      },
      { scope: "lines", key: "item", text: "Item", kind: "text" },
      {
        scope: "lines",
        key: "itemCell",
        text: "{line.description}",
        kind: "value",
        of: "item",
        row: "line"
      },
      {
        scope: "lines",
        key: "detailsCell",
        text: "{line.details}",
        kind: "value",
        of: "item",
        row: "line"
      },
      { scope: "lines", key: "qty", text: "Qty", kind: "column" }
    ],
    collected
  );
  const hit = (lines: PageRun[][], lineIndex: number, run = 0) =>
    findPrintedText(lines, { line: lineIndex, run }, filled)?.key;

  it("tells a line of only variables from the heading above it", () => {
    const lines = [
      line("SUPPLIER"),
      line("Steelworks Ltd"),
      line("200", " ", "Foundry Rd")
    ];
    expect(hit(lines, 1)).toBe("name");
    expect(hit(lines, 2, 2)).toBe("address");
  });

  it("does not count a row whose values are all empty", () => {
    expect(hit([line("Contact: Pat")], 0)).toBe("buyerContact");
  });

  it("leaves out a label whose value prints nothing", () => {
    expect(filled.some((text) => text.key === "taxLabel")).toBe(false);
  });

  it("finds a document number by what it prints", () => {
    expect(hit([line("Purchase Order"), line("PO-1")], 1)).toBe(
      "documentNumber"
    );
  });

  it("prefers the label on the line to a value printed elsewhere too", () => {
    expect(
      findPrintedText(
        [line("Purchase Order"), line("Order", ": ", "PO-1")],
        { line: 1, run: 2 },
        [
          ...filled,
          { scope: "parties", key: "order", text: "Order", kind: "text" }
        ]
      )?.key
    ).toBe("order");
  });

  it("tells two values of one table column apart", () => {
    const lines = [
      line(["Item", 0], " ", ["Qty", 40]),
      line(["WIDGET", 0], " ", ["4", 40]),
      line(["Blue widget", 0])
    ];
    expect(hit(lines, 1)).toBe("itemCell");
    expect(hit(lines, 2)).toBe("detailsCell");
  });

  it("does not take a cell's words for the label of the cells beside it", () => {
    const quote = fillPrintedTexts(
      [
        { scope: "lines", key: "qty", text: "Qty", kind: "column" },
        { scope: "lines", key: "price", text: "Price", kind: "column" },
        {
          scope: "lines",
          key: "qtyCell",
          text: "{line.qty} EA",
          kind: "value",
          of: "qty",
          row: "line"
        },
        {
          scope: "lines",
          key: "priceCell",
          text: "{line.price}",
          kind: "value",
          of: "price",
          row: "line"
        }
      ],
      {
        document: {},
        rows: [
          {
            key: "line:a",
            prefix: "line",
            values: { "line.qty": "4", "line.price": "24.50" }
          }
        ]
      }
    );
    const lines = [
      line(["Qty", 0], " ", ["Price", 40]),
      line(["4 EA", 0], " ", ["24.50", 40])
    ];
    expect(findPrintedText(lines, { line: 1, run: 2 }, quote)?.key).toBe(
      "priceCell"
    );
  });

  it("finds a value cut short for its cell", () => {
    const cut = fillPrintedTexts(
      [
        { scope: "lines", key: "item", text: "Item", kind: "text" },
        {
          scope: "lines",
          key: "itemCell",
          text: "{line.id}",
          kind: "value",
          of: "item",
          row: "line"
        },
        {
          scope: "lines",
          key: "detailsCell",
          text: "{line.details}",
          kind: "value",
          of: "item",
          row: "line"
        },
        { scope: "lines", key: "qty", text: "Qty", kind: "column" }
      ],
      {
        document: {},
        rows: [
          {
            key: "line:a",
            prefix: "line",
            values: {
              "line.id": "A-1",
              "line.details": "Machined aluminium housing"
            }
          }
        ]
      }
    );
    const lines = [
      line(["Item", 0], " ", ["Qty", 40]),
      line(["A-1", 0]),
      line(["Machined alumi…", 0])
    ];
    expect(findPrintedText(lines, { line: 2, run: 0 }, cut)?.key).toBe(
      "detailsCell"
    );
  });

  it("takes words with no value of their own before a value that printed", () => {
    const action = fillPrintedTexts(
      [
        { scope: "tasks", key: "prefix", text: "Supplier", kind: "text" },
        {
          scope: "tasks",
          key: "name",
          text: "{task.name}",
          kind: "value",
          row: "task"
        }
      ],
      {
        document: {},
        rows: [
          {
            key: "task:a",
            prefix: "task",
            values: { "task.name": "Containment" }
          }
        ]
      }
    );
    const lines = [line("SUPPLIER", " ", "CONTAINMENT")];
    expect(findPrintedText(lines, { line: 0, run: 2 }, action)?.key).toBe(
      "name"
    );
  });

  it("skips a text its block left out, by print order", () => {
    const texts: PrintedText[] = [
      { scope: "links", key: "links", text: "Associations", kind: "heading" },
      { scope: "links", key: "supplier", text: "Supplier:", kind: "text" },
      { scope: "tasks", key: "tasks", text: "Tasks", kind: "heading" },
      { scope: "tasks", key: "supplier", text: "Supplier:", kind: "text" }
    ];
    const lines = [line("ASSOCIATIONS"), line("TASKS"), line("Supplier:")];
    expect(findPrintedText(lines, { line: 2, run: 0 }, texts)?.scope).toBe(
      "tasks"
    );
  });

  it("stays in a block that repeats, past a text printed later in it", () => {
    const texts: PrintedText[] = [
      { scope: "links", key: "supplier", text: "Supplier:", kind: "text" },
      { scope: "tasks", key: "supplier", text: "Supplier:", kind: "text" },
      { scope: "tasks", key: "done", text: "Done:", kind: "text" }
    ];
    const lines = [line("Done:"), line("Supplier:")];
    expect(findPrintedText(lines, { line: 1, run: 0 }, texts)?.scope).toBe(
      "tasks"
    );
  });

  it("does not take words in a cell for a column with the same words", () => {
    const texts: PrintedText[] = [
      { scope: "lines", key: "column", text: "Fees", kind: "column" },
      { scope: "lines", key: "qty", text: "Qty", kind: "column" },
      { scope: "lines", key: "cell", text: "Fees", kind: "text" }
    ];
    const lines = [line("Qty"), line("Fees"), line("Fees")];
    expect(findPrintedText(lines, { line: 1, run: 0 }, texts)?.key).toBe(
      "cell"
    );
    expect(findPrintedText(lines, { line: 2, run: 0 }, texts)?.key).toBe(
      "cell"
    );
  });

  it("finds a piece of a wrapped value", () => {
    expect(hit([line("Purchase Order"), line("Foundry Rd")], 1)).toBe(
      "address"
    );
  });

  it("uses what a document's changed value prints", () => {
    const changed = fillPrintedTexts(
      [
        {
          scope: "parties",
          key: "name",
          text: "{supplier.name}",
          kind: "field"
        }
      ],
      collected,
      { document: { "supplier.name": "Forge Works" } }
    );
    expect(
      findPrintedText([line("Forge Works")], { line: 0, run: 0 }, changed)?.key
    ).toBe("name");
  });

  it("keeps a word that is also part of a value", () => {
    const words = fillPrintedTexts(
      [
        { scope: "lines", key: "total", text: "Total", kind: "text" },
        { scope: "parties", key: "name", text: "{company.name}", kind: "field" }
      ],
      { document: { "company.name": "Total Engineering Ltd" }, rows: [] }
    );
    expect(
      findPrintedText([line("Total")], { line: 0, run: 0 }, words)?.key
    ).toBe("total");
  });
});

describe("what the header prints from its own options", () => {
  const title: PrintedText[] = [
    {
      scope: "document",
      key: "title",
      text: "Return Merchandise Authorization",
      kind: "heading"
    }
  ];
  const clicked = { line: 0, run: 0 };

  it("is above the title, even when the company's name is also a text", () => {
    const lines = [line("Acme Inc"), line("Return Merchandise Authorization")];
    expect(isHeaderDetails(lines, clicked, title, 1)).toBe(true);
    expect(findPrintedText(lines, clicked, title)).toBeNull();
  });

  it("finds a title that wraps", () => {
    const lines = [
      line("Acme Inc"),
      line("Return Merchandise"),
      line("Authorization")
    ];
    expect(isHeaderDetails(lines, clicked, title, 1)).toBe(true);
    expect(isHeaderDetails(lines, { line: 2, run: 0 }, title, 1)).toBe(false);
  });

  it("finds a title right after another run on its line", () => {
    const lines = [
      [
        ...line(["Acme Inc", 0]),
        ...line(["Return Merchandise Authorization", 200])
      ]
    ];
    expect(findPrintedText(lines, { line: 0, run: 1 }, title)?.key).toBe(
      "title"
    );
  });

  it("does not take one word of the title for the title", () => {
    const po: PrintedText[] = [
      {
        scope: "document",
        key: "title",
        text: "Purchase Order",
        kind: "heading"
      }
    ];
    const lines = [line("Terms apply"), line("Order")];
    expect(isHeaderDetails(lines, clicked, po, 2)).toBe(false);
  });

  it("is above the number when the title is blank", () => {
    const blank: PrintedText[] = [
      { scope: "document", key: "title", text: "", kind: "heading" },
      {
        scope: "document",
        key: "documentNumber",
        text: "{order.number}",
        kind: "field",
        printed: ["PO-1"]
      }
    ];
    const lines = [line("Acme Inc"), line("PO-1")];
    expect(isHeaderDetails(lines, clicked, blank, 1)).toBe(true);
  });

  it("is above every text of the first page when the title does not print", () => {
    const texts = [
      ...title,
      {
        scope: "parties",
        key: "to",
        text: "Supplier",
        kind: "heading" as const
      }
    ];
    const lines = [line("Acme Inc"), line("SUPPLIER")];
    expect(isHeaderDetails(lines, clicked, texts, 1)).toBe(true);
    expect(isHeaderDetails(lines, clicked, texts, 2)).toBe(false);
  });
});

describe("a click near a text it did not print", () => {
  it("says so, and a section's paragraph opens its panel without a caret", () => {
    const texts: PrintedText[] = [
      { scope: "notes", key: "notes", text: "Notes", kind: "heading" },
      {
        scope: "shared",
        key: "content",
        text: "Ship by air.",
        kind: "text",
        isSection: true
      }
    ];
    const lines = [line("NOTES"), line("Fragile goods"), line("Ship by air.")];
    const open = (lineIndex: number) =>
      resolveClick(
        {
          lines,
          at: { line: lineIndex, run: 0 },
          top: 0.5,
          pageNumber: 1,
          file: "a.pdf"
        },
        "purchaseOrder",
        texts
      );
    expect(open(0)).toEqual({ scope: "notes", key: "notes", exact: true });
    expect(open(1)).toEqual({ scope: "notes", key: "notes", exact: false });
    expect(open(2)).toEqual({ scope: "shared", key: "content", exact: false });
  });
});

describe("findFooterText", () => {
  const footer: PrintedText[] = [
    { scope: "document", key: "page", text: "Page", kind: "text" },
    { scope: "document", key: "of", text: "of", kind: "text" },
    {
      scope: "document",
      key: "issueNumber",
      text: "Issue #{issue.number}",
      kind: "text",
      printed: ["Issue #NCR-1"]
    }
  ];

  it("finds the page line, a footer text, and nothing else", () => {
    expect(findFooterText("Page 1 of 2", footer)?.key).toBe("page");
    expect(findFooterText("Issue #NCR-1", footer)?.key).toBe("issueNumber");
    expect(findFooterText("Acme is registered in Delaware", footer)).toBeNull();
  });
});

describe("a block's own settings", () => {
  const scopeOf = (
    type: "trackingLabel" | "purchaseOrder",
    blocks: DocumentBlock[],
    lines: PageRun[][],
    lineIndex: number,
    run = 0
  ) =>
    findPrintedText(
      lines,
      { line: lineIndex, run },
      printedTexts(type, blocks, {})
    )?.scope;

  it("selects a label's block from its field name and value", () => {
    const blocks: DocumentBlock[] = [
      { id: "rev", type: "labelRevision", visible: true },
      { id: "qty", type: "labelQuantity", visible: true }
    ];
    const lines = [line("Rev", ":", "0"), line("Qty", ":", "1")];
    expect(scopeOf("trackingLabel", blocks, lines, 0, 2)).toBe("rev");
    expect(scopeOf("trackingLabel", blocks, lines, 1, 0)).toBe("qty");
  });

  it("selects a rich text block from a line of its text", () => {
    const blocks: DocumentBlock[] = [
      { id: "terms", type: "terms", visible: true },
      {
        id: "note",
        type: "richText",
        visible: true,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Ship by air only." }]
            }
          ]
        }
      }
    ];
    expect(
      scopeOf(
        "purchaseOrder",
        blocks,
        [line("TERMS & CONDITIONS"), line("Ship by air only.")],
        1
      )
    ).toBe("note");
  });

  it("selects the approval block from its heading and what prints under it", () => {
    const blocks: DocumentBlock[] = [
      { id: "terms", type: "terms", visible: true },
      { id: "approval", type: "approval", visible: true }
    ];
    const lines = [
      line("TERMS & CONDITIONS"),
      line("APPROVED BY"),
      line("Jordan Lee")
    ];
    expect(scopeOf("purchaseOrder", blocks, lines, 1)).toBe("approval");
    expect(scopeOf("purchaseOrder", blocks, lines, 2)).toBe("approval");
  });
});

describe("what is not a whole text", () => {
  it("does not take a value starting with a catalog word for that text", () => {
    const lines = [
      line(["Purchase Order", 300]),
      line(["Description", 30], " ", ["Qty", 150], " ", ["Total", 300]),
      line(["Total Station Tripod", 30], " ", ["2", 150], " ", ["10.00", 300])
    ];
    const hit = findPrintedText(
      lines,
      { line: 2, run: 0 },
      fillPrintedTexts(texts, {
        document: {},
        rows: [
          {
            key: "line:a",
            prefix: "line",
            values: { "line.description": "Total Station Tripod" }
          }
        ]
      })
    );
    expect(hit?.scope).toBe("lineItems");
    expect(hit?.key).not.toBe("total");
  });
});
