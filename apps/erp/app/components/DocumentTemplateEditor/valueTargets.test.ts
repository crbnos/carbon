// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CollectedValues,
  DocumentBlock
} from "@carbon/documents/template";
import { describe, expect, it } from "vitest";
import { valueTargets } from "./valueTargets";

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
