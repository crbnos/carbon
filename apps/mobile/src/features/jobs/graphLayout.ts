// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JobOperationSummary } from "@carbon/mes-core";

/**
 * Where each operation sits in the job graph, and the edges between them.
 *
 * Web lays this out with Dagre inside React Flow. Neither crosses over —
 * React Flow is DOM-only and adding Dagre would be a production dependency —
 * so the layering is done here, in pure code, against the same constants web
 * gives Dagre (200×90 nodes, 120 between ranks, 80 between siblings). A job
 * graph is a modest DAG laid out left to right, which is the one case where
 * a layered assignment and a general-purpose layout engine agree.
 *
 * What this does NOT do, and Dagre does: minimise edge crossings by
 * reordering within a rank. Operations are ordered inside their column by
 * `order` and then id, which keeps the result stable and readable; a job
 * with heavy fan-out will cross a few lines a full sweep would untangle.
 */

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 90;
const RANK_GAP = 120;
const SIBLING_GAP = 80;
const MARGIN = 40;

export type Dependency = { operationId: string; dependsOnId: string };

export type GraphNode = {
  operation: JobOperationSummary;
  /** Top-left, in graph space. */
  x: number;
  y: number;
};

export type GraphEdge = {
  from: string;
  to: string;
  /** Centre of the right edge of the source node. */
  x1: number;
  y1: number;
  /** Centre of the left edge of the target node. */
  x2: number;
  y2: number;
};

export type JobGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
};

/**
 * The rank of each operation: how many steps of work must finish first.
 *
 * Longest path rather than shortest, because an operation must sit to the
 * right of EVERY prerequisite — taking the shortest would draw an edge
 * backwards whenever one branch is longer than another.
 *
 * Iterative with a bound rather than recursive, so a CYCLE settles instead
 * of overflowing the stack. The bound is the node count: a longest path in
 * an acyclic graph cannot exceed it, so an honest graph always converges
 * before the limit and a cyclic one simply stops.
 */
function rankOf(
  operations: JobOperationSummary[],
  dependencies: Dependency[]
): Map<string, number> {
  const ids = new Set(operations.map((operation) => operation.id));
  const edges = dependencies.filter(
    (edge) => ids.has(edge.operationId) && ids.has(edge.dependsOnId)
  );

  const rank = new Map<string, number>();
  for (const id of ids) rank.set(id, 0);

  for (let pass = 0; pass < operations.length; pass++) {
    let moved = false;
    for (const edge of edges) {
      const after = (rank.get(edge.dependsOnId) ?? 0) + 1;
      if (after > (rank.get(edge.operationId) ?? 0)) {
        rank.set(edge.operationId, after);
        moved = true;
      }
    }
    if (!moved) break;
  }

  return rank;
}

/** The graph, in its own coordinate space with the origin at the top left. */
export function layoutJobGraph(
  operations: JobOperationSummary[],
  dependencies: Dependency[]
): JobGraph {
  if (operations.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const rank = rankOf(operations, dependencies);

  const columns = new Map<number, JobOperationSummary[]>();
  for (const operation of operations) {
    const column = rank.get(operation.id) ?? 0;
    const list = columns.get(column) ?? [];
    list.push(operation);
    columns.set(column, list);
  }

  const placed = new Map<string, GraphNode>();
  let height = 0;

  for (const [column, members] of columns) {
    // Stable within a column, so the graph does not reshuffle between
    // renders of the same job.
    members.sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)
    );
    members.forEach((operation, index) => {
      const node = {
        operation,
        x: MARGIN + column * (NODE_WIDTH + RANK_GAP),
        y: MARGIN + index * (NODE_HEIGHT + SIBLING_GAP)
      };
      placed.set(operation.id, node);
      height = Math.max(height, node.y + NODE_HEIGHT + MARGIN);
    });
  }

  const nodes = [...placed.values()];
  const width = Math.max(...nodes.map((node) => node.x + NODE_WIDTH)) + MARGIN;

  const edges: GraphEdge[] = [];
  for (const edge of dependencies) {
    const from = placed.get(edge.dependsOnId);
    const to = placed.get(edge.operationId);
    // An edge naming an operation outside this job is dropped rather than
    // drawn to nowhere.
    if (!from || !to) continue;
    edges.push({
      from: edge.dependsOnId,
      to: edge.operationId,
      x1: from.x + NODE_WIDTH,
      y1: from.y + NODE_HEIGHT / 2,
      x2: to.x,
      y2: to.y + NODE_HEIGHT / 2
    });
  }

  return { nodes, edges, width, height };
}

/**
 * The scale that fits the whole graph in a viewport, and the offset that
 * centres it.
 *
 * Capped at 1: a two-operation job blown up to fill an iPad looks broken,
 * and the nodes are designed at their natural size. There is no lower cap —
 * a long job starts fully zoomed out, which is the view that tells an
 * operator what shape the job is before they go looking for their part of
 * it.
 */
export function fitTransform(
  graph: { width: number; height: number },
  viewport: { width: number; height: number }
) {
  if (
    graph.width <= 0 ||
    graph.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return { scale: 1, x: 0, y: 0 };
  }

  const scale = Math.min(
    1,
    viewport.width / graph.width,
    viewport.height / graph.height
  );

  return {
    scale,
    x: (viewport.width - graph.width * scale) / 2,
    y: (viewport.height - graph.height * scale) / 2
  };
}
