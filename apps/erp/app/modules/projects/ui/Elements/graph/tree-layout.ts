// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import Dagre from "@dagrejs/dagre";
import type {
  ProjectElementLinkType,
  ProjectElementType
} from "../../../projects.models";

export const CARD_WIDTH = 256;
export const CARD_HEIGHT = 100;
export const CARD_GAP = 8;
export const BOX_PADDING = 8;
export const BOX_HEADER_HEIGHT = 32;
/** The one-line note of a collapsed or lens-empty box. */
export const BOX_NOTE_HEIGHT = 36;
export const BOX_WIDTH = CARD_WIDTH + 2 * BOX_PADDING;

export type TreeElement = {
  id: string;
  parentId: string | null;
  type: ProjectElementType;
  name: string;
};

export type TreeBox = {
  /** "box:root" for the project, else "box:<ownerId>". */
  id: string;
  /** The element whose children the box holds; null for the project. */
  ownerId: string | null;
  /** The cards the lens shows, in input order. Empty when collapsed. */
  cardIds: string[];
  /** The descendants of a collapsed owner that match the lens, else null. */
  collapsedCount: number | null;
  /** The children in this box that the lens hides. */
  hiddenCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TreeCard = {
  id: string;
  boxId: string;
  /** Relative to the box. */
  x: number;
  y: number;
  /** The descendants that match the lens. A card with 0 has no box. */
  descendantCount: number;
  isCollapsed: boolean;
};

export type TreeEdge = {
  id: string;
  source: string;
  sourceHandle: "children" | "out";
  target: string;
};

export type ElementTreeLayout = {
  /** The root in use: null when `rootId` was null or unknown. */
  rootId: string | null;
  boxes: TreeBox[];
  cards: TreeCard[];
  edges: TreeEdge[];
};

export type TraceLink = {
  id: string;
  fromElementId: string;
  toElementId: string;
  linkType: ProjectElementLinkType;
};

export type TraceHighlight = {
  elementId: string;
  linkType: "verifies" | "satisfies";
};

const boxIdOf = (ownerId: string) => `box:${ownerId}`;

/**
 * Lays out the Tree layout of the Elements page: one box per parent holds
 * its children as cards, and dagre places the boxes left to right. Cards
 * stack in their box at fixed offsets.
 *
 * `type` is a lens: a card of another type is hidden, but its box stays
 * while a card below it matches. With `rootId`, the top box holds the
 * root's children; else it holds the root-level elements and every element
 * whose parent is not in the list.
 */
export function layoutElementTree(input: {
  elements: readonly TreeElement[];
  rootId: string | null;
  collapsed: ReadonlySet<string>;
  type: ProjectElementType | null;
}): ElementTreeLayout {
  const { elements, collapsed, type } = input;

  const byId = new Map(elements.map((element) => [element.id, element]));
  const children = new Map<string, string[]>();
  const topLevel: string[] = [];
  for (const element of elements) {
    if (element.parentId && byId.has(element.parentId)) {
      const siblings = children.get(element.parentId);
      if (siblings) siblings.push(element.id);
      else children.set(element.parentId, [element.id]);
    } else {
      topLevel.push(element.id);
    }
  }

  const rootId = input.rootId && byId.has(input.rootId) ? input.rootId : null;

  const matches = (id: string) => type === null || byId.get(id)?.type === type;

  const descendantMemo = new Map<string, number>();
  const inProgress = new Set<string>();
  const matchingDescendants = (id: string): number => {
    const memo = descendantMemo.get(id);
    if (memo !== undefined) return memo;
    // A bad parentId cycle counts nothing past the repeat.
    if (inProgress.has(id)) return 0;
    inProgress.add(id);
    let count = 0;
    for (const child of children.get(id) ?? []) {
      if (matches(child)) count += 1;
      count += matchingDescendants(child);
    }
    inProgress.delete(id);
    descendantMemo.set(id, count);
    return count;
  };

  const boxes: TreeBox[] = [];
  const cards: TreeCard[] = [];
  const edges: TreeEdge[] = [];
  const boxEdges: { source: string; target: string }[] = [];
  const visited = new Set<string>();

  const newBox = (id: string, ownerId: string | null): TreeBox => {
    const box: TreeBox = {
      id,
      ownerId,
      cardIds: [],
      collapsedCount: null,
      hiddenCount: 0,
      x: 0,
      y: 0,
      width: BOX_WIDTH,
      height: 0
    };
    boxes.push(box);
    return box;
  };

  const fillBox = (box: TreeBox, childIds: readonly string[]) => {
    for (const id of childIds) {
      if (matches(id)) {
        const index = box.cardIds.length;
        box.cardIds.push(id);
        cards.push({
          id,
          boxId: box.id,
          x: BOX_PADDING,
          y: BOX_HEADER_HEIGHT + BOX_PADDING + index * (CARD_HEIGHT + CARD_GAP),
          descendantCount: matchingDescendants(id),
          isCollapsed: collapsed.has(id)
        });
      } else {
        box.hiddenCount += 1;
      }
    }

    for (const child of childIds) {
      if (matchingDescendants(child) === 0) continue;
      const childBoxId = boxIdOf(child);
      if (visited.has(childBoxId)) continue;
      visited.add(childBoxId);

      const childBox = newBox(childBoxId, child);
      boxEdges.push({ source: box.id, target: childBoxId });
      edges.push(
        matches(child)
          ? {
              id: `tree:${childBoxId}`,
              source: child,
              sourceHandle: "children",
              target: childBoxId
            }
          : {
              id: `tree:${childBoxId}`,
              source: box.id,
              sourceHandle: "out",
              target: childBoxId
            }
      );

      if (collapsed.has(child)) {
        childBox.collapsedCount = matchingDescendants(child);
      } else {
        fillBox(childBox, children.get(child) ?? []);
      }
    }
  };

  const topBox = rootId
    ? newBox(boxIdOf(rootId), rootId)
    : newBox("box:root", null);
  visited.add(topBox.id);
  fillBox(topBox, rootId ? (children.get(rootId) ?? []) : topLevel);

  for (const box of boxes) {
    const n = box.cardIds.length;
    box.height =
      n > 0
        ? BOX_HEADER_HEIGHT +
          2 * BOX_PADDING +
          n * CARD_HEIGHT +
          (n - 1) * CARD_GAP
        : BOX_HEADER_HEIGHT + 2 * BOX_PADDING + BOX_NOTE_HEIGHT;
  }

  const graph = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    nodesep: 32,
    ranksep: 96,
    marginx: 24,
    marginy: 24
  });
  for (const box of boxes) {
    graph.setNode(box.id, { width: box.width, height: box.height });
  }
  for (const edge of boxEdges) graph.setEdge(edge.source, edge.target);
  Dagre.layout(graph);
  for (const box of boxes) {
    const node = graph.node(box.id);
    box.x = node.x - box.width / 2;
    box.y = node.y - box.height / 2;
  }

  return { rootId, boxes, cards, edges };
}

