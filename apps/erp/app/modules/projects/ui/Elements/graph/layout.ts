// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import Dagre from "@dagrejs/dagre";
import type { GraphDirection } from "./store";

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 76;

/**
 * Places the elements with dagre, synchronously, at a fixed node size. Only
 * the parent links set the ranks, so the tree reads in `direction`; the trace
 * links are drawn on top of it.
 */
export function layoutElementGraph(
  ids: string[],
  parentEdges: { source: string; target: string }[],
  direction: GraphDirection
): Map<string, { x: number; y: number }> {
  const graph = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: direction === "LR" ? 24 : 40,
    ranksep: direction === "LR" ? 80 : 64,
    marginx: 24,
    marginy: 24
  });
  for (const id of ids) {
    graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of parentEdges) graph.setEdge(edge.source, edge.target);
  Dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const node = graph.node(id);
    positions.set(id, {
      x: node.x - NODE_WIDTH / 2,
      y: node.y - NODE_HEIGHT / 2
    });
  }
  return positions;
}
