import type { LabelSize } from "@carbon/utils";

export type ZplLabelGeometry = {
  widthDots: number;
  heightDots: number;
  wScale: number;
  hScale: number;
  scale: number;
  margin: number;
};

/**
 * Computes label dimensions in printer dots and a scale factor relative to
 * the 2"x1" baseline (406x203 dots at 203dpi).
 */
export function getZplLabelGeometry(labelSize: LabelSize): ZplLabelGeometry {
  if (!labelSize.zpl) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }
  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || 203;

  const widthDots = Math.round(width * dpi);
  const heightDots = Math.round(height * dpi);

  const wScale = widthDots / 406;
  const hScale = heightDots / 203;
  const scale = Math.min(wScale, hScale);
  const margin = Math.round(20 * Math.max(scale, 0.8));

  return { widthDots, heightDots, wScale, hScale, scale, margin };
}

/** Standard label preamble: start format, set size, no media tracking, UTF-8. */
export function zplLabelHeader({
  widthDots,
  heightDots
}: ZplLabelGeometry): string {
  return `^XA^PW${widthDots}^LL${heightDots}^MNW^CI28`;
}