/**
 * The breadcrumb path of a root: its ancestors from the top down, then the
 * root. Empty when `rootId` is null or unknown.
 */
export function elementTreePath(
  elements: readonly TreeElement[],
  rootId: string | null
): TreeElement[] {
  if (!rootId) return [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  const path: TreeElement[] = [];
  const seen = new Set<string>();
  let current = byId.get(rootId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/**
 * The trace link counts a card shows: `tests` is the `verifies` links into
 * an element, `reqs` is the `satisfies` links out of it.
 */
export function countTraceLinks(
  links: readonly TraceLink[]
): Map<string, { tests: number; reqs: number }> {
  const counts = new Map<string, { tests: number; reqs: number }>();
  const entry = (id: string) => {
    let count = counts.get(id);
    if (!count) {
      count = { tests: 0, reqs: 0 };
      counts.set(id, count);
    }
    return count;
  };
  for (const link of links) {
    if (link.linkType === "verifies") entry(link.toElementId).tests += 1;
    else if (link.linkType === "satisfies") entry(link.fromElementId).reqs += 1;
  }
  return counts;
}

/**
 * The links and elements a "N tests" or "N reqs" click lights up: the
 * `verifies` links into a Requirement and their tests, or the `satisfies`
 * links out of a System or Function and their requirements.
 */
export function highlightTraceLinks(
  links: readonly TraceLink[],
  highlight: TraceHighlight
): { linkIds: Set<string>; elementIds: Set<string> } {
  const linkIds = new Set<string>();
  const elementIds = new Set<string>([highlight.elementId]);
  for (const link of links) {
    if (link.linkType !== highlight.linkType) continue;
    if (
      highlight.linkType === "verifies" &&
      link.toElementId === highlight.elementId
    ) {
      linkIds.add(link.id);
      elementIds.add(link.fromElementId);
    } else if (
      highlight.linkType === "satisfies" &&
      link.fromElementId === highlight.elementId
    ) {
      linkIds.add(link.id);
      elementIds.add(link.toElementId);
    }
  }
  return { linkIds, elementIds };
}
