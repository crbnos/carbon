// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { treegridCellTarget, treegridRowProps } from "./treegrid";

describe("treegridCellTarget", () => {
  it("moves right to the next cell and stays on the last", () => {
    expect(treegridCellTarget("ArrowRight", 0, 3)).toBe(1);
    expect(treegridCellTarget("ArrowRight", 2, 3)).toBe(2);
  });

  it("moves left to the previous cell, and to the row from the first", () => {
    expect(treegridCellTarget("ArrowLeft", 2, 3)).toBe(1);
    expect(treegridCellTarget("ArrowLeft", 0, 3)).toBe("row");
  });

  it("leaves every other key to the tree", () => {
    expect(treegridCellTarget("ArrowDown", 1, 3)).toBeNull();
    expect(treegridCellTarget("Enter", 1, 3)).toBeNull();
  });
});

describe("treegridRowProps", () => {
  it("reports aria-expanded only on rows with children", () => {
    expect(
      treegridRowProps({ level: 0, hasChildren: false, expanded: false })
    ).toEqual({
      "aria-level": 1,
      "aria-expanded": undefined,
      "aria-rowindex": undefined
    });
    expect(
      treegridRowProps({
        level: 1,
        hasChildren: true,
        expanded: true,
        rowIndex: 3
      })
    ).toEqual({ "aria-level": 2, "aria-expanded": true, "aria-rowindex": 3 });
  });
});
