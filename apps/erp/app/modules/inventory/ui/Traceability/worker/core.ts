import Dagre from "@dagrejs/dagre";
import type { EntityCluster } from "../cluster";
import {
  annotateEdgeWeights,
  type LineageEdge,
  type LineageEdgeData,
  type LineageNode,
  type LineagePayload,
  payloadToFlow
} from "../utils";

export type LayoutDirection = "TB" | "LR";

export type EdgePoint = { x: number; y: number };

export type LayoutInput = {
  payload: LineagePayload;
  direction: LayoutDirection;
  spacing: number;
  rejectIds: string[];
  /** Never clustered — the traced root stays individually visible. */
  rootIds: string[];
};

export type LayoutResult = {
  nodes: LineageNode[];
  edges: LineageEdge[];
  clusters: EntityCluster[];
  memberToCluster: Record<string, string>;
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
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    let arr = adj.get(e.source);
    if (arr === undefined) {
      arr = [];
      adj.set(e.source, arr);
    }
    arr.push(e.target);
  }

  const visited = new Set<string>();
  const pathIdx = new Map<string, number>();
  const path: string[] = [];
  const back = new Set<string>();

  function dfs(id: string) {
    const onStackAt = pathIdx.get(id);
    if (onStackAt !== undefined) {
      for (let i = onStackAt; i < path.length - 1; i++) {
        back.add(`${path[i]}->${path[i + 1]}`);
      }
      back.add(`${path[path.length - 1]}->${id}`);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    pathIdx.set(id, path.length);
    path.push(id);
    const neighbors = adj.get(id);
    if (neighbors !== undefined) {
      for (let i = 0; i < neighbors.length; i++) dfs(neighbors[i]);
    }
    path.pop();
    pathIdx.delete(id);
  }

  for (let i = 0; i < nodes.length; i++) {
    const id = nodes[i].id;
    if (!visited.has(id)) dfs(id);
  }

  const backEdgeIds = new Set<string>();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
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

  const g = new Dagre.graphlib.Graph({ multigraph: true });
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

  Dagre.layout(g);

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
  const flow = payloadToFlow(input.payload, undefined, {
    rootIds: input.rootIds
  });
  // Reject ids arrive as ENTITY ids, but a rejected member no longer has a
  // node of its own — its cluster carries the reject styling instead.
  const rejectIds = new Set(input.rejectIds);
  for (const cluster of flow.clusters) {
    if (cluster.status === "Rejected") rejectIds.add(cluster.id);
  }
  const weightedEdges = annotateEdgeWeights(flow.edges, rejectIds);
  const { positioned, backEdges, edgePoints } = computeDagreLayout(
    flow.nodes,
    weightedEdges,
    input.direction,
    input.spacing
  );
  const finalEdges: LineageEdge[] = [];
  for (let i = 0; i < weightedEdges.length; i++) {
    const e = weightedEdges[i];
    finalEdges.push({
      ...e,
      data: {
        ...(e.data as LineageEdgeData),
        isBackEdge: backEdges.has(e.id),
        points: edgePoints.get(e.id)
      }
    });
  }
  return {
    nodes: positioned,
    edges: finalEdges,
    clusters: flow.clusters,
    memberToCluster: flow.memberToCluster
  };
}

export function computeSelectionPath(
  edges: LineageEdge[],
  rootIds: string[],
  excludedIds: string[] = [],
  additionalRootIds: string[] = []
): SelectionPathResult | null {
  if (rootIds.length === 0 && additionalRootIds.length === 0) return null;

  const excludedSet = new Set(excludedIds);

  // Build outgoing adjacency once in a single pass over edges.
  // Skip back-edges and edges touching excluded nodes inline so we never
  // allocate an intermediate `acyclic` array.
  const outgoing = new Map<string, LineageEdge[]>();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (e.data?.isBackEdge) continue;
    if (excludedSet.has(e.source) || excludedSet.has(e.target)) continue;
    let arr = outgoing.get(e.source);
    if (arr === undefined) {
      arr = [];
      outgoing.set(e.source, arr);
    }
    arr.push(e);
  }

  // Collect roots (primary + additional), dropping excluded.
  const allRoots: string[] = [];
  for (let i = 0; i < rootIds.length; i++) {
    if (!excludedSet.has(rootIds[i])) allRoots.push(rootIds[i]);
  }
  for (let i = 0; i < additionalRootIds.length; i++) {
    const id = additionalRootIds[i];
    if (!excludedSet.has(id)) allRoots.push(id);
  }
  if (allRoots.length === 0) return null;

  // Forward DFS from every root, sharing the adjacency map and visited
  // sets across roots (a node visited from one root never revisits).
  const edgeIds = new Set<string>();
  const nodeIds = new Set<string>();
  const stack: string[] = [];
  for (let i = 0; i < allRoots.length; i++) {
    const root = allRoots[i];
    if (nodeIds.has(root)) continue;
    nodeIds.add(root);
    stack.push(root);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const neighbors = outgoing.get(cur);
      if (neighbors === undefined) continue;
      for (let j = 0; j < neighbors.length; j++) {
        const e = neighbors[j];
        edgeIds.add(e.id);
        if (!nodeIds.has(e.target)) {
          nodeIds.add(e.target);
          stack.push(e.target);
        }
      }
    }
  }

  return {
    pathNodeIds: Array.from(nodeIds),
    pathEdgeIds: Array.from(edgeIds)
  };
}
