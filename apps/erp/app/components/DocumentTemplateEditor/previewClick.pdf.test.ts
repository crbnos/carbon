// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOCUMENT_PDFS } from "@carbon/documents/pdf";
import {
  collectValues,
  type DocumentTemplateType,
  resolveTemplate
} from "@carbon/documents/template";
import { renderToBuffer } from "@react-pdf/renderer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { groupLines, resolveClick } from "./previewClick";
import { fillPrintedTexts, printedTexts } from "./previewText";

/** Every run of a real PDF, read by pdf.js as the preview reads it, and where a click on it lands. */
async function clicksOn(
  documentType: DocumentTemplateType,
  sampleProps: Record<string, unknown> = {}
) {
  const { Component, sample } = DOCUMENT_PDFS[documentType];
  const template = resolveTemplate(documentType, null);
  const props = { locale: "en-US", ...sample, ...sampleProps };
  const { collector, collected } = collectValues();
  await renderToBuffer(
    createElement(Component, {
      ...props,
      template: {
        ...template,
        blocks: template.blocks.map((block) => ({ ...block, visible: true }))
      },
      valueCollector: collector
    }) as ReactElement
  );
  const pdf = await getDocument({
    data: new Uint8Array(
      await renderToBuffer(createElement(Component, props) as ReactElement)
    ),
    useSystemFonts: true
  }).promise;
  const texts = fillPrintedTexts(
    printedTexts(documentType, template.blocks, template.settings),
    collected
  );

  const clicks: Record<string, string>[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const { height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    // The browser draws no empty run, and a blank one only a space wide.
    const items = content.items.filter(
      (item): item is TextItem => "str" in item && item.str !== ""
    );
    const { lines, places } = groupLines(
      items.map((item) => ({
        text: item.str,
        left: item.transform[4],
        right: item.transform[4] + (item.str.trim() ? item.width : 2),
        top: height - item.transform[5] - (item.height || 9),
        height: item.height || 9
      }))
    );
    items.forEach((item, index) => {
      if (!item.str.trim()) return;
      const hit = resolveClick(
        {
          lines,
          at: places[index],
          top: (height - item.transform[5] - (item.height || 9)) / height,
          pageNumber,
          file: "sample.pdf"
        },
        documentType,
        texts
      );
      clicks.push({
        [item.str]: hit
          ? `${hit.scope}:${hit.key}${hit.exact ? "" : " (panel)"}`
          : "none"
      });
    });
  }
  return clicks;
}

describe("clicking a real PDF", () => {
  // Every run of every document, read by real pdf.js. A change here means a click
  // now lands elsewhere: update it only for a click that should.
  it.each(Object.keys(DOCUMENT_PDFS) as DocumentTemplateType[])(
    "opens the right text on the %s sample",
    async (documentType) => {
      expect(await clicksOn(documentType)).toMatchSnapshot();
    },
    30000
  );

  it("tells two columns printing the same figure apart", async () => {
    const { sample } = DOCUMENT_PDFS.purchaseOrder;
    const [line] = sample.purchaseOrderLines;
    const clicks = await clicksOn("purchaseOrder", {
      purchaseOrderLines: [
        {
          ...line,
          id: "same",
          purchaseQuantity: 1,
          unitPrice: 10,
          supplierUnitPrice: 10,
          supplierTaxAmount: 0,
          supplierShippingCost: 0,
          taxPercent: 0
        }
      ]
    });
    const cells = clicks.filter((click) => "10.00" in click);
    expect(cells.length).toBeGreaterThan(1);
    expect(new Set(cells.map((click) => click["10.00"])).size).toBe(
      cells.length
    );
  }, 30000);

  it("keeps a cell that prints a text's words in its column", async () => {
    const { sample } = DOCUMENT_PDFS.purchaseOrder;
    const [line] = sample.purchaseOrderLines;
    const clicks = await clicksOn("purchaseOrder", {
      purchaseOrderLines: [
        { ...line, id: "a", description: "Supplier" },
        { ...line, id: "b", description: "PLAIN" }
      ]
    });
    expect(clicks.find((click) => "PLAIN" in click)).toEqual({
      PLAIN: "lineItems:detailsCell"
    });
    expect(clicks.find((click) => "Supplier" in click)?.Supplier).not.toBe(
      "parties:supplier"
    );
  }, 30000);

  it("does not take a part named like a catalog word for that word", async () => {
    const { sample } = DOCUMENT_PDFS.purchaseOrder;
    const [line] = sample.purchaseOrderLines;
    const clicks = await clicksOn("purchaseOrder", {
      purchaseOrderLines: [
        { ...line, id: "named", description: "Total Station Tripod" }
      ]
    });
    expect(clicks.find((click) => "Total Station Tripod" in click)).toEqual({
      "Total Station Tripod": "lineItems:detailsCell"
    });
  }, 30000);
});
