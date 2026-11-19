// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LabelSize } from "@carbon/utils";
import { labelSizes, withLabelDpi } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { generateTestLabelZPL } from "./TestLabelZPL";

const size = (id: string): LabelSize => {
  const found = labelSizes.find((s) => s.id === id);
  if (!found) throw new Error(`Missing label size ${id}`);
  return found;
};

describe("generateTestLabelZPL", () => {
  it("fits the smallest label: 1.5 x 1 inch at 203 dpi", () => {
    // 305 x 203 dots; scale = 305 / 406, margin = 20 * 0.8.
    expect(generateTestLabelZPL(size("label1.5x1"), "11/19/26, 9:30 AM")).toBe(
      [
        "^XA^PW305^LL203^MNW^CI28",
        "^FO16,15^A0N,23,23^FH^FDTest Print^FS",
        '^FO16,45^A0N,15,15^FH^FD1.5" x 1" 203 dpi^FS',
        "^FO16,68^A0N,12,12^FH^FD11/19/26, 9:30 AM^FS",
        "^XZ"
      ].join("\n")
    );
  });

  it("names a metric size in millimetres and the printer's dpi", () => {
    const zpl = generateTestLabelZPL(
      withLabelDpi(size("label100x50mm"), 300),
      "19/11/2026, 09:30"
    );
    expect(zpl).toContain("^FD100mm x 50mm 300 dpi^FS");
  });
});
