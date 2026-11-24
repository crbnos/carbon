// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renderToBuffer } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import PurchaseOrderPDF from "./PurchaseOrderPDF";
import { SAMPLE_PURCHASE_ORDER } from "./purchaseOrder.samples";

/** The printed lines of a purchase order whose first line has `description`. */
async function printedLines(description: string) {
  const [first, ...rest] = SAMPLE_PURCHASE_ORDER.purchaseOrderLines;
  const pdf = await renderToBuffer(
    createElement(PurchaseOrderPDF, {
      ...SAMPLE_PURCHASE_ORDER,
      purchaseOrderLines: [{ ...first, description }, ...rest]
    } as never) as ReactElement
  );
  const { text } = await extractText(new Uint8Array(pdf));
  return text
    .join("\n")
    .split("\n")
    .map((line) => line.trim());
}

describe("PurchaseOrderPDF line description", () => {
  // The description is what the supplier reads to know what to make or ship,
  // so the default layout prints every line of it, each on its own line.
  it("prints every line of a multi-line description on the default layout", async () => {
    const lines = await printedLines(
      "Steel Bar, 50mm\nCut to 1200 mm\nDeburr both ends\nMill cert 3.1"
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        "Steel Bar, 50mm",
        "Cut to 1200 mm",
        "Deburr both ends",
        "Mill cert 3.1"
      ])
    );
  }, 30000);
});

describe("PurchaseOrderPDF line title", () => {
  // A supplier reads the part number off the PDF, so a wrapped one must not
  // gain a hyphen it does not have.
  it("wraps a long part number after its own hyphens", async () => {
    const partNumber = Array.from(
      { length: 12 },
      (_, index) => `SEG${index + 1}`
    ).join("-");
    const [first, ...rest] = SAMPLE_PURCHASE_ORDER.purchaseOrderLines;
    const pdf = await renderToBuffer(
      createElement(PurchaseOrderPDF, {
        ...SAMPLE_PURCHASE_ORDER,
        purchaseOrderLines: [
          {
            ...first,
            itemReadableId: partNumber,
            supplierPartId: null,
            partNumberDisplay: "Ours Only"
          },
          ...rest
        ]
      } as never) as ReactElement
    );
    const { text } = await extractText(new Uint8Array(pdf));
    const lines = text
      .join("\n")
      .split("\n")
      .map((line) => line.trim());
    // The row number prints on the title's first line.
    const titleLines = lines
      .filter((line) => line.includes("SEG"))
      .map((line) => line.replace(/^1 /, ""));
    expect(titleLines.length).toBeGreaterThan(1);
    expect(titleLines.join("")).toBe(partNumber);
  }, 30000);
});
