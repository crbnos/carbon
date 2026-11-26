// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  fitViewport,
  layoutOperations,
  openingViewport,
  routePath,
  sequenceOperations,
  windingColumns
} from "./layout";

const chain = Array.from({ length: 8 }, (_, index) => String(index));
const chainDependencies = chain.slice(1).map((operationId, index) => ({
  operationId,
  dependsOnId: chain[index]
}));

const forward = { sourcePosition: "right", targetPosition: "left" };
const backward = { sourcePosition: "left", targetPosition: "right" };

// A 1000px pane holds three 200px columns with 96px gaps.
const columns = windingColumns(1000, false);

describe("winding job layout", () => {
  it("fits three columns in a 1000px pane and one on a phone", () => {
    expect(columns).toBe(3);
    expect(windingColumns(390, true)).toBe(1);
  });

  it("wraps a long chain at the available width and reverses every second row", () => {
    const layout = layoutOperations(
      chain,
      chainDependencies,
      "Winding",
      columns,
      false
    );

    expect(chain.map((id) => layout.positions.get(id))).toEqual([
      { x: 40, y: 40, ...forward },
      { x: 336, y: 40, ...forward },
      { x: 632, y: 40, ...forward },
      { x: 632, y: 250, ...backward },
      { x: 336, y: 250, ...backward },
      { x: 40, y: 250, ...backward },
      { x: 40, y: 460, ...forward },
      { x: 336, y: 460, ...forward }
    ]);
    // Only the two wraps detour, each turning back in the lane outside its
    // column: 48px right of the last column, 48px left of the first.
    expect(layout.routes).toEqual(
      new Map([
        ["2-3", { exitX: 880, laneY: 190, entryX: 880 }],
        ["5-6", { exitX: -8, laneY: 400, entryX: -8 }]
      ])
    );
    expect(layout.bounds).toEqual({ x: -8, y: 40, width: 888, height: 510 });
  });

  it("routes a wrap around the operations stacked beside its source", () => {
    // S1 is a subassembly that joins at P4, so it stacks under P3 at the end
    // of the first row. P3 → P4 must not run down through S1.
    const layout = layoutOperations(
      ["P1", "P2", "P3", "P4", "S1"],
      [
        { dependsOnId: "P1", operationId: "P2" },
        { dependsOnId: "P2", operationId: "P3" },
        { dependsOnId: "P3", operationId: "P4" },
        { dependsOnId: "S1", operationId: "P4" }
      ],
      "Winding",
      columns,
      false
    );

    expect(layout.positions.get("P3")).toEqual({ x: 632, y: 40, ...forward });
    expect(layout.positions.get("S1")).toEqual({ x: 632, y: 186, ...forward });
    expect(layout.positions.get("P4")).toEqual({
      x: 632,
      y: 396,
      ...backward
    });
    expect(layout.routes).toEqual(
      new Map([
        ["P3-P4", { exitX: 880, laneY: 336, entryX: 880 }],
        ["S1-P4", { exitX: 880, laneY: 336, entryX: 880 }]
      ])
    );
  });

  it("routes a dependency that skips an operation under the row, not through it", () => {
    const layout = layoutOperations(
      ["A", "B", "C"],
      [
        { dependsOnId: "A", operationId: "B" },
        { dependsOnId: "B", operationId: "C" },
        { dependsOnId: "A", operationId: "C" }
      ],
      "Winding",
      columns,
      false
    );

    // Out of A into the gap before B, along the lane 60px under the row, and
    // into C from the gap after B.
    expect(layout.routes).toEqual(
      new Map([["A-C", { exitX: 288, laneY: 190, entryX: 584 }]])
    );
  });

  it.each(["Winding", "LR", "TB"] as const)(
    "ignores a dependency on an operation that is not in the job (%s)",
    (direction) => {
      const layout = layoutOperations(
        ["A", "B"],
        [
          { dependsOnId: "A", operationId: "B" },
          { dependsOnId: "X", operationId: "B" }
        ],
        direction,
        columns,
        false
      );

      expect([...layout.positions.keys()]).toEqual(["A", "B"]);
      expect(layout.routes).toEqual(new Map());
    }
  );
});

describe("routed edge path", () => {
  it("turns back in the side lane with rounded corners", () => {
    expect(
      routePath(
        { x: 832, y: 85 },
        { x: 832, y: 295 },
        { exitX: 880, laneY: 190, entryX: 880 }
      )
    ).toBe(
      "M 832 85 L 864 85 Q 880 85 880 101 L 880 279 Q 880 295 864 295 L 832 295"
    );
  });
});

describe("graph viewport", () => {
  const tall = { x: -8, y: 40, width: 888, height: 1000 };

  it("opens a winding graph taller than the pane at its first row, full size", () => {
    expect(
      openingViewport(tall, { width: 1000, height: 600 }, "Winding", 0.1)
    ).toEqual({ x: 64, y: -16, zoom: 1 });
  });

  it("fits the whole graph no smaller than the phone floor", () => {
    expect(fitViewport(tall, { width: 390, height: 700 }, 0.6).zoom).toBe(0.6);
  });
});

describe("operation list sequence", () => {
  const op = (id: string, order: number) => ({ id, order });

  it("lists an operation after the operations it depends on, ties by routing order", () => {
    // A sub-assembly's operations (order 1-2) feed the parent's (order 1-2).
    const operations = [op("p1", 1), op("p2", 2), op("s1", 1), op("s2", 2)];
    const dependencies = [
      { operationId: "s2", dependsOnId: "s1" },
      { operationId: "p1", dependsOnId: "s2" },
      { operationId: "p2", dependsOnId: "p1" }
    ];
    expect(
      sequenceOperations(operations, dependencies).map(({ id }) => id)
    ).toEqual(["s1", "s2", "p1", "p2"]);
  });

  it("lists tied orders the same way whatever order the rows arrive in", () => {
    // Two parallel sub-assemblies (make methods A and B) both start at order 1.
    const tied = (id: string, order: number, jobMakeMethodId: string) => ({
      id,
      order,
      jobMakeMethodId
    });
    const operations = [
      tied("b1", 1, "B"),
      tied("a1", 1, "A"),
      tied("a2", 2, "A"),
      tied("b2", 2, "B"),
      tied("x1", 1, "A")
    ];
    const dependencies = [
      { operationId: "a2", dependsOnId: "a1" },
      { operationId: "b2", dependsOnId: "b1" }
    ];
    const arrivals = [
      operations,
      [...operations].reverse(),
      [
        operations[2],
        operations[4],
        operations[0],
        operations[3],
        operations[1]
      ]
    ];
    for (const rows of arrivals) {
      expect(
        sequenceOperations(rows!, [...dependencies].reverse()).map(
          ({ id }) => id
        )
      ).toEqual(["a1", "x1", "b1", "a2", "b2"]);
    }
  });

  it("keeps every operation when the dependencies form a cycle", () => {
    const operations = [op("b", 2), op("a", 1), op("c", 3)];
    const dependencies = [
      { operationId: "a", dependsOnId: "b" },
      { operationId: "b", dependsOnId: "a" }
    ];
    expect(
      sequenceOperations(operations, dependencies).map(({ id }) => id)
    ).toEqual(["c", "a", "b"]);
  });
});
