import {
  DEFAULT_HANDLE,
  type TriggerNode,
  type WorkflowDefinition
} from "@carbon/workflows";

export const MAX_NODE_EXECUTIONS = 500;

export function findTriggerNode(
  definition: WorkflowDefinition
): TriggerNode | undefined {
  return definition.nodes.find(
    (node): node is TriggerNode => node.type === "trigger"
  );
}

/** The trigger the caller named, else the one that listed this event, else the first
 * (a scheduled run carries no catalog event id). A test run names one: two triggers
 * can list the same event, and the author picked which of them to fire. */
export function findTriggerNodeForEvent(
  definition: WorkflowDefinition,
  eventId: string,
  triggerNodeId?: string
): TriggerNode | undefined {
  const triggers = definition.nodes.filter(
    (node): node is TriggerNode => node.type === "trigger"
  );
  const named =
    triggerNodeId === undefined
      ? undefined
      : triggers.find((node) => node.id === triggerNodeId);
  return (
    named ??
    triggers.find((node) => node.data.events.includes(eventId)) ??
    triggers[0]
  );
}

/** Target node ids for one handle, in stored edge order. */
export function outgoing(
  definition: WorkflowDefinition,
  nodeId: string,
  handle: string | null
): string[] {
  if (handle === null) return [];
  return definition.edges
    .filter((edge) => edge.source === nodeId && edge.sourceHandle === handle)
    .map((edge) => edge.target);
}

export interface WalkState {
  frontier: string[];
  executed: Set<string>;
  sequence: number;
}

export function createWalkState(
  definition: WorkflowDefinition,
  triggerNodeId?: string
): WalkState {
  const id = triggerNodeId ?? findTriggerNode(definition)?.id;
  return {
    frontier: id ? outgoing(definition, id, DEFAULT_HANDLE) : [],
    executed: new Set<string>(),
    sequence: 0
  };
}

export function nextNode(state: WalkState): string | undefined {
  return state.frontier.shift();
}

export function alreadyExecuted(state: WalkState, nodeId: string): boolean {
  return state.executed.has(nodeId);
}

/** Records an execution and appends the nodes its handle leads to. */
export function advance(
  state: WalkState,
  definition: WorkflowDefinition,
  nodeId: string,
  handle: string | null
): void {
  state.executed.add(nodeId);
  state.sequence += 1;
  state.frontier.push(...outgoing(definition, nodeId, handle));
}
