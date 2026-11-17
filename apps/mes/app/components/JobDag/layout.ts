// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import Dagre from "@dagrejs/dagre";
import {
  getViewportForBounds,
  Position,
  type Rect,
  type Viewport
} from "@xyflow/react";

export type LayoutDirection = "Winding" | "LR" | "TB";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;

const NODE_WIDTH = 200;
const NODE_HEIGHT = 90;
const MARGIN = 40;
// Pane width kept clear on the two sides of a winding graph, in total.
const VIEW_INSET = 32;
const FIT_PADDING = 0.1;

type Dependency = { operationId: string; dependsOnId: string };
type Point = { x: number; y: number };
type Pane = { width: number; height: number };

export type OperationPosition = Point & {
  sourcePosition: Position;
  targetPosition: Position;
};

// A detour through the gaps between nodes: leave the source sideways to
// `exitX`, run along `laneY`, and reach the target sideways from `entryX`.
export type EdgeRoute = { exitX: number; laneY: number; entryX: number };

export type JobLayout = {
  positions: Map<string, OperationPosition>;
  // Only the dependencies that cannot run straight to a neighbour.
  routes: Map<string, EdgeRoute>;
  bounds: Rect;
};

export function dependencyId(dependency: Dependency) {
  return `${dependency.dependsOnId}-${dependency.operationId}`;
}

function windingGaps(compact: boolean) {
  return compact
    ? { column: 56, node: 24, row: 72 }
    : { column: 96, node: 56, row: 120 };
}

export function windingColumns(width: number, compact: boolean) {
  const { column } = windingGaps(compact);
  return Math.max(1, Math.floor((width - VIEW_INSET) / (NODE_WIDTH + column)));
}

// A winding graph one column wide is the top-to-bottom graph with longer
// edges, so it is drawn (and offered) as top to bottom.
export function effectiveDirection(
  chosen: LayoutDirection,
  columns: number
): LayoutDirection {
  return chosen === "Winding" && columns < 2 ? "TB" : chosen;
}

