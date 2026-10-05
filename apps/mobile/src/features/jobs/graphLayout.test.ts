// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JobOperationSummary } from "@carbon/mes-core";
import { describe, expect, it } from "vitest";
import { fitTransform, layoutJobGraph, NODE_WIDTH } from "./graphLayout";

const op = (id: string, order?: number) =>
  ({ id, order }) as unknown as JobOperationSummary;
const at = (graph: ReturnType<typeof layoutJobGraph>, id: string) =>
  graph.nodes.find((node) => node.operation.id === id);

describe("layoutJobGraph", () => {
  it("puts a dependency in the column to the LEFT of what needs it", () => {
    const graph = layoutJobGraph(
      [op("a"), op("b")],
      [{ operationId: "b", dependsOnId: "a" }]
    );
    expect(at(graph, "a")?.x).toBeLessThan(at(graph, "b")?.x ?? 0);
  });

  it("ranks by the LONGEST path, so no edge is ever drawn backwards", () => {
    // a → b → c and a → c. Taking the shortest path would put c one column
    // after a, which is the same column as b — and the b→c edge would then
    // point left.
    const graph = layoutJobGraph(
      [op("a"), op("b"), op("c")],
      [
        { operationId: "b", dependsOnId: "a" },
        { operationId: "c", dependsOnId: "b" },
        { operationId: "c", dependsOnId: "a" }
      ]
    );
    for (const edge of graph.edges) expect(edge.x2).toBeGreaterThan(edge.x1);
  });

  it("stacks a fan-out's branches in one column", () => {
    const graph = layoutJobGraph(
      [op("root"), op("left", 1), op("right", 2)],
      [
        { operationId: "left", dependsOnId: "root" },
        { operationId: "right", dependsOnId: "root" }
      ]
    );
    expect(at(graph, "left")?.x).toBe(at(graph, "right")?.x);
    expect(at(graph, "left")?.y).toBeLessThan(at(graph, "right")?.y ?? 0);
  });

  it("puts every unconstrained operation in the first column", () => {
    const graph = layoutJobGraph([op("a", 1), op("b", 2), op("c", 3)], []);
    const xs = new Set(graph.nodes.map((node) => node.x));
    expect(xs.size).toBe(1);
  });

  it("settles on a CYCLE instead of recursing for ever", () => {
    // The bound is what makes this terminate. Without it a longest-path walk
    // over a cycle never finishes — and a job graph comes from data, so a
    // malformed one must render, not hang the screen.
    const graph = layoutJobGraph(
      [op("a"), op("b")],
      [
        { operationId: "a", dependsOnId: "b" },
        { operationId: "b", dependsOnId: "a" }
      ]
    );
    expect(graph.nodes).toHaveLength(2);
  });

  it("drops an edge naming an operation outside this job", () => {
    const graph = layoutJobGraph(
      [op("a")],
      [{ operationId: "a", dependsOnId: "elsewhere" }]
    );
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes).toHaveLength(1);
  });

  it("starts an edge on the source's right and ends on the target's left", () => {
    const graph = layoutJobGraph(
      [op("a"), op("b")],
      [{ operationId: "b", dependsOnId: "a" }]
    );
    const edge = graph.edges[0];
    expect(edge?.x1).toBe((at(graph, "a")?.x ?? 0) + NODE_WIDTH);
    expect(edge?.x2).toBe(at(graph, "b")?.x);
  });

  it("is empty for no operations rather than NaN bounds", () => {
    expect(layoutJobGraph([], [])).toEqual({
      nodes: [],
      edges: [],
      width: 0,
      height: 0
    });
  });

  it("never loses an operation", () => {
    const operations = [op("a"), op("b"), op("c"), op("d")];
    const graph = layoutJobGraph(operations, [
      { operationId: "b", dependsOnId: "a" },
      { operationId: "d", dependsOnId: "c" }
    ]);
    expect(graph.nodes).toHaveLength(4);
  });
});

describe("fitTransform", () => {
  it("scales a big graph down to fit", () => {
    const { scale } = fitTransform(
      { width: 2000, height: 500 },
      { width: 1000, height: 500 }
    );
    expect(scale).toBeCloseTo(0.5, 5);
  });

  it("never scales a small graph UP past its natural size", () => {
    // Two operations blown up to fill an iPad read as broken.
    const { scale } = fitTransform(
      { width: 200, height: 100 },
      { width: 1000, height: 800 }
    );
    expect(scale).toBe(1);
  });

  it("centres what it fits", () => {
    const { x, y } = fitTransform(
      { width: 500, height: 200 },
      { width: 1000, height: 400 }
    );
    expect(x).toBeCloseTo(250, 5);
    expect(y).toBeCloseTo(100, 5);
  });

  it("is identity for a degenerate viewport rather than NaN", () => {
    // The first render measures 0×0, and a NaN transform blanks the view.
    expect(
      fitTransform({ width: 100, height: 100 }, { width: 0, height: 0 })
    ).toEqual({ scale: 1, x: 0, y: 0 });
    expect(
      fitTransform({ width: 0, height: 0 }, { width: 100, height: 100 })
    ).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
