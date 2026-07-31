import type { WorkflowCatalog } from "./catalog";
import type { WorkflowIssue, WorkflowIssueCode } from "./issues";
import {
  checkNodeConfig,
  checkNodeTypes,
  getNodeHandles,
  getNodeValues,
  isNodeConfigured,
  type NodeContext,
  type ResolveFailure,
  type ValueSite
} from "./nodes";
import {
  type TriggerNode,
  type WorkflowDefinition,
  workflowDefinitionSchema
} from "./schema";
import type { ValueOrRef } from "./types";
import { buildAdjacency, createContext, reachableFrom } from "./variables";

/**
 * Is this workflow well-formed enough to activate? An empty result means yes.
 * Layers run in order and stop at the first that fails, so knock-on errors stay hidden.
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

  const { context } = createContext(parsed.data, catalog);

  const references = checkReferences(parsed.data, context);
  if (references.length > 0) return references;

  const types = checkTypes(parsed.data, context);
  if (types.length > 0) return types;

  return checkConfig(parsed.data, context);
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

/** Layer 5 — every variable names a real upstream value, and items are only read inside a loop. */
function checkReferences(
  definition: WorkflowDefinition,
  ctx: NodeContext
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];

  for (const node of definition.nodes) {
    for (const site of getNodeValues(node).flatMap(expandTemplate)) {
      const resolved = ctx.resolveValue(site.value, node.id);
      if ("type" in resolved) continue;
      const described = describeFailure(resolved.failure, site.value);
      if (described !== undefined) {
        issues.push({ ...described, nodeId: node.id, field: site.field });
      }
    }
  }

  return issues;
}

/** A template's variables are checked one by one, so a bad one names its own place. */
function expandTemplate(site: ValueSite): ValueSite[] {
  if (site.value.kind !== "template") return [site];
  return site.value.parts.flatMap((part, index) =>
    part.kind === "text"
      ? []
      : [{ value: part, field: `${site.field}.parts.${index}` }]
  );
}

/** A failure as a customer would put it, or nothing when another layer reports the real cause. */
function describeFailure(
  failure: ResolveFailure,
  value: ValueOrRef
): { code: WorkflowIssueCode; message: string } | undefined {
  if (value.kind === "item") {
    if (failure === "no-loop") {
      return {
        code: "ITEM_OUTSIDE_LOOP",
        message:
          "This refers to the current item, but this step does not work through a list."
      };
    }
    if (failure === "unknown") {
      return {
        code: "UNKNOWN_VARIABLE",
        message: "This property does not exist on the items in that list."
      };
    }
    return undefined;
  }

  if (value.kind !== "ref") return undefined;

  switch (failure) {
    case "unknown-node":
      return {
        code: "UNKNOWN_VARIABLE",
        message: `This uses a value from a step ("${value.nodeId}") that no longer exists.`
      };
    case "not-upstream":
      return {
        code: "REF_NOT_UPSTREAM",
        message:
          "This uses a value from a step that does not always run before it."
      };
    case "unknown":
      return {
        code: "UNKNOWN_VARIABLE",
        message: `"${[value.output, ...value.path].join(".")}" is not a value that step hands out.`
      };
    default:
      return undefined;
  }
}

/**
 * Layer 6 — every value plugged in fits. Nodes with a missing catalog entry are
 * skipped so layer 7 reports that alone.
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
