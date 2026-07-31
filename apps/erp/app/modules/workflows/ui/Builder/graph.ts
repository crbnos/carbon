import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeType
} from "@carbon/workflows";
import { CURRENT_DEFINITION_FORMAT_VERSION } from "@carbon/workflows";
import { nanoid } from "nanoid";
import type { BuilderEdge, BuilderNode } from "../../types";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 180;
const GAP_X = 40;
const GAP_Y = 80;

export const TRIGGER_POSITION = { x: 0, y: 0 };

export function toBuilderNode(node: WorkflowNode): BuilderNode {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    ...(node.title !== undefined ? { title: node.title } : {}),
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
          ...(node.title !== undefined ? { title: node.title } : {}),
          type: node.type,
          position: { x: node.position.x, y: node.position.y },
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
  return { id, type, position: { x: 0, y: 0 }, data } as WorkflowNode;
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

export function createNode(
  type: WorkflowNodeType,
  position: { x: number; y: number }
): WorkflowNode {
  const id = nanoid();

  switch (type) {
    case "trigger":
      return { id, type, position, data: { events: [], origin: "Both" } };
    case "condition":
      // A condition's output handles ARE its paths — seeding two keeps it wireable.
      return {
        id,
        type,
        position,
        data: {
          paths: [
            { id: nanoid(), kind: "if", combinator: "and", clauses: [] },
            { id: nanoid(), kind: "else", combinator: "and", clauses: [] }
          ]
        }
      };
    case "entity":
      return { id, type, position, data: { operation: "", inputs: {} } };
    case "lookup":
      return {
        id,
        type,
        position,
        data: { entity: "", returns: "one", match: [] }
      };
    case "filter":
      return { id, type, position, data: { combinator: "and", clauses: [] } };
    case "action":
      return {
        id,
        type,
        position,
        data: { action: "", inputs: {}, batch: false }
      };
  }
}

// Below `from` (or below the lowest node), nudged right until nothing collides.
export function nextNodePosition(
  nodes: BuilderNode[],
  from: BuilderNode | undefined
): { x: number; y: number } {
  const anchor =
    from ??
    nodes.reduce<BuilderNode | undefined>(
      (lowest, node) =>
        !lowest || node.position.y > lowest.position.y ? node : lowest,
      undefined
    );

  const start = anchor
    ? { x: anchor.position.x, y: anchor.position.y + NODE_HEIGHT + GAP_Y }
    : { ...TRIGGER_POSITION };

  const collides = (candidate: { x: number; y: number }) =>
    nodes.some(
      (node) =>
        Math.abs(node.position.x - candidate.x) < NODE_WIDTH &&
        Math.abs(node.position.y - candidate.y) < NODE_HEIGHT
    );

  const position = { ...start };
  while (collides(position)) {
    position.x += NODE_WIDTH + GAP_X;
  }

  return position;
}
