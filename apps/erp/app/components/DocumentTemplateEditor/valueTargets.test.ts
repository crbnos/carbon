// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CollectedValues,
  DocumentBlock
} from "@carbon/documents/template";
import { describe, expect, it } from "vitest";
import type { PageRun } from "./previewText";
import { findPrintedValue, valueTargets } from "./valueTargets";

const blocks: DocumentBlock[] = [
  { id: "parties", type: "parties", visible: true },
  { id: "lineItems", type: "lineItems", visible: true },
  { id: "summary", type: "summary", visible: true }
];
const collected: CollectedValues = {
  document: {
    "supplier.name": "Steelworks Ltd",
    "supplier.addressLine1": "200 Foundry Rd",
    "supplier.contactName": "Sam",
    "buyer.name": "Pat",
    "order.total": "100.00"
  },
  rows: [
    {
      key: "line:a",
      prefix: "line",
      values: {
        "line.description": "WIDGET",
        "line.quantity": "10",
        "line.unitPrice": "5.00"
      }
    },
    {
      key: "line:b",
      prefix: "line",
      values: { "line.description": "WIDGET", "line.quantity": "4" }
    }
  ]
};
const targets = valueTargets("purchaseOrder", blocks, {}, collected);
const run = (text: string): PageRun => ({ text, left: 0, right: 1 });
const at = (lines: PageRun[][], line: number, r = 0) => {
  const hit = findPrintedValue(lines, { line, run: r }, targets);
  return hit && `${hit.rowKey ?? "doc"}:${hit.token}`;
};

describe("valueTargets", () => {
  it("lists changeable values per row, not amounts or quantities", () => {
    const tokens = targets.map((t) => t.token);
    expect(tokens).toContain("supplier.name");
    expect(tokens).toContain("line.description");
    expect(tokens).not.toContain("line.quantity");
    expect(tokens).not.toContain("line.unitPrice");
    expect(tokens).not.toContain("order.total");
    expect(
      targets.filter((t) => t.token === "line.description").map((t) => t.rowKey)
    ).toEqual(["line:a", "line:b"]);
  });

  it("leaves out what a hidden text prints and a block off the page", () => {
    const hidden = valueTargets(
      "purchaseOrder",
      [
        {
          id: "parties",
          type: "parties",
          visible: true,
          hidden: ["supplierName"]
        },
        { id: "lineItems", type: "lineItems", visible: false }
      ],
      {},
      collected
    ).map((t) => t.token);
    expect(hidden).not.toContain("supplier.name");
    expect(hidden).not.toContain("line.description");
  });

  it("follows the words the user left", () => {
    const changed = valueTargets(
      "purchaseOrder",
      [
        {
          id: "parties",
          type: "parties",
          visible: true,
          text: { supplierName: "Vendor" }
        }
      ],
      {},
      collected
    ).map((t) => t.token);
    expect(changed).not.toContain("supplier.name");
  });
});

describe("findPrintedValue", () => {
  it("finds a value with no label", () => {
    expect(at([[run("Steelworks Ltd")]], 0)).toBe("doc:supplier.name");
  });

  it("tells two rows with the same label apart by their value", () => {
    const lines = [[run("Contact: Sam")], [run("Contact: Pat")]];
    expect(at(lines, 0)).toBe("doc:supplier.contactName");
    expect(at(lines, 1)).toBe("doc:buyer.name");
  });

  it("takes the n-th row when rows print the same text", () => {
    const lines = [[run("WIDGET")], [run("WIDGET")]];
    expect(at(lines, 0)).toBe("line:a:line.description");
    expect(at(lines, 1)).toBe("line:b:line.description");
  });

  it("finds a piece of a split or wrapped value", () => {
    expect(at([[run("200"), run("Foundry Rd")]], 0, 1)).toBe(
      "doc:supplier.addressLine1"
    );
  });

  it("finds a value by what it prints now, not the record's text", () => {
    const changed = valueTargets(
      "purchaseOrder",
      blocks,
      {
        valueEdits: {
          rows: {
            "line:a": { "line.description": "Smallsat Bus\nIncludes Harness" }
          }
        }
      },
      collected
    );
    const lines = [[run("Smallsat Bus")], [run("Includes Harness")]];
    for (const line of [0, 1]) {
      expect(findPrintedValue(lines, { line, run: 0 }, changed)?.rowKey).toBe(
        "line:a"
      );
    }
  });

  it("finds nothing for an amount, a short piece or another word", () => {
    expect(at([[run("100.00")]], 0)).toBeNull();
    expect(at([[run("Ltd")], [run("St")]], 1)).toBeNull();
    expect(at([[run("Terms & Conditions")]], 0)).toBeNull();
  });
});

describe("the same value printed twice in one panel", () => {
  it("is one value to change", () => {
    const targets = valueTargets(
      "issue",
      [{ id: "header", type: "header", visible: true }],
      // The title prints in the header; the footer's words print after the blocks.
      { text: { title: "{issue.name}", issueNumber: "{issue.name}" } },
      { document: { "issue.name": "Scratched" }, rows: [] }
    );
    expect(targets.filter((t) => t.token === "issue.name")).toHaveLength(1);
  });
});

describe("a printed word that is also part of a value", () => {
  it("is the word", () => {
    const target = {
      scope: "parties",
      key: "companyName",
      rowKey: null,
      prefix: null,
      token: "company.name",
      recordValue: "Total Engineering Ltd",
      printedValue: "Total Engineering Ltd"
    };
    const lines = [[{ text: "Total", left: 0, right: 10 }]];
    const clicked = { line: 0, run: 0 };
    expect(findPrintedValue(lines, clicked, [target])).toBe(target);
    expect(findPrintedValue(lines, clicked, [target], ["Total"])).toBeNull();
  });
});
