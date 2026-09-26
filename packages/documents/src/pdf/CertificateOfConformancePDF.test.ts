import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import CertificateOfConformancePDF from "./CertificateOfConformancePDF";
import { SAMPLE_CERTIFICATE_OF_CONFORMANCE } from "./certificateOfConformance.samples";

function render(issued: boolean) {
  return renderToBuffer(
    createElement(CertificateOfConformancePDF, {
      ...SAMPLE_CERTIFICATE_OF_CONFORMANCE,
      certificate: { ...SAMPLE_CERTIFICATE_OF_CONFORMANCE.certificate, issued }
    }) as never
  );
}

// Page text is compressed and glyph-encoded, so the raw bytes cannot show the
// watermark's letters. What they do show: the uncompressed Info dictionary
// (subject/keywords name the preview) and the ExtGState the 0.08-opacity
// watermark is painted with.
const WATERMARK_OPACITY = "/ca 0.08";

describe("CertificateOfConformancePDF", () => {
  it("renders the sample certificate", async () => {
    const pdf = await render(true);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const raw = pdf.toString("latin1");
    expect(raw).not.toContain("PREVIEW");
    expect(raw).not.toContain(WATERMARK_OPACITY);
  });

  it("marks an unissued certificate as a preview", async () => {
    const pdf = await render(false);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const raw = pdf.toString("latin1");
    expect(raw).toContain("PREVIEW");
    expect(raw).toContain(WATERMARK_OPACITY);
  });
});
