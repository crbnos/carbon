import { describe, expect, it } from "vitest";
import type { BuilderEdge, BuilderNode } from "../../types";
import { layoutPositions } from "./layout";

const node = (
  id: string,
  type: BuilderNode["type"] = "action"
): BuilderNode => ({
  id,
  name: id,
  type,
  position: { x: 0, y: 0 },
  data: {}
});

const edge = (source: string, target: string): BuilderEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  sourceHandle: "out",
  targetHandle: "in"
});

describe("layoutPositions", () => {
  it("lays a chain out left to right", () => {
    const nodes = [node("a", "trigger"), node("b"), node("c")];
    const positions = layoutPositions(nodes, [edge("a", "b"), edge("b", "c")]);

    expect(Object.keys(positions).sort()).toEqual(["a", "b", "c"]);
    expect(positions.a.x).toBeLessThan(positions.b.x);
    expect(positions.b.x).toBeLessThan(positions.c.x);
  });

  it("still places every node when the graph has a cycle", () => {
    const nodes = [node("a", "trigger"), node("b"), node("c")];
    const positions = layoutPositions(nodes, [
      edge("a", "b"),
      edge("b", "c"),
      edge("c", "b")
    ]);

    expect(Object.keys(positions).sort()).toEqual(["a", "b", "c"]);
    for (const id of ["a", "b", "c"]) {
      expect(Number.isFinite(positions[id].x)).toBe(true);
      expect(Number.isFinite(positions[id].y)).toBe(true);
    }
  });

  it("survives a self-loop and an edge to a deleted node", () => {
    const nodes = [node("a", "trigger"), node("b")];
    const positions = layoutPositions(nodes, [
      edge("a", "b"),
      edge("b", "b"),
      edge("b", "gone")
    ]);

    expect(Object.keys(positions).sort()).toEqual(["a", "b"]);
  });

  it("separates disconnected nodes instead of stacking them", () => {
    const nodes = [node("a", "trigger"), node("b"), node("c")];
    const positions = layoutPositions(nodes, []);

    const ys = [positions.a.y, positions.b.y, positions.c.y];
    expect(new Set(ys).size).toBe(3);
  });
});
