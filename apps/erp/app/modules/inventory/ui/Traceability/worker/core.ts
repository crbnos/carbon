import dagre from "dagre";
import {
  annotateEdgeWeights,
  type LineageEdge,
  type LineageEdgeData,
  type LineageNode,
  type LineagePayload,
  lineagePathEdgesMulti,
  payloadToFlow
} from "../utils";

export type LayoutDirection = "TB" | "LR";

export type EdgePoint = { x: number; y: number };

export type LayoutInput = {
  payload: LineagePayload;
  direction: LayoutDirection;
  spacing: number;
  rejectIds: string[];
};

export type LayoutResult = {
  nodes: LineageNode[];
  edges: LineageEdge[];
};

export type SelectionPathResult = {
  pathNodeIds: string[];
  pathEdgeIds: string[];
};

const NODE_WIDTH = 44;
const NODE_HEIGHT = 44;

const SPACING_TABLE: Record<
  number,
  { nodesep: number; ranksep: number; edgesep: number }
> = {
  1: { nodesep: 60, ranksep: 100, edgesep: 30 },
  2: { nodesep: 100, ranksep: 160, edgesep: 50 },
  3: { nodesep: 160, ranksep: 240, edgesep: 80 },
  4: { nodesep: 240, ranksep: 340, edgesep: 130 },
  5: { nodesep: 360, ranksep: 480, edgesep: 200 }
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
  direction: LayoutDirection,
  spacingLevel: number = 2
): {
  positioned: LineageNode[];
  backEdges: Set<string>;
  edgePoints: Map<string, EdgePoint[]>;
} {
  if (nodes.length === 0) {
    return { positioned: nodes, backEdges: new Set(), edgePoints: new Map() };
  }

  const backEdges = detectBackEdges(nodes, edges);

  const g = new dagre.graphlib.Graph({ multigraph: true });
  const clamped = Math.min(Math.max(1, Math.round(spacingLevel)), 5);
  const sp = SPACING_TABLE[clamped];
  g.setGraph({
    rankdir: direction,
    nodesep: sp.nodesep,
    ranksep: sp.ranksep,
    edgesep: sp.edgesep,
    marginx: 40,
    marginy: 40,
    ranker: clamped >= 4 ? "network-simplex" : "tight-tree",
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

export function computeFullLayout(input: LayoutInput): LayoutResult {
  const flow = payloadToFlow(input.payload);
  const weightedEdges = annotateEdgeWeights(
    flow.edges,
    new Set(input.rejectIds)
  );
  const { positioned, backEdges, edgePoints } = computeDagreLayout(
    flow.nodes,
    weightedEdges,
    input.direction,
    input.spacing
  );
  const finalEdges: LineageEdge[] = weightedEdges.map((e) => ({
    ...e,
    data: {
      ...(e.data as LineageEdgeData),
      isBackEdge: backEdges.has(e.id),
      points: edgePoints.get(e.id)
    }
  }));
  return { nodes: positioned, edges: finalEdges };
}

export function computeSelectionPath(
  edges: LineageEdge[],
  rootIds: string[]
): SelectionPathResult | null {
  if (rootIds.length === 0) return null;
  const r = lineagePathEdgesMulti(rootIds, edges);
  return {
    pathNodeIds: Array.from(r.nodeIds),
    pathEdgeIds: Array.from(r.edgeIds)
  };
}
