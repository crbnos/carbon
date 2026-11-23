// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DEFAULT_LABEL_DPI, type LabelSize } from "@carbon/utils";

export type ZplLabelGeometry = {
  dpi: number;
  widthDots: number;
  heightDots: number;
  wScale: number;
  hScale: number;
  scale: number;
  margin: number;
};

/**
 * Computes label dimensions in printer dots and a scale factor relative to
 * the 2"x1" baseline (406x203 dots at 203dpi). The scale carries the printer's
 * dpi too, so a dot-sized font prints the same physical size at any density.
 */
export function getZplLabelGeometry(labelSize: LabelSize): ZplLabelGeometry {
  if (!labelSize.zpl) {
    throw new Error("Invalid label size or missing ZPL configuration");
  }
  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || DEFAULT_LABEL_DPI;

  const widthDots = Math.round(width * dpi);
  const heightDots = Math.round(height * dpi);

  const wScale = widthDots / 406;
  const hScale = heightDots / 203;
  const scale = Math.min(wScale, hScale);
  const margin = Math.round(20 * Math.max(scale, 0.8));

  return { dpi, widthDots, heightDots, wScale, hScale, scale, margin };
}

/** Standard label preamble: start format, set size, no media tracking, UTF-8. */
export function zplLabelHeader({
  widthDots,
  heightDots
}: ZplLabelGeometry): string {
  return `^XA^PW${widthDots}^LL${heightDots}^MNW^CI28`;
}

/**
 * A field's data, hex-escaped with ^FH so a `^` or `~` in user text cannot end
 * the field or start a command (`_` is the escape character). `prefix` is sent
 * as is: a QR code's mode characters.
 */
export function zplFieldData(value: string, prefix = ""): string {
  const escaped = value.replace(
    /[_^~]/g,
    (c) => `_${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `^FH^FD${prefix}${escaped}^FS`;
}
