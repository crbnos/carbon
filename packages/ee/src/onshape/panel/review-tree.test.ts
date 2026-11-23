// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  assemblyReviewTree,
  rowsWithAncestors,
  subtreePartNumbers,
  visibleReviewRows
} from "./review-tree";

// WB-100 holds a frame module and a loose pad; the frame holds two parts.
const plan = (over: Partial<Parameters<typeof assemblyReviewTree>[0]> = {}) =>
  assemblyReviewTree({
    root: { partNumber: "WB-100" },
    items: [
      { partNumber: "FRM-200" },
      { partNumber: "PAD-005" },
      { partNumber: "RAIL-010" },
      { partNumber: "BRK-020" }
    ],
    methods: [
      {
        parentPartNumber: "WB-100",
        writes: [
          { partNumber: "FRM-200", quantity: 1 },
          { partNumber: "PAD-005", quantity: 4 }
        ]
      },
      {
        parentPartNumber: "FRM-200",
        writes: [
          { partNumber: "RAIL-010", quantity: 2 },
          { partNumber: "BRK-020", quantity: 8 }
        ]
      }
    ],
    ...over
  });

const shape = (rows: ReturnType<typeof plan>) =>
  rows.map((row) => [row.partNumber, row.depth, row.quantity]);

describe("assemblyReviewTree", () => {
  it("nests each row under the assembly whose BOM lists it, in BOM order", () => {
    expect(shape(plan())).toEqual([
      ["WB-100", 0, null],
      ["FRM-200", 1, 1],
      ["RAIL-010", 2, 2],
      ["BRK-020", 2, 8],
      ["PAD-005", 1, 4]
    ]);
  });

  it("puts an item no BOM line reaches under the root, last", () => {
    const rows = plan({
      methods: [
        {
          parentPartNumber: "WB-100",
          writes: [{ partNumber: "FRM-200", quantity: 1 }]
        }
      ]
    });
    expect(shape(rows)).toEqual([
      ["WB-100", 0, null],
      ["FRM-200", 1, 1],
      ["PAD-005", 1, null],
      ["RAIL-010", 1, null],
      ["BRK-020", 1, null]
    ]);
  });

  it("gives a part used in two modules a row in each", () => {
    const rows = plan({
      methods: [
        {
          parentPartNumber: "WB-100",
          writes: [
            { partNumber: "FRM-200", quantity: 1 },
            { partNumber: "BRK-020", quantity: 2 }
          ]
        },
        {
          parentPartNumber: "FRM-200",
          writes: [{ partNumber: "BRK-020", quantity: 8 }]
        }
      ]
    });
    const brackets = rows.filter((row) => row.partNumber === "BRK-020");
    expect(brackets.map((row) => row.depth)).toEqual([2, 1]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("does not expand a sub-assembly again inside itself", () => {
    const rows = plan({
      methods: [
        {
          parentPartNumber: "WB-100",
          writes: [{ partNumber: "FRM-200", quantity: 1 }]
        },
        {
          parentPartNumber: "FRM-200",
          writes: [{ partNumber: "FRM-200", quantity: 1 }]
        }
      ]
    });
    expect(rows.filter((row) => row.partNumber === "FRM-200")).toHaveLength(2);
  });
});

describe("visibleReviewRows", () => {
  it("hides the rows under a closed sub-assembly", () => {
    const rows = plan();
    const root = rows[0]!.key;
    expect(
      visibleReviewRows(rows, new Set([root])).map((row) => row.partNumber)
    ).toEqual(["WB-100", "FRM-200", "PAD-005"]);
  });
});

describe("subtreePartNumbers", () => {
  it("lists a module and everything under it", () => {
    const rows = plan();
    const frame = rows.find((row) => row.partNumber === "FRM-200")!;
    expect(subtreePartNumbers(rows, frame.key)).toEqual([
      "FRM-200",
      "RAIL-010",
      "BRK-020"
    ]);
  });
});

describe("rowsWithAncestors", () => {
  it("keeps the matching rows and the assemblies above them", () => {
    expect(
      rowsWithAncestors(plan(), (row) => row.partNumber === "BRK-020").map(
        (row) => row.partNumber
      )
    ).toEqual(["WB-100", "FRM-200", "BRK-020"]);
  });
});
