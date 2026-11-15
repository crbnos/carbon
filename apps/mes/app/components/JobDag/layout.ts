// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import Dagre from "@dagrejs/dagre";

export type LayoutDirection = "Winding" | "LR" | "TB";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 90;
const COLUMN_GAP = 96;
const NODE_GAP = 56;
const ROW_GAP = 120;
const MARGIN = 40;

type Dependency = { operationId: string; dependsOnId: string };

export type OperationPosition = {
  x: number;
  y: number;
  row: number;
};

export function layoutOperations(
  operationIds: string[],
  dependencies: Dependency[],
  direction: LayoutDirection,
  width: number,
  compact: boolean
): Map<string, OperationPosition> {
  const graph = new Dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction === "TB" ? "TB" : "LR",
    nodesep: compact ? 24 : 80,
    ranksep: compact ? 56 : 120,
    edgesep: 30,
    marginx: MARGIN,
    marginy: MARGIN
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const id of operationIds) {
    graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const dependency of dependencies) {
    graph.setEdge(dependency.dependsOnId, dependency.operationId);
  }
  Dagre.layout(graph);

  if (direction !== "Winding") {
    return new Map(
      operationIds.map((id) => {
        const position = graph.node(id);
        return [
          id,
          {
            x: position.x - NODE_WIDTH / 2,
            y: position.y - NODE_HEIGHT / 2,
            row: 0
          }
        ];
      })
    );
  }

  // Dagre gives dependent operations successive x ranks. Fold those ranks into
  // rows while keeping operations at the same rank together.
  const ranks = new Map<number, string[]>();
  for (const id of operationIds) {
    const x = Math.round(graph.node(id).x);
    const rank = ranks.get(x) ?? [];
    rank.push(id);
    ranks.set(x, rank);
  }
  const orderedRanks = [...ranks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, ids]) => ids.sort((a, b) => graph.node(a).y - graph.node(b).y));

  const columns = Math.max(
    1,
    Math.floor((width - 2 * MARGIN + COLUMN_GAP) / (NODE_WIDTH + COLUMN_GAP))
  );
  const positions = new Map<string, OperationPosition>();
  let rowTop = MARGIN;

  for (let start = 0; start < orderedRanks.length; start += columns) {
    const row = Math.floor(start / columns);
    const rowRanks = orderedRanks.slice(start, start + columns);
    const rowHeight = Math.max(
      ...rowRanks.map(
        (rank) => rank.length * NODE_HEIGHT + (rank.length - 1) * NODE_GAP
      )
    );

    rowRanks.forEach((rank, index) => {
      const column = row % 2 === 0 ? index : columns - index - 1;
      const stackHeight =
        rank.length * NODE_HEIGHT + (rank.length - 1) * NODE_GAP;
      rank.forEach((id, stackIndex) => {
        positions.set(id, {
          x: MARGIN + column * (NODE_WIDTH + COLUMN_GAP),
          y:
            rowTop +
            (rowHeight - stackHeight) / 2 +
            stackIndex * (NODE_HEIGHT + NODE_GAP),
          row
        });
      });
    });
    rowTop += rowHeight + ROW_GAP;
  }

  return positions;
}

export function dependencyHandles(
  source: OperationPosition,
  target: OperationPosition,
  direction: LayoutDirection
) {
  const vertical =
    direction === "TB" ||
    (direction === "Winding" && source.row !== target.row);
  const rightward = direction === "LR" || source.row % 2 === 0;
  return {
    sourceHandle: vertical
      ? "source-bottom"
      : rightward
        ? "source-right"
        : "source-left",
    targetHandle: vertical
      ? "target-top"
      : rightward
        ? "target-left"
        : "target-right",
    vertical
  };
}
