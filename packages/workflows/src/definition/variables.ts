import { type WorkflowCatalog, walkPath } from "./catalog";
import {
  getNodeLoopList,
  getNodeOutputs,
  type LoopList,
  type NodeContext,
  type NodeOutputs,
  type ResolvedRef
} from "./nodes";
import type { WorkflowDefinition, WorkflowNodeType } from "./schema";
import {
  type ItemRef,
  t,
  type ValueOrRef,
  type ValueType,
  type VariableRef
} from "./types";

// ─── Graph helpers ────────────────────────────────────────────────────────────

export function buildAdjacency(
  definition: WorkflowDefinition,
  direction: "forward" | "reverse"
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of definition.nodes) adjacency.set(node.id, []);
  for (const edge of definition.edges) {
    const [from, to] =
      direction === "forward"
        ? [edge.source, edge.target]
        : [edge.target, edge.source];
    adjacency.get(from)?.push(to);
  }
  return adjacency;
}

export function reachableFrom(
  start: string,
  adjacency: Map<string, string[]>
): Set<string> {
  const reachable = new Set<string>([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === undefined) continue;
    for (const next of adjacency.get(id) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}

/** BFS from `start` that never visits `exclude`. */
function reachableFromExcluding(
  start: string,
  adjacency: Map<string, string[]>,
  exclude: string
): Set<string> {
  if (start === exclude) return new Set();
  const reachable = new Set<string>([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === undefined) continue;
    for (const next of adjacency.get(id) ?? []) {
      if (next !== exclude && !reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export interface DefinitionContext {
  context: NodeContext;
  ancestorsOf: (nodeId: string) => Set<string>;
}

/** Answers the questions node kinds ask about the rest of the definition. */
export function createContext(
  definition: WorkflowDefinition,
  catalog: WorkflowCatalog
): DefinitionContext {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const reverse = buildAdjacency(definition, "reverse");
  const ancestorCache = new Map<string, Set<string>>();
  const outputCache = new Map<string, NodeOutputs | undefined>();
  const loopCache = new Map<string, LoopList | undefined>();

  /** Every node whose value can legitimately be read at `nodeId`. */
  const ancestorsOf = (nodeId: string): Set<string> => {
    const cached = ancestorCache.get(nodeId);
    if (cached !== undefined) return cached;
    const ancestors = reachableFrom(nodeId, reverse);
    ancestors.delete(nodeId);
    ancestorCache.set(nodeId, ancestors);
    return ancestors;
  };

  // No re-entry guard needed: refs resolve only to strict ancestors and layer 4
  // proved the graph acyclic, so each hop moves strictly upstream.
  const outputsOf = (nodeId: string): NodeOutputs | undefined => {
    if (outputCache.has(nodeId)) return outputCache.get(nodeId);
    const node = byId.get(nodeId);
    const outputs = node === undefined ? undefined : getNodeOutputs(node, ctx);
    outputCache.set(nodeId, outputs);
    return outputs;
  };

  const resolveRef = (ref: VariableRef, atNodeId: string): ResolvedRef => {
    if (!byId.has(ref.nodeId)) return { failure: "unknown-node" };
    // A node may not read its own output, so this covers the self-reference too.
    if (!ancestorsOf(atNodeId).has(ref.nodeId)) {
      return { failure: "not-upstream" };
    }
    const outputs = outputsOf(ref.nodeId);
    if (outputs === undefined) return { failure: "unconfigured" };

    const declared = outputs[ref.output];
    if (declared === undefined) return { failure: "unknown" };

    const resolved = walkPath(declared, ref.path, catalog);
    if (resolved === undefined) return { failure: "unknown" };
    return { type: resolved };
  };

  const resolveItem = (ref: ItemRef, atNodeId: string): ResolvedRef => {
    const loop = loopListOf(atNodeId);
    if (loop === undefined) return { failure: "no-loop" };
    if (!("type" in loop)) return loop;
    const resolved = walkPath(loop.type.of, ref.path, catalog);
    return resolved === undefined ? { failure: "unknown" } : { type: resolved };
  };

  const resolveValue = (value: ValueOrRef, atNodeId: string): ResolvedRef => {
    if (value.kind === "literal") return { type: value.type };
    if (value.kind === "item") return resolveItem(value, atNodeId);
    // A template always reads as text; its parts are checked in layer 5.
    if (value.kind === "template") return { type: t.string };
    // Rows have no type of their own; each entry is checked in its own right.
    if (value.kind === "pairs") return { failure: "unknown" };
    return resolveRef(value, atNodeId);
  };

  const typeOf = (
    value: ValueOrRef,
    atNodeId: string
  ): ValueType | undefined => {
    const resolved = resolveValue(value, atNodeId);
    return "type" in resolved ? resolved.type : undefined;
  };

  const loopListOf = (nodeId: string): LoopList | undefined => {
    if (loopCache.has(nodeId)) return loopCache.get(nodeId);
    const node = byId.get(nodeId);
    const loop = node === undefined ? undefined : getNodeLoopList(node, ctx);
    loopCache.set(nodeId, loop);
    return loop;
  };

  const ctx: NodeContext = {
    catalog,
    resolveValue,
    typeOf,
    outputsOf,
    loopListOf
  };
  return { context: ctx, ancestorsOf };
}

// ─── Available variables ──────────────────────────────────────────────────────

export interface AvailableVariable {
  nodeId: string;
  /** The node's name, for grouping in the picker. */
  nodeName: string;
  nodeType: WorkflowNodeType;
  /** The output name on that node, e.g. "record", "before", "result". */
  output: string;
  type: ValueType;
  /** False when the node sits on a branch that need not have run. */
  guaranteed: boolean;
}

/**
 * All upstream outputs a node at `nodeId` may legitimately reference,
 * annotated with whether they are guaranteed to exist at run time.
 */
export function availableVariables(
  definition: WorkflowDefinition,
  nodeId: string,
  catalog: WorkflowCatalog
): AvailableVariable[] {
  const { context, ancestorsOf } = createContext(definition, catalog);
  const triggers = definition.nodes.filter((n) => n.type === "trigger");
  const ancestors = ancestorsOf(nodeId);

  if (ancestors.size === 0) return [];

  const byId = new Map(definition.nodes.map((n) => [n.id, n]));
  const forward = buildAdjacency(definition, "forward");

  // BFS distances from every trigger at once, for ordering only.
  const distanceFromTrigger = new Map<string, number>();
  const queue: Array<[string, number]> = triggers.map((n) => [n.id, 0]);
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    if (entry === undefined) continue;
    const [id, dist] = entry;
    if (distanceFromTrigger.has(id)) continue;
    distanceFromTrigger.set(id, dist);
    for (const next of forward.get(id) ?? []) {
      if (!distanceFromTrigger.has(next)) {
        queue.push([next, dist + 1]);
      }
    }
  }

  const variables: AvailableVariable[] = [];

  for (const ancestorId of ancestors) {
    const node = byId.get(ancestorId);
    if (node === undefined) continue;
    const outputs = context.outputsOf(ancestorId);
    if (outputs === undefined) continue;

    // Guaranteed only if EVERY trigger loses sight of nodeId once this
    // ancestor is removed — otherwise some firing reaches nodeId without it.
    const guaranteed =
      triggers.length > 0 &&
      triggers.every(
        (trig) =>
          !reachableFromExcluding(trig.id, forward, ancestorId).has(nodeId)
      );

    const nodeName = node.name;

    for (const [output, type] of Object.entries(outputs)) {
      variables.push({
        nodeId: ancestorId,
        nodeName,
        nodeType: node.type,
        output,
        type,
        guaranteed
      });
    }
  }

  // Sort: guaranteed first, then farthest from trigger first (nearest last),
  // then by output name.
  variables.sort((a, b) => {
    if (a.guaranteed !== b.guaranteed) return a.guaranteed ? -1 : 1;
    const da = distanceFromTrigger.get(a.nodeId) ?? 0;
    const db = distanceFromTrigger.get(b.nodeId) ?? 0;
    if (da !== db) return db - da;
    return a.output.localeCompare(b.output);
  });

  return variables;
}

/**
 * What a node wired to `nodeId`'s `handleId` would be able to read — this node's
 * own outputs plus everything already flowing into it.
 *
 * Answered by asking `availableVariables` on behalf of a throwaway node hung off
 * that handle, so branch reachability and the `guaranteed` flag stay in one place.
 */
export function variablesFromHandle(
  definition: WorkflowDefinition,
  nodeId: string,
  handleId: string,
  catalog: WorkflowCatalog
): AvailableVariable[] {
  const probeId = `__probe__${nodeId}__${handleId}`;
  return availableVariables(
    {
      ...definition,
      nodes: [
        ...definition.nodes,
        {
          id: probeId,
          name: "probe",
          type: "filter",
          position: { x: 0, y: 0 },
          data: { combinator: "and", clauses: [] }
        }
      ],
      edges: [
        ...definition.edges,
        {
          id: probeId,
          source: nodeId,
          sourceHandle: handleId,
          target: probeId,
          targetHandle: "in"
        }
      ]
    },
    probeId,
    catalog
  );
}
