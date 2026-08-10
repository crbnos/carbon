import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeType
} from "@carbon/workflows";
import {
  CURRENT_DEFINITION_FORMAT_VERSION,
  nextNodeName
} from "@carbon/workflows";
import { nanoid } from "nanoid";
import type { BuilderEdge, BuilderNode } from "../../types";
import { MAX_NODE_CARD_WIDTH, NODE_ACCEPTS_INCOMING } from "./nodes/kinds";

const NODE_WIDTH = MAX_NODE_CARD_WIDTH;
const NODE_HEIGHT = 180;
const GAP_X = 40;
const GAP_Y = 80;

export const TRIGGER_POSITION = { x: 0, y: 0 };

export function toBuilderNode(node: WorkflowNode): BuilderNode {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    name: node.name,
    expanded: node.expanded ?? true,
    data: node.data as Record<string, unknown>
  };
}

export function toReactFlow(definition: WorkflowDefinition): {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
} {
  return {
    nodes: definition.nodes.map(toBuilderNode),
    edges: definition.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle
    }))
  };
}

// Strips React Flow's runtime fields (selected, dragging, measured, width, ...)
// and keeps only what the shared definition schema accepts.
export function fromReactFlow(
  nodes: BuilderNode[],
  edges: BuilderEdge[]
): WorkflowDefinition {
  return {
    formatVersion: CURRENT_DEFINITION_FORMAT_VERSION,
    nodes: nodes.map(
      (node) =>
        ({
          id: node.id,
          name: node.name,
          type: node.type,
          position: { x: node.position.x, y: node.position.y },
          expanded: node.expanded ?? true,
          data: node.data
        }) as WorkflowNode
    ),
    edges: edges
      .filter((edge) => typeof edge.sourceHandle === "string")
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle as string,
        target: edge.target,
        targetHandle: edge.targetHandle ?? "in"
      }))
  };
}

// Position is zeroed: every caller wants this only to read handles/config off the
// node, never to place it.
export function asWorkflowNode(
  id: string,
  type: WorkflowNode["type"],
  data: unknown
): WorkflowNode {
  return { id, name: id, type, position: { x: 0, y: 0 }, data } as WorkflowNode;
}

export function wouldCreateCycle(
  edges: BuilderEdge[],
  source: string,
  target: string
): boolean {
  if (source === target) return true;

  const seen = new Set<string>();
  const stack = [target];

  while (stack.length) {
    const current = stack.pop() as string;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges) {
      if (edge.source === current) stack.push(edge.target);
    }
  }

  return false;
}

/**
 * Every rule that decides whether an edge may exist, in one place. The drag-time
 * check, the drop handler, and the compatible-target highlight all call this, so a
 * node cannot read as a valid target and then refuse the drop.
 */
export function canConnect(
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  connection: {
    source: string | null;
    sourceHandle: string | null;
    target: string | null;
  }
): boolean {
  const { source, sourceHandle, target } = connection;
  if (!source || !target) return false;

  const targetNode = nodes.find((node) => node.id === target);
  if (!targetNode || !nodes.some((node) => node.id === source)) return false;
  if (!NODE_ACCEPTS_INCOMING[targetNode.type]) return false;

  // The target handle is deliberately ignored: there is only one, id "in".
  const duplicate = edges.some(
    (edge) =>
      edge.source === source &&
      edge.sourceHandle === sourceHandle &&
      edge.target === target
  );
  if (duplicate) return false;

  return !wouldCreateCycle(edges, source, target);
}

export function createNode(
  type: WorkflowNodeType,
  position: { x: number; y: number },
  takenNames: Iterable<string> = []
): WorkflowNode {
  const id = nanoid();
  const name = nextNodeName(type, takenNames);

  switch (type) {
    case "trigger":
      return {
        id,
        name,
        type,
        position,
        expanded: true,
        data: { events: [], origin: "Person" }
      };
    case "condition":
      // A condition's output handles ARE its paths — seeding two keeps it wireable.
      return {
        id,
        name,
        type,
        position,
        expanded: true,
        data: {
          paths: [
            { id: nanoid(), kind: "if", combinator: "and", clauses: [] },
            { id: nanoid(), kind: "else", combinator: "and", clauses: [] }
          ]
        }
      };
    case "entity":
      return {
        id,
        name,
        type,
        position,
        expanded: true,
        data: { operation: "", inputs: {} }
      };
    case "lookup":
      return {
        id,
        name,
        type,
        position,
        expanded: true,
        data: { entity: "", returns: "one", match: [] }
      };
    case "filter":
      return {
        id,
        name,
        type,
        position,
        expanded: true,
        data: { combinator: "and", clauses: [] }
      };
    case "action":
      return {
        id,
        name,
        type,
        position,
        expanded: true,
        data: { action: "", inputs: {} }
      };
  }
}

// To the right of `from` (or to the right of the rightmost node), nudged down
// until nothing collides.
export function nextNodePosition(
  nodes: BuilderNode[],
  from: BuilderNode | undefined
): { x: number; y: number } {
  const anchor =
    from ??
    nodes.reduce<BuilderNode | undefined>(
      (rightmost, node) =>
        !rightmost || node.position.x > rightmost.position.x ? node : rightmost,
      undefined
    );

  const start = anchor
    ? { x: anchor.position.x + NODE_WIDTH + GAP_X, y: anchor.position.y }
    : { ...TRIGGER_POSITION };

  const collides = (candidate: { x: number; y: number }) =>
    nodes.some(
      (node) =>
        Math.abs(node.position.x - candidate.x) < NODE_WIDTH &&
        Math.abs(node.position.y - candidate.y) < NODE_HEIGHT
    );

  const position = { ...start };
  while (collides(position)) {
    position.y += NODE_HEIGHT + GAP_Y;
  }

  return position;
}
