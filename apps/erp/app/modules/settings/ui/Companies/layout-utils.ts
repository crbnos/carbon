// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import Dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
) {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 100,
    edgesep: 30,
    marginx: 40,
    marginy: 40
  });

  nodes.forEach((node) => {
    const isElimination = (node.data as { isEliminationEntity?: boolean })
      .isEliminationEntity;
    g.setNode(node.id, {
      width: isElimination ? 160 : 200,
      height: 60
    });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  Dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    const isElimination = (node.data as { isEliminationEntity?: boolean })
      .isEliminationEntity;
    const width = isElimination ? 160 : 200;
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - 30
      }
    };
  });

  return { nodes: layoutedNodes, edges };
}
