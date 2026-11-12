// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { selectableUnitsOfMeasure } from "./items.utils";

const units = [
  { value: "EA", label: "Each", active: true },
  { value: "kg", label: "Kilogram", active: true },
  { value: "LB", label: "Pound", active: false },
  { value: "INCH", label: "Inch", active: false }
];

describe("selectableUnitsOfMeasure", () => {
  it("offers the active units", () => {
    expect(selectableUnitsOfMeasure(units).map((u) => u.value)).toEqual([
      "EA",
      "kg"
    ]);
  });

  it("keeps an inactive unit a record already uses", () => {
    expect(selectableUnitsOfMeasure(units, "LB").map((u) => u.value)).toEqual([
      "EA",
      "kg",
      "LB"
    ]);
  });
});
