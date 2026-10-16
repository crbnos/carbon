// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { rowsWithoutRefusedValues } from "./refused-values";

describe("rowsWithoutRefusedValues", () => {
  const rows = [
    { "Part Number": "P-1", Supplier: "Acme" },
    { "Part Number": "P-2", Supplier: " Nowhere Ltd " },
    { "Part Number": "P-3", Supplier: "" }
  ];

  it("keeps every row when nothing is refused", () => {
    expect(rowsWithoutRefusedValues(rows, { supplierId: "Supplier" })).toEqual({
      kept: [0, 1, 2],
      refused: []
    });
  });

  it("refuses the rows that hold a refused value, naming the field", () => {
    expect(
      rowsWithoutRefusedValues(
        rows,
        { readableId: "Part Number", supplierId: "Supplier" },
        { supplierId: { label: "Supplier", values: ["Nowhere Ltd"] } }
      )
    ).toEqual({
      kept: [0, 2],
      refused: [{ row: 1, reason: 'Supplier "Nowhere Ltd" matches no option' }]
    });
  });
});
