import { describe, expect, it } from "vitest";
import {
  type LineageEdge,
  type LineageNode,
  simpleBezierPointAt
} from "../utils";
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

/** Node centre — the handles sit dead centre in the 44px box. */
const centre = (n: LineageNode) => ({
  x: n.position.x + 22,
  y: n.position.y + 22
});

/** Resolve a `t` back to the point the edge component would render. */
const pointFor = (
  nodes: LineageNode[],
  e: LineageEdge,
  t: number,
  direction: "TB" | "LR"
) => {
  const s = centre(nodes.find((n) => n.id === e.source)!);
  const g = centre(nodes.find((n) => n.id === e.target)!);
  return direction === "LR"
    ? simpleBezierPointAt(t, s.x, s.y, "right", g.x, g.y, "left")
    : simpleBezierPointAt(t, s.x, s.y, "bottom", g.x, g.y, "top");
};

/** Same overlap test the placement pass uses (gap included). */
const collide = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  w = 26,
  h = 22
) => Math.abs(a.x - b.x) * 2 < w * 2 + 8 && Math.abs(a.y - b.y) * 2 < h * 2 + 8;

describe("resolveEdgeLabelPositions", () => {
  it("leaves a lone label at the curve midpoint", () => {
    const nodes = [node("A", 0, 0), node("B", 0, 400)];
    const ts = resolveEdgeLabelPositions(nodes, [edge("e1", "A", "B")], "TB");

    expect(ts.get("e1")).toBe(0.5);
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

    const ts = resolveEdgeLabelPositions(nodes, edges, "TB");
    const placed = edges.map((e) => pointFor(nodes, e, ts.get(e.id)!, "TB"));

    expect(ts.size).toBe(4);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(collide(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it("keeps every label on its own curve", () => {
    const nodes = [node("S", 0, 0), node("T1", 0, 400), node("T2", 300, 400)];
    const edges = [edge("e1", "S", "T1"), edge("e2", "S", "T2")];
    const ts = resolveEdgeLabelPositions(nodes, edges, "TB");

    // e1 is a straight vertical drop, so wherever it slid it stays on x=22.
    expect(pointFor(nodes, edges[0], ts.get("e1")!, "TB").x).toBe(22);
    // e2 bows toward T2 — its label must sit between the two columns.
    const e2 = pointFor(nodes, edges[1], ts.get("e2")!, "TB");
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
    const edges = [
      edge("e1", "S1", "T1"),
      edge("e2", "S1", "T2"),
      edge("e3", "S2", "T1"),
      edge("e4", "S2", "T2")
    ];
    const ts = resolveEdgeLabelPositions(nodes, edges, "LR");
    const placed = edges.map((e) => pointFor(nodes, e, ts.get(e.id)!, "LR"));

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

    expect(a.get("e1")).toBe(b.get("e1"));
    expect(a.get("e2")).toBe(b.get("e2"));
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

    const ts = resolveEdgeLabelPositions(nodes, edges, "TB");
    const a = pointFor(nodes, edges[0], ts.get("e1")!, "TB");
    const b = pointFor(nodes, edges[1], ts.get("e2")!, "TB");
    const wide = "RECEIVING-DOCK-A".length * 6.2 + 20;

    expect(collide(a, b, wide)).toBe(false);
  });

  it("skips edges whose endpoints are missing", () => {
    const ts = resolveEdgeLabelPositions(
      [node("A", 0, 0)],
      [edge("e1", "A", "GONE")],
      "TB"
    );

    expect(ts.size).toBe(0);
  });

  it("returns a parameter, so a dragged node takes its label along", () => {
    // The regression: resolving to an absolute point stranded the pill in open
    // canvas as soon as the node moved. A `t` re-evaluates against the new
    // endpoints and stays on the curve.
    const nodes = [node("A", 0, 0), node("B", 0, 400)];
    const e = edge("e1", "A", "B");
    const t = resolveEdgeLabelPositions(nodes, [e], "TB").get("e1")!;

    const before = pointFor(nodes, e, t, "TB");
    const dragged = [node("A", 0, 0), node("B", 600, 900)];
    const after = pointFor(dragged, e, t, "TB");

    expect(after).not.toEqual(before);
    // Still exactly on the curve between the moved endpoints.
    expect(after).toEqual(
      simpleBezierPointAt(t, 22, 22, "bottom", 622, 922, "top")
    );
  });
});

describe("simpleBezierPointAt", () => {
  it("returns the midpoint of the endpoints at t=0.5 (vertical handles)", () => {
    // xyflow's control points put both at the mid-y, which collapses the
    // cubic's midpoint onto the straight midpoint.
    expect(simpleBezierPointAt(0.5, 0, 0, "bottom", 100, 400, "top")).toEqual({
      x: 50,
      y: 200
    });
  });

  it("returns the midpoint at t=0.5 for horizontal handles too", () => {
    expect(simpleBezierPointAt(0.5, 0, 0, "right", 400, 100, "left")).toEqual({
      x: 200,
      y: 50
    });
  });

  it("hits the endpoints at t=0 and t=1", () => {
    expect(simpleBezierPointAt(0, 5, 7, "bottom", 90, 300, "top")).toEqual({
      x: 5,
      y: 7
    });
    expect(simpleBezierPointAt(1, 5, 7, "bottom", 90, 300, "top")).toEqual({
      x: 90,
      y: 300
    });
  });
});
