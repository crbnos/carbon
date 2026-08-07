import Dagre from "@dagrejs/dagre";
import type { Position } from "@xyflow/react";
import type { EntityCluster } from "../cluster";
import {
  activityHeadline,
  annotateEdgeWeights,
  EDGE_BORDER_RADIUS,
  edgeLabelPoint,
  entityHeadline,
  type LineageEdge,
  type LineageEdgeData,
  type LineageNode,
  type LineagePayload,
  payloadToFlow
} from "../utils";

// Position's values ARE these strings. Typed as the enum but written as
// literals so the worker bundle never pulls in @xyflow/react at runtime.
const POS_RIGHT = "right" as Position;
const POS_LEFT = "left" as Position;
const POS_BOTTOM = "bottom" as Position;
const POS_TOP = "top" as Position;

export type LayoutDirection = "TB" | "LR";

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

/**
 * Every node renders a `whitespace-nowrap` label BELOW its circle, outside the
 * 44px box xyflow measures. Laying out on the circle alone separates the
 * circles correctly and lets the labels collide — "SN4-0001…SN4-0004" is far
 * wider than the dot it belongs to.
 *
 * So dagre gets the real footprint: the circle plus whatever the label
 * occupies. Approximate glyph widths are fine — this only has to be close
 * enough that neighbours don't touch, and the worker has no DOM to measure in.
 */
const CHAR_W_11 = 6.2;
const CHAR_W_10 = 5.6;
const LABEL_PAD_X = 12;
const LABEL_LINE_H = 15;
const LABEL_GAP = 8;

function labelWidth(text: string, charWidth: number): number {
  return text.length * charWidth + LABEL_PAD_X;
}

function nodeFootprint(node: LineageNode): { width: number; height: number } {
  const data = node.data as Record<string, any> | undefined;
  let width = NODE_WIDTH;
  let lines = 0;

  if (data?.kind === "entity" && data.entity) {
    width = Math.max(
      width,
      labelWidth(entityHeadline(data.entity, 8), CHAR_W_11)
    );
    lines = 1;
  } else if (data?.kind === "entityGroup" && data.cluster) {
    const cluster = data.cluster as EntityCluster;
    width = Math.max(width, labelWidth(cluster.headline, CHAR_W_11));
    lines = 1;
    const range = cluster.readableIdRange;
    if (range) {
      const text = range[0] === range[1] ? range[0] : `${range[0]}…${range[1]}`;
      width = Math.max(width, labelWidth(text, CHAR_W_10));
      lines = 2;
    }
  } else if (data?.kind === "activity" && data.activity) {
    width = Math.max(
      width,
      labelWidth(activityHeadline(data.activity, 8), CHAR_W_11)
    );
    lines = 1;
  }

  const height =
    NODE_HEIGHT + (lines > 0 ? LABEL_GAP + lines * LABEL_LINE_H : 0);
  return { width, height };
}

/**
 * Where along each edge its quantity pill should sit.
 *
 * Every edge defaults its label to the path midpoint, so parallel edges between
 * the same two ranks stack their pills on top of each other. Slide each one
 * along its OWN path until it clears the ones already placed — the label stays
 * visually attached to its edge instead of being nudged into open space.
 *
 * Returns the path FRACTION, not a point. An absolute point would be stale the
 * moment a node is dragged, leaving the pill stranded in open canvas while its
 * edge moved away.
 */
type LabelBox = { x: number; y: number; w: number; h: number };

const LABEL_H = 22;
const LABEL_MIN_W = 26;
const LABEL_GAP_PX = 4;
/** Midpoint first, then alternate outward along the path. */
const LABEL_T_CANDIDATES = [0.5, 0.4, 0.6, 0.32, 0.68, 0.25, 0.75, 0.18, 0.82];
/** A label parked on a corner floats off the rounded path the renderer draws. */
const MIN_BEND_CLEARANCE = EDGE_BORDER_RADIUS + LABEL_H / 2;

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w + LABEL_GAP_PX * 2 &&
    Math.abs(a.y - b.y) * 2 < a.h + b.h + LABEL_GAP_PX * 2
  );
}