function nodeBounds(positions: Iterable<Point>): Rect {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const position of positions) {
    left = Math.min(left, position.x);
    top = Math.min(top, position.y);
    right = Math.max(right, position.x + NODE_WIDTH);
    bottom = Math.max(bottom, position.y + NODE_HEIGHT);
  }
  if (left > right) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function layoutOperations(
  operationIds: string[],
  dependencies: Dependency[],
  direction: LayoutDirection,
  columns: number,
  compact: boolean
): JobLayout {
  // The two reads can disagree for a moment; a dependency on an operation
  // that is not in the job has nothing to connect.
  const known = new Set(operationIds);
  const edges = dependencies.filter(
    (dependency) =>
      known.has(dependency.dependsOnId) && known.has(dependency.operationId)
  );

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
  for (const dependency of edges) {
    graph.setEdge(dependency.dependsOnId, dependency.operationId);
  }
  Dagre.layout(graph);

  const positions = new Map<string, OperationPosition>();
  const routes = new Map<string, EdgeRoute>();

  if (direction !== "Winding") {
    const horizontal = direction === "LR";
    for (const id of operationIds) {
      const position = graph.node(id);
      positions.set(id, {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
        sourcePosition: horizontal ? Position.Right : Position.Bottom,
        targetPosition: horizontal ? Position.Left : Position.Top
      });
    }
    return { positions, routes, bounds: nodeBounds(positions.values()) };
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

  const gaps = windingGaps(compact);
  const cells = new Map<
    string,
    {
      row: number;
      column: number;
      forward: boolean;
      laneAbove: number;
      laneBelow: number;
    }
  >();
  let rowTop = MARGIN;

  for (let start = 0; start < orderedRanks.length; start += columns) {
    const row = Math.floor(start / columns);
    // Every second row runs right to left.
    const forward = row % 2 === 0;
    const rowRanks = orderedRanks.slice(start, start + columns);
    const rowHeight = Math.max(
      ...rowRanks.map(
        (rank) => rank.length * NODE_HEIGHT + (rank.length - 1) * gaps.node
      )
    );

    rowRanks.forEach((rank, index) => {
      const column = forward ? index : columns - index - 1;
      const stackHeight =
        rank.length * NODE_HEIGHT + (rank.length - 1) * gaps.node;
      rank.forEach((id, stackIndex) => {
        positions.set(id, {
          x: MARGIN + column * (NODE_WIDTH + gaps.column),
          y:
            rowTop +
            (rowHeight - stackHeight) / 2 +
            stackIndex * (NODE_HEIGHT + gaps.node),
          sourcePosition: forward ? Position.Right : Position.Left,
          targetPosition: forward ? Position.Left : Position.Right
        });
        cells.set(id, {
          row,
          column,
          forward,
          laneAbove: rowTop - gaps.row / 2,
          laneBelow: rowTop + rowHeight + gaps.row / 2
        });
      });
    });
    rowTop += rowHeight + gaps.row;
  }

  // An edge to the next column of the same row runs straight across the gap.
  // Every other edge would cross the nodes between its ends, so it travels in
  // the gaps: down the column gap beside the source, along a row gap, and
  // into the target from the column gap beside it.
  const sideLane = gaps.column / 2;
  let lowestLane = Number.NEGATIVE_INFINITY;
  for (const dependency of edges) {
    const source = cells.get(dependency.dependsOnId)!;
    const target = cells.get(dependency.operationId)!;
    const sameRow = source.row === target.row;
    if (sameRow && target.column === source.column + (source.forward ? 1 : -1))
      continue;

    const route = {
      exitX:
        positions.get(dependency.dependsOnId)!.x +
        (source.forward ? NODE_WIDTH + sideLane : -sideLane),
      laneY: sameRow ? source.laneBelow : target.laneAbove,
      entryX:
        positions.get(dependency.operationId)!.x +
        (target.forward ? -sideLane : NODE_WIDTH + sideLane)
    };
    routes.set(dependencyId(dependency), route);
    lowestLane = Math.max(lowestLane, route.laneY);
  }

  // The side lanes sit outside the first and last columns.
  const nodes = nodeBounds(positions.values());
  const bounds = nodes.width
    ? {
        x: nodes.x - sideLane,
        y: nodes.y,
        width: nodes.width + 2 * sideLane,
        height: Math.max(nodes.height, lowestLane - nodes.y)
      }
    : nodes;

  return { positions, routes, bounds };
}

// The SVG path of a routed edge between its two measured handle points, with
// rounded corners.
export function routePath(
  source: Point,
  target: Point,
  route: EdgeRoute,
  radius = 16
) {
  const corners: Point[] = [
    source,
    { x: route.exitX, y: source.y },
    { x: route.exitX, y: route.laneY },
    { x: route.entryX, y: route.laneY },
    { x: route.entryX, y: target.y },
    target
  ];

  // A turn back on the same side lane has no run along the row gap: drop the
  // points that repeat or lie on a straight line.
  const points: Point[] = [];
  for (const point of corners) {
    const last = points.at(-1);
    if (last && last.x === point.x && last.y === point.y) continue;
    const previous = points.at(-2);
    if (
      previous &&
      last &&
      ((previous.x === last.x && last.x === point.x) ||
        (previous.y === last.y && last.y === point.y))
    ) {
      points.pop();
    }
    points.push(point);
  }

  const towards = (from: Point, to: Point, distance: number) => {
    const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    return {
      x: from.x + ((to.x - from.x) / length) * distance,
      y: from.y + ((to.y - from.y) / length) * distance
    };
  };

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1];
    const corner = points[index];
    const after = points[index + 1];
    const bend = Math.min(
      radius,
      (Math.abs(corner.x - before.x) + Math.abs(corner.y - before.y)) / 2,
      (Math.abs(after.x - corner.x) + Math.abs(after.y - corner.y)) / 2
    );
    const start = towards(corner, before, bend);
    const end = towards(corner, after, bend);
    path += ` L ${start.x} ${start.y} Q ${corner.x} ${corner.y} ${end.x} ${end.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

// The whole graph in the pane, no smaller than `minZoom`.
export function fitViewport(
  bounds: Rect,
  pane: Pane,
  minZoom: number
): Viewport {
  return getViewportForBounds(
    bounds,
    pane.width,
    pane.height,
    minZoom,
    MAX_ZOOM,
    FIT_PADDING
  );
}

// Where the graph opens. A winding graph taller than the pane starts at its
// first row at reading size instead of centering its full height at tiny zoom.
export function openingViewport(
  bounds: Rect,
  pane: Pane,
  direction: LayoutDirection,
  minZoom: number
): Viewport {
  if (direction !== "Winding" || bounds.height + 2 * MARGIN <= pane.height) {
    return fitViewport(bounds, pane, minZoom);
  }
  const zoom = Math.min(
    1,
    Math.max(0.6, (pane.width - VIEW_INSET) / bounds.width)
  );
  return {
    x: (pane.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: 24 - bounds.y * zoom,
    zoom
  };
}
