// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLabelSizeLabel, type LabelSize, round } from "@carbon/utils";
import { getZplLabelGeometry, zplFieldData, zplLabelHeader } from "./utils";

/** A printer's test label: its size, its dpi and when it was sent. */
export function generateTestLabelZPL(
  labelSize: LabelSize,
  printedAt: string
): string {
  const geometry = getZplLabelGeometry(labelSize);
  const { margin, scale } = geometry;
  // Sizes are in 2"x1" @ 203dpi dots; the geometry's scale fits them to this label and dpi.
  const d = (dots: number) => round(dots * scale, 0);
  const text = (y: number, size: number, value: string) =>
    `^FO${margin},${d(y)}^A0N,${d(size)},${d(size)}${zplFieldData(value)}`;
  return [
    zplLabelHeader(geometry),
    text(20, 30, "Test Print"),
    text(60, 20, `${getLabelSizeLabel(labelSize)} ${geometry.dpi} dpi`),
    text(90, 16, printedAt),
    "^XZ"
  ].join("\n");
}
