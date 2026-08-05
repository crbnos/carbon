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
  type WorkflowNode,
  workflowDefinitionSchema
} from "./schema";
import {
  describeType,
  rendersAsText,
  type Template,
  type ValueOrRef
} from "./types";
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

  // From here on, only the live graph. A step no trigger reaches is not part of the
  // workflow — the engine never runs it, so a half-finished one parked on the canvas
  // is not a problem to report.
  const live = liveDefinition(parsed.data);

  const duplicateNames = checkDuplicateNames(live);
  if (duplicateNames.length > 0) return duplicateNames;

  const graph = checkGraph(live);
  if (graph.length > 0) return graph;

  const { context } = createContext(live, catalog);

  const references = checkReferences(live, context);
  if (references.length > 0) return references;

  const types = checkTypes(live, context);
  if (types.length > 0) return types;

  return checkConfig(live, context);
}

/** The workflow as the engine sees it: every trigger, everything they reach, and the
 * edges between those. */
export function liveDefinition(
  definition: WorkflowDefinition
): WorkflowDefinition {
  const adjacency = buildAdjacency(definition, "forward");
  const live = new Set<string>();
  for (const node of definition.nodes) {
    if (node.type !== "trigger") continue;
    for (const id of reachableFrom(node.id, adjacency)) live.add(id);
  }

  if (live.size === definition.nodes.length) return definition;

  return {
    ...definition,
    nodes: definition.nodes.filter((node) => live.has(node.id)),
    edges: definition.edges.filter(
      (edge) => live.has(edge.source) && live.has(edge.target)
    )
  };
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

function checkDuplicateNames(definition: WorkflowDefinition): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const seen = new Map<string, string>();
  for (const node of definition.nodes) {
    const first = seen.get(node.name);
    if (first === undefined) {
      seen.set(node.name, node.id);
    } else {
      issues.push({
        code: "DUPLICATE_NODE_NAME",
        nodeId: node.id,
        message: `Two steps are called "${node.name}". Every step needs a different name.`
      });
    }
  }
  // Also flag the first occurrence so both offending nodes are highlighted.
  if (issues.length > 0) {
    const duplicatedNames = new Set(
      issues.map((i) => {
        const node = definition.nodes.find((n) => n.id === i.nodeId);
        return node?.name;
      })
    );
    for (const node of definition.nodes) {
      if (
        duplicatedNames.has(node.name) &&
        !issues.some((i) => i.nodeId === node.id)
      ) {
        issues.push({
          code: "DUPLICATE_NODE_NAME",
          nodeId: node.id,
          message: `Two steps are called "${node.name}". Every step needs a different name.`
        });
      }
    }
  }
  return issues;
}

/** Layer 2 — at least one trigger, each configured to actually be able to fire. */
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

  // A scheduled workflow runs on its own clock, so it cannot also be event-driven.
  const scheduled = triggers.filter((node) => node.data.schedule !== undefined);
  if (scheduled.length > 0 && triggers.length > 1) {
    return scheduled.map((node) => ({
      code: "CONFLICTING_TRIGGER" as const,
      nodeId: node.id,
      message:
        "A workflow that runs on a schedule cannot have any other trigger."
    }));
  }

  const perNode = triggers.flatMap(checkOneTrigger);
  if (perNode.length > 0) return perNode;

  return checkDuplicateTriggerEvents(triggers);
}

/** The same event on two triggers would fire the workflow twice for one change. */
function checkDuplicateTriggerEvents(triggers: TriggerNode[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const owner = new Map<string, string>();

  for (const node of triggers) {
    for (const eventId of node.data.events) {
      const first = owner.get(eventId);
      if (first === undefined) {
        owner.set(eventId, node.id);
        continue;
      }
      issues.push({
        code: "DUPLICATE_TRIGGER_EVENT",
        nodeId: node.id,
        field: eventId,
        message: `Another trigger already watches "${eventId}". Remove it from one of them.`
      });
    }
  }

  return issues;
}

function checkOneTrigger(trigger: TriggerNode): WorkflowIssue[] {
  const { events, schedule } = trigger.data;
  const hasEvents = events.length > 0;

  if (events.length > 1) {
    return [
      {
        code: "MULTIPLE_TRIGGER_EVENTS",
        nodeId: trigger.id,
        message: "A trigger can only watch one event. Remove all but one."
      }
    ];
  }
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

/** Layer 4 — steps only ever flow forward. */
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

  return issues;
}

/**
 * Layer 5 on its own, for the builder to run as the user edits. A reference breaks
 * because of a change made elsewhere, so it is the one class of problem worth
 * reporting unasked. A definition that does not parse reports nothing — mid-edit it
 * is often incomplete, and layer 1 is publish's job.
 */
export function referenceIssues(
  definition: unknown,
  catalog: WorkflowCatalog
): WorkflowIssue[] {
  const parsed = workflowDefinitionSchema.safeParse(definition);
  if (!parsed.success) return [];
  const live = liveDefinition(parsed.data);
  const { context } = createContext(live, catalog);
  return checkReferences(live, context);
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

/** A template's variables are checked one by one, so a bad one names its own place.
 * Named rows flatten the same way, then recurse so a row holding a template expands too. */
function expandTemplate(site: ValueSite): ValueSite[] {
  if (site.value.kind === "pairs") {
    return site.value.entries.flatMap((entry, index) =>
      expandTemplate({
        value: entry.value,
        field: `${site.field}.entries.${index}`
      })
    );
  }
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
    .flatMap((node) => [
      ...checkNodeTypes(node, ctx),
      ...checkTemplateParts(node, ctx)
    ]);
}

/**
 * Layer 6, second half — a record dropped into a sentence has no reading, so it is
 * rejected here rather than silently flattened to an id at run time. This lives in
 * one place for every template: an action's message, an entity's field, a clause.
 */
function checkTemplateParts(
  node: WorkflowNode,
  ctx: NodeContext
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];

  const check = (value: ValueOrRef, field: string): void => {
    const type = ctx.typeOf(value, node.id);
    if (type === undefined || rendersAsText(type)) return;
    issues.push({
      code: "TYPE_MISMATCH",
      nodeId: node.id,
      field,
      message: `This puts ${describeType(type)} into text. Pick one of its properties instead, such as its name.`
    });
  };

  const checkTemplate = (template: Template, field: string): void => {
    template.parts.forEach((part, index) => {
      if (part.kind === "text") return;
      check(part, `${field}.parts.${index}`);
    });
  };

  for (const site of getNodeValues(node)) {
    if (site.value.kind === "template") {
      checkTemplate(site.value, site.field);
      continue;
    }
    if (site.value.kind !== "pairs") continue;
    site.value.entries.forEach((entry, index) => {
      const field = `${site.field}.entries.${index}`;
      // A row's value is written into a header, which is text like any sentence.
      if (entry.value.kind === "template") checkTemplate(entry.value, field);
      else check(entry.value, field);
    });
  }
  return issues;
}

/** Layer 7 — nothing is left half-configured, and every id is one we know. */
function checkConfig(
  definition: WorkflowDefinition,
  ctx: NodeContext
): WorkflowIssue[] {
  return definition.nodes.flatMap((node) => checkNodeConfig(node, ctx));
}
