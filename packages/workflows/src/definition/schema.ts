import { z } from "zod";
import { dataOperationSchema } from "./data-operations";
import {
  clauseSchema,
  combinatorSchema,
  lookupMatchSchema,
  scheduleSchema,
  valueOrRefSchema,
  variableRefSchema
} from "./types";

export const CURRENT_DEFINITION_FORMAT_VERSION = 4;

/** Cap on the items one repeating step works through. */
export const MAX_LIST_ITEMS = 100;
/** Hop cap, shared with the matcher. */
export const MAX_CHAIN_DEPTH = 10;

/**
 * Whether the change being watched came from one of this company's workflows.
 *
 * The only signal is the run tag on the write, so `Person` means "not a workflow"
 * — a human, an import, an integration, an API key or a background job all land
 * there. It is shown as "Everything else", not "People". Telling those apart would
 * need `actorId`, which nothing here reads.
 */
export const originSchema = z.enum(["Person", "Automation", "Both"]);
export type Origin = z.infer<typeof originSchema>;

const nodeBase = {
  id: z.string().min(1),
  /** Unique within the definition. The label users see; refs bind to `id`, not this. */
  name: z.string().regex(/^[a-z0-9_]+$/, {
    message:
      "A node name may only contain lowercase letters, numbers and underscores"
  }),
  position: z.object({ x: z.number(), y: z.number() }),
  /** Presentation only. Optional; consumers treat undefined as true. */
  expanded: z.boolean().optional()
};

const triggerNode = z.object({
  ...nodeBase,
  type: z.literal("trigger"),
  data: z.object({
    events: z.array(z.string()).default([]),
    origin: originSchema.default("Both"),
    schedule: scheduleSchema.optional()
  })
});

export const conditionPathSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["if", "elseIf", "else"]),
  combinator: combinatorSchema.default("and"),
  clauses: z.array(clauseSchema).default([])
});
export type ConditionPath = z.infer<typeof conditionPathSchema>;

const conditionNode = z.object({
  ...nodeBase,
  type: z.literal("condition"),
  data: z.object({
    paths: z.array(conditionPathSchema).default([])
  })
});

const computeNode = z.object({
  ...nodeBase,
  type: z.literal("compute"),
  data: z.object({
    operation: z.string(),
    inputs: z.record(valueOrRefSchema).default({})
  })
});

const lookupNode = z.object({
  ...nodeBase,
  type: z.literal("lookup"),
  data: z.object({
    entity: z.string(),
    returns: z.enum(["one", "list"]).default("one"),
    match: z.array(lookupMatchSchema).default([])
  })
});

/** The data node. Still typed `"filter"`: every saved workflow holds that literal,
 * and `operation` defaults to `"filter"`, so a node stored before this existed
 * parses and behaves exactly as it did — no format bump, no migration. */
const filterNode = z.object({
  ...nodeBase,
  type: z.literal("filter"),
  data: z.object({
    source: variableRefSchema.optional(),
    combinator: combinatorSchema.default("and"),
    clauses: z.array(clauseSchema).default([]),
    operation: dataOperationSchema.default("filter"),
    /** `pluck` only: a dotted path to the field projected off each item. */
    field: z.string().optional(),
    /** `pluck` only: flatten a list-valued field into ONE list, since
     * `list<list<T>>` is unrepresentable. Off by default so a node never stores a
     * flag that means nothing; the builder sets it when the field is a list. */
    flatten: z.boolean().default(false)
  })
});

const actionNode = z.object({
  ...nodeBase,
  type: z.literal("action"),
  // No `batch` flag: whether the step repeats is read off the wiring. See `batch.ts`.
  data: z.object({
    action: z.string(),
    inputs: z.record(valueOrRefSchema).default({})
  })
});

/**
 * A step run by a third-party integration. Its own kind rather than an action, so
 * the action path carries no notion of a vendor: `piece` names the integration and
 * `action` the step within it, both drawn from `WORKFLOW_INTEGRATION_CATALOG`.
 *
 * Which account it acts as is an ordinary input (`connectionId`), not a field here
 * — that is what lets the generic options provider fill it like any other list.
 */
const integrationNode = z.object({
  ...nodeBase,
  type: z.literal("integration"),
  data: z.object({
    piece: z.string(),
    action: z.string(),
    inputs: z.record(valueOrRefSchema).default({})
  })
});

export const nodeSchema = z.discriminatedUnion("type", [
  triggerNode,
  conditionNode,
  computeNode,
  lookupNode,
  filterNode,
  actionNode,
  integrationNode
]);
export type WorkflowNode = z.infer<typeof nodeSchema>;
export type WorkflowNodeType = WorkflowNode["type"];

export type TriggerNode = Extract<WorkflowNode, { type: "trigger" }>;
export type ConditionNode = Extract<WorkflowNode, { type: "condition" }>;
export type ComputeNode = Extract<WorkflowNode, { type: "compute" }>;
export type LookupNode = Extract<WorkflowNode, { type: "lookup" }>;
export type FilterNode = Extract<WorkflowNode, { type: "filter" }>;
export type ActionNode = Extract<WorkflowNode, { type: "action" }>;
export type IntegrationNode = Extract<WorkflowNode, { type: "integration" }>;

export const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string(),
  sourceHandle: z.string(),
  target: z.string(),
  targetHandle: z.string()
});
export type WorkflowEdge = z.infer<typeof edgeSchema>;

export const workflowDefinitionSchema = z.object({
  formatVersion: z.number().int().default(CURRENT_DEFINITION_FORMAT_VERSION),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema)
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/** The default output name every node exposes its primary value under. */
export const DEFAULT_OUTPUT = "result";
/** The handle name a node with a single output flows onward from. */
export const DEFAULT_HANDLE = "out";
export const SUCCESS_HANDLE = "success";
export const FAILURE_HANDLE = "failure";
