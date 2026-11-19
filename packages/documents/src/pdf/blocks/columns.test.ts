// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { columnWidths } from "./columns";

const columns = [
  { key: "description", width: 50 },
  { key: "qty", width: 20 },
  { key: "total", width: 30 }
] as const;

describe("columnWidths", () => {
  it("keeps every width when nothing is hidden", () => {
    expect(columnWidths(columns, () => true, "description")).toEqual({
      description: "50%",
      qty: "20%",
      total: "30%"
    });
  });

  it("gives a hidden column's width to the description column", () => {
    expect(
      columnWidths(columns, (key) => key !== "qty", "description")
    ).toEqual({ description: "70%", total: "30%" });
  });

  it("gives the width to the first visible column when description is hidden", () => {
    expect(
      columnWidths(columns, (key) => key !== "description", "description")
    ).toEqual({ qty: "70%", total: "30%" });
  });
});
