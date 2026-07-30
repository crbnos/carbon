import type { WorkflowCatalog } from "./catalog";
import type { WorkflowIssue } from "./issues";
import {
  checkNodeConfig,
  checkNodeTypes,
  getNodeHandles,
  getNodeOutputs,
  getNodeRefs,
  isNodeConfigured,
  type NodeContext,
  type NodeOutputs,
  type ResolvedRef
} from "./nodes";
import {
  type TriggerNode,
  type WorkflowDefinition,
  workflowDefinitionSchema
} from "./schema";
import type { ValueOrRef, ValueType, VariableRef } from "./types";

/**
 * Is this workflow well-formed enough to activate? An empty result means yes.
 * The activation gate in phase 7 checks that directly, so there is exactly one
 * entry point and the builder and the engine can never disagree.
 *
 * Takes `unknown` because what it really validates is stored JSON that may
 * predate the current schema; the shape layer below is the boundary.
 *
 * Checks run in layers, each assuming the previous one passed, so a customer is
 * never shown type errors that are really a consequence of a broken shape.
 */
export function validateDefinition(
  definition: unknown,
  catalog: WorkflowCatalog
): WorkflowIssue[] {
  // Layer 1 — the stored document is the shape we expect.
  const parsed = workflowDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      code: "MALFORMED_DEFINITION" as const,
      message: issue.message,
      field: issue.path.join(".") || undefined
    }));
  }

  const duplicates = checkDuplicateIds(parsed.data);
  if (duplicates.length > 0) return duplicates;

  const trigger = checkTrigger(parsed.data);
  if (trigger.length > 0) return trigger;

  const edges = checkEdges(parsed.data);
  if (edges.length > 0) return edges;

  const graph = checkGraph(parsed.data);
  if (graph.length > 0) return graph;

  const ctx = createContext(parsed.data, catalog);

  const references = checkReferences(parsed.data, ctx);
  if (references.length > 0) return references;

  const types = checkTypes(parsed.data, ctx);
  if (types.length > 0) return types;

  return checkConfig(parsed.data, ctx);
}

function checkDuplicateIds(definition: WorkflowDefinition): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const seen = new Set<string>();
  for (const node of definition.nodes) {
    if (seen.has(node.id)) {
      issues.push({
        code: "MALFORMED_DEFINITION",
        nodeId: node.id,
        message: `More than one node uses the id "${node.id}".`
      });
    }
    seen.add(node.id);
  }
  return issues;
}

/** Layer 2 — exactly one trigger, configured to actually be able to fire. */
function checkTrigger(definition: WorkflowDefinition): WorkflowIssue[] {
  const triggers = definition.nodes.filter(
    (node): node is TriggerNode => node.type === "trigger"
  );

  if (triggers.length === 0) {
    return [
      {
        code: "NO_TRIGGER",
        message: "This workflow has no trigger, so nothing can start it."
      }
    ];
  }
  if (triggers.length > 1) {
    return triggers.slice(1).map((node) => ({
      code: "MULTIPLE_TRIGGERS" as const,
      nodeId: node.id,
      message: "A workflow can only have one trigger."
    }));
  }

  const trigger = triggers[0];
  if (trigger === undefined) return [];

  const { events, schedule } = trigger.data;
  const hasEvents = events.length > 0;

  if (hasEvents && schedule !== undefined) {
    return [
      {
        code: "CONFLICTING_TRIGGER",
        nodeId: trigger.id,
        message:
          "A trigger runs either when something happens or on a schedule, not both."
      }
    ];
  }
  if (!hasEvents && schedule === undefined) {
    return [
      {
        code: "EMPTY_TRIGGER",
        nodeId: trigger.id,
        message: "Choose what starts this workflow before turning it on."
      }
    ];
  }

  if (schedule === undefined) return [];

  const issues: WorkflowIssue[] = [];
  const invalid = (message: string, field: string) =>
    issues.push({
      code: "INVALID_SCHEDULE",
      nodeId: trigger.id,
      field,
      message
    });

  if (schedule.freq === "Weekly") {
    if (schedule.weekdays === undefined || schedule.weekdays.length === 0) {
      invalid("Pick at least one day of the week.", "weekdays");
    }
  } else if (schedule.weekdays !== undefined) {
    invalid("Days of the week only apply to a weekly schedule.", "weekdays");
  }

  if (schedule.freq === "Monthly") {
    if (schedule.day === undefined) {
      invalid("Pick which day of the month to run on.", "day");
    }
  } else if (schedule.day !== undefined) {
    invalid("A day of the month only applies to a monthly schedule.", "day");
  }

  if (!isValidTimeZone(schedule.tz)) {
    invalid(`"${schedule.tz}" is not a time zone we recognise.`, "tz");
  }

  return issues;
}

function isValidTimeZone(tz: string): boolean {
  if (tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Layer 3 — every connection joins two real nodes at a handle that exists. */
function checkEdges(definition: WorkflowDefinition): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));

  for (const edge of definition.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);

    if (source === undefined || target === undefined) {
      issues.push({
        code: "DANGLING_EDGE",
        edgeId: edge.id,
        message: "This connection points at a step that no longer exists."
      });
      continue;
    }

    if (!getNodeHandles(source).includes(edge.sourceHandle)) {
      issues.push({
        code: "UNKNOWN_HANDLE",
        edgeId: edge.id,
        nodeId: source.id,
        field: edge.sourceHandle,
        message: `This connection leaves from an output ("${edge.sourceHandle}") this step does not have.`
      });
    }
  }

  return issues;
}

