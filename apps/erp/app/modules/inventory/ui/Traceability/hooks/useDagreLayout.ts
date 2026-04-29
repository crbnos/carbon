import dagre from "dagre";
import { useMemo } from "react";
import type { LineageEdge, LineageNode } from "../utils";

export type LayoutDirection = "TB" | "LR";

const NODE_WIDTH = 44;
const NODE_HEIGHT = 44;

export type EdgePoint = { x: number; y: number };

export type LayoutResult = {
  positioned: LineageNode[];
  backEdges: Set<string>;
  edgePoints: Map<string, EdgePoint[]>;
};

function detectBackEdges(
  nodes: LineageNode[],
  edges: LineageEdge[]
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const back = new Set<string>();

  function dfs(id: string, path: string[]) {
    if (stack.has(id)) {
      const cycleStart = path.indexOf(id);
      if (cycleStart !== -1) {
        for (let i = cycleStart; i < path.length - 1; i++) {
          back.add(`${path[i]}->${path[i + 1]}`);
        }
        if (path.length > 0) back.add(`${path[path.length - 1]}->${id}`);
      }
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    stack.add(id);
    path.push(id);
    for (const next of adj.get(id) ?? []) dfs(next, path);
    path.pop();
    stack.delete(id);
  }

  for (const n of nodes) if (!visited.has(n.id)) dfs(n.id, []);

  const backEdgeIds = new Set<string>();
  for (const e of edges) {
    if (back.has(`${e.source}->${e.target}`)) backEdgeIds.add(e.id);
  }
  return backEdgeIds;
}

export function computeDagreLayout(
  nodes: LineageNode[],
  edges: LineageEdge[],
  direction: LayoutDirection
): LayoutResult {
  if (nodes.length === 0) {
    return { positioned: nodes, backEdges: new Set(), edgePoints: new Map() };
  }

  const backEdges = detectBackEdges(nodes, edges);

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 140,
    edgesep: 40,
    marginx: 20,
    marginy: 20,
    ranker: "tight-tree",
    acyclicer: "greedy"
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const e of edges) {
    if (backEdges.has(e.id)) continue;
    g.setEdge(e.source, e.target, {}, e.id);
  }

  dagre.layout(g);

  const positioned = nodes.map((n) => {
    const p = g.node(n.id);
    if (!p) return n;
    return {
      ...n,
      position: { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 }
    };
  });

  const edgePoints = new Map<string, EdgePoint[]>();
  for (const e of edges) {
    if (backEdges.has(e.id)) continue;
    const dagreEdge = g.edge({ v: e.source, w: e.target, name: e.id }) as
      | { points?: EdgePoint[] }
      | undefined;
    if (dagreEdge?.points && dagreEdge.points.length >= 2) {
      edgePoints.set(e.id, dagreEdge.points);
    }
  }

  return { positioned, backEdges, edgePoints };
}

export function useDagreLayout(
  nodes: LineageNode[],
  edges: LineageEdge[],
  direction: LayoutDirection
): LayoutResult {
  return useMemo(
    () => computeDagreLayout(nodes, edges, direction),
    [nodes, edges, direction]
  );
}