export function resolveEdgeLabelPositions(
  nodes: LineageNode[],
  edges: LineageEdge[],
  direction: LayoutDirection
): Map<string, number> {
  const centers = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    centers.set(n.id, {
      x: n.position.x + NODE_WIDTH / 2,
      y: n.position.y + NODE_HEIGHT / 2
    });
  }

  const sourcePos = direction === "LR" ? POS_RIGHT : POS_BOTTOM;
  const targetPos = direction === "LR" ? POS_LEFT : POS_TOP;
  const placed: LabelBox[] = [];
  const resolved = new Map<string, number>();

  const candidates = edges
    .map((e) => {
      const s = centers.get(e.source);
      const t = centers.get(e.target);
      if (!s || !t) return null;
      const data = e.data as LineageEdgeData | undefined;
      const text = data?.labelText ?? String(data?.quantity ?? "");
      return {
        id: e.id,
        s,
        t,
        w: Math.max(LABEL_MIN_W, text.length * 6.2 + 20),
        midY: (s.y + t.y) / 2,
        midX: (s.x + t.x) / 2
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Deterministic order so the layout doesn't shuffle between runs.
  candidates.sort(
    (a, b) => a.midY - b.midY || a.midX - b.midX || (a.id < b.id ? -1 : 1)
  );

  for (const c of candidates) {
    const pointAt = (t: number) =>
      edgeLabelPoint(t, c.s.x, c.s.y, sourcePos, c.t.x, c.t.y, targetPos);

    let chosenT: number | null = null;
    for (const t of LABEL_T_CANDIDATES) {
      const p = pointAt(t);
      if (p.distanceToBend < MIN_BEND_CLEARANCE) continue;
      const box: LabelBox = { x: p.x, y: p.y, w: c.w, h: LABEL_H };
      if (!placed.some((q) => overlaps(box, q))) {
        chosenT = t;
        placed.push(box);
        break;
      }
    }
    // Every candidate collided — keep the midpoint rather than fling the label
    // somewhere it no longer reads as belonging to this edge.
    if (chosenT === null) {
      chosenT = 0.5;
      const p = pointAt(0.5);
      placed.push({ x: p.x, y: p.y, w: c.w, h: LABEL_H });
    }
    resolved.set(c.id, chosenT);
  }

  return resolved;
}

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
} {
  if (nodes.length === 0) {
    return { positioned: nodes, backEdges: new Set() };
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

  const footprints = new Map<string, { width: number; height: number }>();
  for (const n of nodes) {
    const footprint = nodeFootprint(n);
    footprints.set(n.id, footprint);
    g.setNode(n.id, footprint);
  }

  for (const e of edges) {
    if (backEdges.has(e.id)) continue;
    g.setEdge(e.source, e.target, {}, e.id);
  }

  Dagre.layout(g);

  // dagre centres the FOOTPRINT on (p.x, p.y), but `position` is the top-left
  // of the 44px circle — the label hangs below it, outside the box. So centre
  // the circle horizontally and pin it to the top of the footprint.
  const positioned = nodes.map((n) => {
    const p = g.node(n.id);
    if (!p) return n;
    const footprint = footprints.get(n.id) ?? {
      width: NODE_WIDTH,
      height: NODE_HEIGHT
    };
    return {
      ...n,
      position: {
        x: p.x - NODE_WIDTH / 2,
        y: p.y - footprint.height / 2
      },
      sourcePosition: direction === "LR" ? POS_RIGHT : POS_BOTTOM,
      targetPosition: direction === "LR" ? POS_LEFT : POS_TOP
    };
  });

  return { positioned, backEdges };
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
  const { positioned, backEdges } = computeDagreLayout(
    flow.nodes,
    weightedEdges,
    input.direction,
    input.spacing
  );
  const labelTs = resolveEdgeLabelPositions(
    positioned,
    weightedEdges,
    input.direction
  );
  const finalEdges: LineageEdge[] = [];
  for (let i = 0; i < weightedEdges.length; i++) {
    const e = weightedEdges[i];
    finalEdges.push({
      ...e,
      data: {
        ...(e.data as LineageEdgeData),
        isBackEdge: backEdges.has(e.id),
        labelT: labelTs.get(e.id)
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
