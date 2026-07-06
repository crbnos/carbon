import type { LabelSize } from "@carbon/utils";

/**
 * PDF geometry for a single label page, mirroring the ZPL generators'
 * layout (baseline 2" x 1" at 203dpi) so PDF and ZPL prints look alike.
 * All values are in PDF points (72 per inch); the page is exactly the
 * label size.
 */
const POINTS_PER_DOT = 72 / 203;

export type LabelPdfGeometry = {
  pageWidth: number;
  pageHeight: number;
  scale: number;
  margin: number;
  contentTop: number;
  titleFontSize: number;
  descFontSize: number;
  smallFontSize: number;
  lineGap: number;
  bottomOffset: number;
  qrSize: number;
};

export function getLabelPdfGeometry(labelSize: LabelSize): LabelPdfGeometry {
  const pageWidth = labelSize.width * 72;
  const pageHeight = labelSize.height * 72;

  const wScale = labelSize.width / 2;
  const hScale = labelSize.height / 1;
  const scale = Math.min(wScale, hScale);

  const qrModuleSize = Math.max(2, Math.min(8, Math.round(4 * scale)));

  return {
    pageWidth,
    pageHeight,
    scale,
    margin: 20 * Math.max(scale, 0.8) * POINTS_PER_DOT,
    contentTop: 30 * hScale * POINTS_PER_DOT,
    titleFontSize: 25 * scale * POINTS_PER_DOT,
    descFontSize: 18 * scale * POINTS_PER_DOT,
    smallFontSize: 12 * scale * POINTS_PER_DOT,
    lineGap: 7 * scale * POINTS_PER_DOT,
    bottomOffset: 10 * hScale * POINTS_PER_DOT,
    qrSize: qrModuleSize * 29 * POINTS_PER_DOT
  };
}
