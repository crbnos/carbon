import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { FirstArticleInspectionPDFCharacteristic } from "./FirstArticleInspectionPDF";
import FirstArticleInspectionPDF from "./FirstArticleInspectionPDF";
import { SAMPLE_FIRST_ARTICLE_INSPECTION } from "./firstArticleInspection.samples";

function render(
  props: Partial<typeof SAMPLE_FIRST_ARTICLE_INSPECTION> = {}
): Promise<Buffer> {
  return renderToBuffer(
    createElement(FirstArticleInspectionPDF, {
      ...SAMPLE_FIRST_ARTICLE_INSPECTION,
      ...props
    }) as never
  );
}

/** First /MediaBox [...] in the raw PDF bytes. */
function mediaBox(pdf: Buffer): number[] {
  const match = pdf.toString("latin1").match(/\/MediaBox \[([^\]]+)\]/);
  if (!match) throw new Error("No MediaBox found");
  return match[1]!.trim().split(/\s+/).map(Number);
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
}

// Page text is compressed; the DRAFT state shows in the uncompressed Info
// dictionary and in the ExtGState the 0.08-opacity mark is painted with.
const DRAFT_OPACITY = "/ca 0.08";

describe("FirstArticleInspectionPDF", () => {
  it("renders 300 characteristics across landscape continuation pages", async () => {
    const characteristics: FirstArticleInspectionPDFCharacteristic[] =
      Array.from({ length: 300 }, (_, index) => ({
        characteristicNumber: String(index + 1),
        referenceLocation: "A1",
        designator: null,
        requirement: "10.000 ±0.005 mm",
        results: "10.001",
        tooling: null,
        nonconformanceNumber: null,
        comments: null
      }));

    const pdf = await render({ characteristics });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    const [, , width, height] = mediaBox(pdf);
    expect(width).toBeGreaterThan(height!);

    // Form 1 + Form 2 + several Form 3 continuation pages.
    expect(pageCount(pdf)).toBeGreaterThan(4);
  });

  it("marks an unapproved report as a draft", async () => {
    const pdf = await render({ approved: false });
    const raw = pdf.toString("latin1");
    expect(raw).toContain("DRAFT");
    expect(raw).toContain(DRAFT_OPACITY);
  });

  it("renders an approved report without the draft mark", async () => {
    const pdf = await render({ approved: true });
    const raw = pdf.toString("latin1");
    expect(raw).not.toContain("DRAFT");
    expect(raw).not.toContain(DRAFT_OPACITY);
  });
});
