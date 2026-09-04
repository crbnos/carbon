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
  /**
   * Every edge whose fate is decided: `live` when its source took that handle,
   * `dead` when it took another or was itself never reached. An edge missing
   * from the map is still pending, and holds its target back.
   */
  edges: Map<string, "live" | "dead">;
  /** Nodes every path into which turned out dead. They never run. */
  skipped: Set<string>;
  /** Nodes already queued or executed, so nothing enters the frontier twice. */
  queued: Set<string>;
}

/**
 * Settles each of `nodeId`'s outgoing edges: the one handle it took is live,
 * every other handle is dead. `null` — a terminal handle — kills them all.
 */
function settleOutgoing(
  state: WalkState,
  definition: WorkflowDefinition,
  nodeId: string,
  handle: string | null
): void {
  for (const edge of definition.edges) {
    if (edge.source !== nodeId) continue;
    state.edges.set(
      edge.id,
      handle !== null && edge.sourceHandle === handle ? "live" : "dead"
    );
  }
}

/**
 * Promotes every node whose incoming edges have all settled: at least one live
 * edge makes it ready to run, all-dead makes it skipped — and a skip settles its
 * own outgoing edges dead, which can release joins further down. Repeats until
 * nothing more moves, so one condition can retire a whole subgraph.
 */
function promoteReady(state: WalkState, definition: WorkflowDefinition): void {
  // Stored edge order is the author's fan-out order, so walk candidates by the
  // edge that reaches them rather than by their position in `nodes`.
  const candidates: string[] = [];
  for (const edge of definition.edges) {
    if (!candidates.includes(edge.target)) candidates.push(edge.target);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of candidates) {
      if (state.queued.has(nodeId) || state.skipped.has(nodeId)) continue;

      const states = definition.edges
        .filter((edge) => edge.target === nodeId)
        .map((edge) => state.edges.get(edge.id));
      if (states.some((edgeState) => edgeState === undefined)) continue;

      changed = true;
      if (states.includes("live")) {
        state.queued.add(nodeId);
        state.frontier.push(nodeId);
      } else {
        state.skipped.add(nodeId);
        settleOutgoing(state, definition, nodeId, null);
      }
    }
  }
}

export function createWalkState(
  definition: WorkflowDefinition,
  triggerNodeId?: string
): WalkState {
  const state: WalkState = {
    frontier: [],
    executed: new Set<string>(),
    // Starts at 1: the trigger's own step row is written with sequence 0, and the
    // run detail orders by it, so sharing 0 left the first two rows ambiguous.
    sequence: 1,
    edges: new Map<string, "live" | "dead">(),
    skipped: new Set<string>(),
    queued: new Set<string>()
  };

  const fired = triggerNodeId ?? findTriggerNode(definition)?.id;
  // Only one trigger fires. The others' edges are dead from the outset, or a
  // node fed by two triggers would wait for a branch that is never coming.
  for (const node of definition.nodes) {
    if (node.type !== "trigger") continue;
    settleOutgoing(
      state,
      definition,
      node.id,
      node.id === fired ? DEFAULT_HANDLE : null
    );
  }
  promoteReady(state, definition);
  return state;
}

export function nextNode(state: WalkState): string | undefined {
  return state.frontier.shift();
}

export function alreadyExecuted(state: WalkState, nodeId: string): boolean {
  return state.executed.has(nodeId);
}

/** Records an execution, settles its outgoing edges and releases what that frees. */
export function advance(
  state: WalkState,
  definition: WorkflowDefinition,
  nodeId: string,
  handle: string | null
): void {
  state.executed.add(nodeId);
  state.queued.add(nodeId);
  state.sequence += 1;
  settleOutgoing(state, definition, nodeId, handle);
  promoteReady(state, definition);
}
