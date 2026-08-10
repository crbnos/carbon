import Dagre from "@dagrejs/dagre";
import type { BuilderEdge, BuilderNode } from "../../types";
import {
  COLLAPSED_NODE_CARD_HEIGHT,
  MAX_NODE_CARD_WIDTH,
  NODE_CARD_HEIGHT,
  NODE_CARD_WIDTH
} from "./nodes/kinds";

// Cards run wide, so ranks need more room between them than the usual defaults.
const RANK_SEP = 140;
const NODE_SEP = 48;

function sizeOf(node: BuilderNode) {
  const kind = node.type;
  const width =
    node.measured?.width ??
    (kind ? NODE_CARD_WIDTH[kind] : MAX_NODE_CARD_WIDTH);

  // A collapsed card is one fixed height whatever it last measured. Expanded, the
  // measurement is the truth — the per-kind number is only a guess for a card that
  // has never been on screen.
  if (node.expanded === false) {
    return { width, height: COLLAPSED_NODE_CARD_HEIGHT };
  }
  const estimate = kind ? NODE_CARD_HEIGHT[kind] : COLLAPSED_NODE_CARD_HEIGHT;
  return { width, height: node.measured?.height ?? estimate };
}

/**
 * Left-to-right layered layout, returned as `{ nodeId: position }`.
 *
 * Cycles are safe: dagre finds the edges that point backwards, flips them so the
 * graph is temporarily loop-free, ranks it, then flips them back. A loop lays out
 * as an edge running right-to-left across the columns instead of stalling layout.
 */
export function layoutPositions(
  nodes: BuilderNode[],
  edges: BuilderEdge[]
): Record<string, { x: number; y: number }> {
  const graph = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    edgesep: 24,
    marginx: 40,
    marginy: 40
  });

  const sizes = new Map(nodes.map((node) => [node.id, sizeOf(node)]));
  for (const node of nodes) graph.setNode(node.id, { ...sizes.get(node.id)! });

  // Parallel edges (a condition with two paths into the same step) collapse into
  // one — dagre only needs to know the columns are adjacent.
  for (const edge of edges) {
    if (!sizes.has(edge.source) || !sizes.has(edge.target)) continue;
    graph.setEdge(edge.source, edge.target);
  }

  Dagre.layout(graph);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    const laid = graph.node(node.id);
    if (!laid) continue;
    const { width, height } = sizes.get(node.id)!;
    // Dagre reports centers; React Flow positions from the top-left corner.
    positions[node.id] = {
      x: Math.round(laid.x - width / 2),
      y: Math.round(laid.y - height / 2)
    };
  }

  return positions;
}
