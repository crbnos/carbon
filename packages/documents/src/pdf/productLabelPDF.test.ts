import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import { labelSizes } from "@carbon/utils";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import ProductLabelPDF from "./ProductLabelPDF";

const item: ProductLabelItem = {
  itemId: "WIDGET-100",
  revision: "A",
  quantity: 5,
  number: "SN-0001",
  trackedEntityId: "dtClCvNm9blDY0H3FXmDC",
  trackingType: "Serial"
};

function render(labelSize: LabelSize, items = [item]) {
  return renderToBuffer(
    createElement(ProductLabelPDF, { items, labelSize }) as never
  );
}

/** First /MediaBox [...] in the raw PDF bytes. */
function mediaBox(pdf: Buffer): number[] {
  const match = pdf.toString("latin1").match(/\/MediaBox \[([^\]]+)\]/);
  if (!match) throw new Error("No MediaBox found");
  return match[1]!.trim().split(/\s+/).map(Number);
}

const size = (id: string): LabelSize => {
  const found = labelSizes.find((s) => s.id === id);
  if (!found) throw new Error(`Missing label size ${id}`);
  return found;
};

describe("ProductLabelPDF page sizing", () => {
  it("sizes a single label's page exactly to the label (no margins)", async () => {
    const box = mediaBox(await render(size("label2x1")));
    expect(box).toEqual([0, 0, 2 * 72, 1 * 72]);
  });

  it("sizes metric stock exactly too", async () => {
    const s = size("label50x25mm");
    const box = mediaBox(await render(s));
    expect(box[2]).toBeCloseTo(s.width * 72, 1);
    expect(box[3]).toBeCloseTo(s.height * 72, 1);
  });

  it("multi-up sheets still print on a letter page", async () => {
    const sheet: LabelSize = {
      id: "test-sheet",
      name: "Test sheet",
      width: 4,
      height: 2,
      rows: 5,
      columns: 2
    };
    const box = mediaBox(await render(sheet));
    expect(box).toEqual([0, 0, 8.5 * 72, 11 * 72]);
  });
});
