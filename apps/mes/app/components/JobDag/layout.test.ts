// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { dependencyHandles, layoutOperations } from "./layout";

const chain = Array.from({ length: 8 }, (_, index) => String(index));
const chainDependencies = chain.slice(1).map((operationId, index) => ({
  operationId,
  dependsOnId: chain[index]
}));

describe("winding job layout", () => {
  it("wraps a long chain at the available width and reverses every second row", () => {
    const positions = layoutOperations(
      chain,
      chainDependencies,
      "Winding",
      1000,
      false
    );

    expect(chain.map((id) => positions.get(id))).toEqual([
      { x: 40, y: 40, row: 0 },
      { x: 336, y: 40, row: 0 },
      { x: 632, y: 40, row: 0 },
      { x: 632, y: 250, row: 1 },
      { x: 336, y: 250, row: 1 },
      { x: 40, y: 250, row: 1 },
      { x: 40, y: 460, row: 2 },
      { x: 336, y: 460, row: 2 }
    ]);
    expect(
      dependencyHandles(positions.get("2")!, positions.get("3")!, "Winding")
    ).toEqual({
      sourceHandle: "source-bottom",
      targetHandle: "target-top",
      vertical: true
    });
    expect(
      dependencyHandles(positions.get("3")!, positions.get("4")!, "Winding")
    ).toEqual({
      sourceHandle: "source-left",
      targetHandle: "target-right",
      vertical: false
    });
  });

  it("keeps parallel operations together without overlapping the next row", () => {
    const positions = layoutOperations(
      ["A", "B", "C", "D", "E"],
      [
        { dependsOnId: "A", operationId: "B" },
        { dependsOnId: "A", operationId: "C" },
        { dependsOnId: "B", operationId: "D" },
        { dependsOnId: "C", operationId: "D" },
        { dependsOnId: "D", operationId: "E" }
      ],
      "Winding",
      1000,
      false
    );

    expect(positions.get("B")?.x).toBe(positions.get("C")?.x);
    expect(Math.abs(positions.get("B")!.y - positions.get("C")!.y)).toBe(146);
    expect(positions.get("E")?.row).toBe(1);
    expect(positions.get("E")!.y).toBeGreaterThan(
      Math.max(positions.get("B")!.y, positions.get("C")!.y) + 90
    );
  });
});