/** Layer 4 — steps only ever flow forward, and every step can be reached. */
function checkGraph(definition: WorkflowDefinition): WorkflowIssue[] {
  const adjacency = buildAdjacency(definition, "forward");
  const issues: WorkflowIssue[] = [];

  const state = new Map<string, "visiting" | "done">();
  const looping = new Set<string>();

  const visit = (id: string) => {
    state.set(id, "visiting");
    for (const next of adjacency.get(id) ?? []) {
      const seen = state.get(next);
      if (seen === "visiting") {
        looping.add(next);
      } else if (seen === undefined) {
        visit(next);
      }
    }
    state.set(id, "done");
  };
  for (const node of definition.nodes) {
    if (!state.has(node.id)) visit(node.id);
  }

  if (looping.size > 0) {
    for (const id of looping) {
      issues.push({
        code: "CYCLE",
        nodeId: id,
        message:
          "These steps loop back on each other, so they would never finish."
      });
    }
    return issues;
  }

  const trigger = definition.nodes.find((node) => node.type === "trigger");
  if (trigger === undefined) return issues;

  const reachable = reachableFrom(trigger.id, adjacency);
  for (const node of definition.nodes) {
    if (node.type === "trigger") continue;
    if (!reachable.has(node.id)) {
      issues.push({
        code: "UNREACHABLE_NODE",
        nodeId: node.id,
        message: "Nothing connects to this step, so it would never run."
      });
    }
  }

  return issues;
}

function buildAdjacency(
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

function reachableFrom(
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

/**
 * Answers the questions node kinds ask about the rest of the definition.
 * Ancestors and outputs are memoised because both layers 5 and 6 walk every
 * reference in the graph.
 */
function createContext(
  definition: WorkflowDefinition,
  catalog: WorkflowCatalog
): NodeContext {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const reverse = buildAdjacency(definition, "reverse");
  const ancestorCache = new Map<string, Set<string>>();
  const outputCache = new Map<string, NodeOutputs | undefined>();

  /** Every node whose value can legitimately be read at `nodeId`. */
  const ancestorsOf = (nodeId: string): Set<string> => {
    const cached = ancestorCache.get(nodeId);
    if (cached !== undefined) return cached;
    const ancestors = reachableFrom(nodeId, reverse);
    ancestors.delete(nodeId);
    ancestorCache.set(nodeId, ancestors);
    return ancestors;
  };

  // Recursion terminates without a re-entry guard: a reference resolves only to
  // a strict ancestor (below), and layer 4 already proved the graph acyclic, so
  // each hop moves strictly upstream.
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

  const typeOf = (
    value: ValueOrRef,
    atNodeId: string
  ): ValueType | undefined => {
    if (value.kind === "literal") return value.type;
    const resolved = resolveRef(value, atNodeId);
    return "type" in resolved ? resolved.type : undefined;
  };

  const ctx: NodeContext = { catalog, resolveRef, typeOf, outputsOf };
  return ctx;
}

/** Follow a dotted property path through the catalog's entity properties. */
function walkPath(
  type: ValueType,
  path: string[],
  catalog: WorkflowCatalog
): ValueType | undefined {
  let current = type;
  for (const segment of path) {
    if (current.kind !== "entity") return undefined;
    const entity = catalog.getEntity(current.of);
    if (entity === undefined) return undefined;
    const next = entity.properties[segment];
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

/** Layer 5 — every variable names a real, genuinely upstream value. */
function checkReferences(
  definition: WorkflowDefinition,
  ctx: NodeContext
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];

  for (const node of definition.nodes) {
    for (const { ref, field } of getNodeRefs(node)) {
      const resolved = ctx.resolveRef(ref, node.id);
      if ("type" in resolved) continue;

      switch (resolved.failure) {
        case "unconfigured":
          break;
        case "unknown-node":
          issues.push({
            code: "UNKNOWN_VARIABLE",
            nodeId: node.id,
            field,
            message: `This uses a value from a step ("${ref.nodeId}") that no longer exists.`
          });
          break;
        case "not-upstream":
          issues.push({
            code: "REF_NOT_UPSTREAM",
            nodeId: node.id,
            field,
            message:
              "This uses a value from a step that does not always run before it."
          });
          break;
        case "unknown":
          issues.push({
            code: "UNKNOWN_VARIABLE",
            nodeId: node.id,
            field,
            message: `"${[ref.output, ...ref.path].join(".")}" is not a value that step hands out.`
          });
          break;
      }
    }
  }

  return issues;
}

/**
 * Layer 6 — every value plugged in is the kind of value that fits. Nodes whose
 * catalog entry is missing are skipped so layer 7 reports that once, rather than
 * a customer seeing both "we no longer know this action" and every type error
 * that follows from not knowing it.
 */
function checkTypes(
  definition: WorkflowDefinition,
  ctx: NodeContext
): WorkflowIssue[] {
  return definition.nodes
    .filter((node) => isNodeConfigured(node, ctx))
    .flatMap((node) => checkNodeTypes(node, ctx));
}

/** Layer 7 — nothing is left half-configured, and every id is one we know. */
function checkConfig(
  definition: WorkflowDefinition,
  ctx: NodeContext
): WorkflowIssue[] {
  return definition.nodes.flatMap((node) => checkNodeConfig(node, ctx));
}
