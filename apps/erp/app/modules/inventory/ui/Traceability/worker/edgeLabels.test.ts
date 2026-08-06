import { describe, expect, it } from "vitest";
import type { LineageEdge, LineageNode } from "../utils";
import { resolveEdgeLabelPositions } from "./core";

const node = (id: string, x: number, y: number): LineageNode =>
  ({
    id,
    type: "entity",
    position: { x, y },
    data: { kind: "entity", dimmed: false }
  }) as unknown as LineageNode;

const edge = (
  id: string,
  source: string,
  target: string,
  quantity = 1
): LineageEdge =>
  ({
    id,
    source,
    target,
    type: "quantity",
    data: { kind: "output", quantity, dimmed: false }
  }) as unknown as LineageEdge;

/** Same overlap test the placement pass uses (gap included). */
const collide = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  w = 26,
  h = 22
) => Math.abs(a.x - b.x) * 2 < w * 2 + 8 && Math.abs(a.y - b.y) * 2 < h * 2 + 8;

describe("resolveEdgeLabelPositions", () => {
  it("puts a lone label at the curve midpoint", () => {
    const nodes = [node("A", 0, 0), node("B", 0, 400)];
    const positions = resolveEdgeLabelPositions(
      nodes,
      [edge("e1", "A", "B")],
      "TB"
    );

    // Both centres are x=22; midpoint of y-centres 22 and 422.
    expect(positions.get("e1")).toEqual({ x: 22, y: 222 });
  });

  it("separates parallel edges that share a midpoint", () => {
    // Two sources side by side feeding two targets side by side — every edge
    // spans the same ranks, so all four midpoints land on the same row.
    const nodes = [
      node("S1", 0, 0),
      node("S2", 200, 0),
      node("T1", 0, 400),
      node("T2", 200, 400)
    ];
    const edges = [
      edge("e1", "S1", "T1"),
      edge("e2", "S1", "T2"),
      edge("e3", "S2", "T1"),
      edge("e4", "S2", "T2")
    ];

    const positions = resolveEdgeLabelPositions(nodes, edges, "TB");
    const placed = [...positions.values()];

    expect(placed).toHaveLength(4);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(collide(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it("keeps every label on its own curve", () => {
    const nodes = [node("S", 0, 0), node("T1", 0, 400), node("T2", 300, 400)];
    const positions = resolveEdgeLabelPositions(
      nodes,
      [edge("e1", "S", "T1"), edge("e2", "S", "T2")],
      "TB"
    );

    // e1 is a straight vertical drop, so wherever it slid it stays on x=22.
    expect(positions.get("e1")!.x).toBe(22);
    // e2 bows toward T2 — its label must sit between the two columns.
    const e2 = positions.get("e2")!;
    expect(e2.x).toBeGreaterThan(22);
    expect(e2.x).toBeLessThan(322);
  });

  it("resolves along the horizontal axis in LR", () => {
    const nodes = [
      node("S1", 0, 0),
      node("S2", 0, 200),
      node("T1", 400, 0),
      node("T2", 400, 200)
    ];
    const positions = resolveEdgeLabelPositions(
      nodes,
      [
        edge("e1", "S1", "T1"),
        edge("e2", "S1", "T2"),
        edge("e3", "S2", "T1"),
        edge("e4", "S2", "T2")
      ],
      "LR"
    );
    const placed = [...positions.values()];

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(collide(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it("is deterministic across runs", () => {
    const nodes = [node("S", 0, 0), node("T1", 0, 400), node("T2", 300, 400)];
    const edges = [edge("e1", "S", "T1"), edge("e2", "S", "T2")];

    const a = resolveEdgeLabelPositions(nodes, edges, "TB");
    const b = resolveEdgeLabelPositions(nodes, [...edges].reverse(), "TB");

    expect(a.get("e1")).toEqual(b.get("e1"));
    expect(a.get("e2")).toEqual(b.get("e2"));
  });

  it("widens the box for long labels so they still clear", () => {
    const nodes = [
      node("S1", 0, 0),
      node("S2", 200, 0),
      node("T1", 0, 400),
      node("T2", 200, 400)
    ];
    const edges = [
      {
        ...edge("e1", "S1", "T1"),
        data: {
          kind: "movement",
          quantity: 1,
          labelText: "RECEIVING-DOCK-A",
          dimmed: false
        }
      },
      {
        ...edge("e2", "S2", "T2"),
        data: {
          kind: "movement",
          quantity: 1,
          labelText: "RECEIVING-DOCK-B",
          dimmed: false
        }
      }
    ] as unknown as LineageEdge[];

    const positions = resolveEdgeLabelPositions(nodes, edges, "TB");
    const [a, b] = [...positions.values()];
    const wide = "RECEIVING-DOCK-A".length * 6.2 + 20;

    expect(collide(a, b, wide)).toBe(false);
  });

  it("skips edges whose endpoints are missing", () => {
    const positions = resolveEdgeLabelPositions(
      [node("A", 0, 0)],
      [edge("e1", "A", "GONE")],
      "TB"
    );

    expect(positions.size).toBe(0);
  });
});
