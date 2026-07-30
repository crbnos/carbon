import type { CatalogInput, WorkflowCatalog } from "./catalog";
import type { WorkflowIssue } from "./issues";
import {
  type ActionNode,
  DEFAULT_HANDLE,
  DEFAULT_OUTPUT,
  FAILURE_HANDLE,
  type FilterNode,
  SUCCESS_HANDLE,
  type WorkflowNode,
  type WorkflowNodeType
} from "./schema";
import {
  type Clause,
  describeType,
  operatorsForType,
  typesEqual,
  type ValueOrRef,
  type ValueType
} from "./types";

export type NodeOutputs = Record<string, ValueType>;

/** `unconfigured` is suppressed — another layer reports the real cause. */
export type ResolveFailure =
  | "unknown-node"
  | "not-upstream"
  | "unknown"
  | "unconfigured"
  | "no-loop";

export type ResolvedRef = { type: ValueType } | { failure: ResolveFailure };

type ListType = Extract<ValueType, { kind: "list" }>;

/** The list a looping node works through, or why it is not settled. */
export type LoopList = { type: ListType } | { failure: ResolveFailure };

/** One value plugged into a node — literal, variable or current item. */
export interface ValueSite {
  value: ValueOrRef;
  field: string;
}

/** What a node can ask about the rest of the definition. Implemented in `validate.ts`. */
export interface NodeContext {
  catalog: WorkflowCatalog;
  resolveValue(value: ValueOrRef, atNodeId: string): ResolvedRef;
  typeOf(value: ValueOrRef, atNodeId: string): ValueType | undefined;
  outputsOf(nodeId: string): NodeOutputs | undefined;
  loopListOf(nodeId: string): LoopList | undefined;
}

/** Everything one kind of node declares about itself. */
interface NodeKind<N extends WorkflowNode> {
  /** Outgoing connection points, by name. */
  handles(node: N): string[];
  values(node: N): ValueSite[];
  /** What it hands onward; `undefined` when its catalog entry is missing. */
  outputs(node: N, ctx: NodeContext): NodeOutputs | undefined;
  /** The one list this node works through, or undefined when it does not loop. */
  loopList(node: N, ctx: NodeContext): LoopList | undefined;
  /** Is its catalog entry resolvable? Type checking is skipped when not. */
  configured(node: N, ctx: NodeContext): boolean;
  checkTypes(node: N, ctx: NodeContext): WorkflowIssue[];
  checkConfig(node: N, ctx: NodeContext): WorkflowIssue[];
}

function clauseValues(clauses: Clause[], prefix: string): ValueSite[] {
  return clauses.flatMap((clause, index) => [
    { value: clause.left, field: `${prefix}.${index}.left` },
    { value: clause.right, field: `${prefix}.${index}.right` }
  ]);
}

function inputValues(inputs: Record<string, ValueOrRef>): ValueSite[] {
  return Object.entries(inputs).map(([field, value]) => ({ value, field }));
}

/** A bad source is reported by the filter's own `checkTypes`/`checkConfig`. */
function filterLoopList(node: FilterNode, ctx: NodeContext): LoopList {
  if (node.data.source === undefined) return { failure: "unconfigured" };
  const source = ctx.resolveValue(node.data.source, node.id);
  if ("type" in source && source.type.kind === "list") {
    return { type: source.type };
  }
  return { failure: "unconfigured" };
}

/** Item-reading inputs are skipped, so resolving the item never recurses. */
function actionLoopList(
  node: ActionNode,
  ctx: NodeContext
): LoopList | undefined {
  if (!node.data.batch) return undefined;
  const lists = Object.values(node.data.inputs).flatMap((input) => {
    if (input.kind === "item") return [];
    const type = ctx.typeOf(input, node.id);
    return type !== undefined && type.kind === "list" ? [type] : [];
  });
  const only = lists.length === 1 ? lists[0] : undefined;
  return only === undefined ? { failure: "unconfigured" } : { type: only };
}

function checkClauses(
  node: WorkflowNode,
  clauses: Clause[],
  prefix: string,
  ctx: NodeContext
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];

  clauses.forEach((clause, index) => {
    const field = `${prefix}.${index}`;
    const left = ctx.typeOf(clause.left, node.id);
    if (left === undefined) return;

    if (!operatorsForType(left).includes(clause.operator)) {
      issues.push({
        code: "TYPE_MISMATCH",
        nodeId: node.id,
        field: `${field}.operator`,
        message: `"${clause.operator}" is not a test you can apply to ${describeType(left)}.`
      });
      return;
    }

    const right = ctx.typeOf(clause.right, node.id);
    if (right === undefined) return;
    // `contains` on a list tests membership, so the right side is one item.
    const expected =
      left.kind === "list" && clause.operator === "contains" ? left.of : left;
    if (!typesEqual(right, expected)) {
      issues.push({
        code: "TYPE_MISMATCH",
        nodeId: node.id,
        field: `${field}.right`,
        message: `This compares ${describeType(left)} against ${describeType(right)}.`
      });
    }
  });

  return issues;
}

function checkInputs(
  node: WorkflowNode,
  inputs: Record<string, ValueOrRef>,
  declared: Record<string, CatalogInput>,
  batching: boolean,
  ctx: NodeContext
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];

  for (const [name, declaration] of Object.entries(declared)) {
    const supplied = inputs[name];
    if (supplied === undefined) {
      if (declaration.required) {
        issues.push({
          code: "MISSING_INPUT",
          nodeId: node.id,
          field: name,
          message: `"${name}" needs a value before this step can run.`
        });
      }
      continue;
    }

    const type = ctx.typeOf(supplied, node.id);
    if (type === undefined) continue;

    if (declaration.type.kind !== "list" && type.kind === "list") {
      if (batching && typesEqual(type.of, declaration.type)) continue;
      issues.push({
        code: "LIST_INTO_SINGLE",
        nodeId: node.id,
        field: name,
        message: `"${name}" takes one ${describeType(declaration.type)}, but this is ${describeType(type)}. Turn on batch mode to run once per item.`
      });
      continue;
    }

    if (!typesEqual(type, declaration.type)) {
      issues.push({
        code: "TYPE_MISMATCH",
        nodeId: node.id,
        field: name,
        message: `"${name}" takes ${describeType(declaration.type)}, but this is ${describeType(type)}.`
      });
    }
  }

  return issues;
}

const incomplete = (
  node: WorkflowNode,
  field: string,
  message: string
): WorkflowIssue => ({
  code: "INCOMPLETE_CONFIG",
  nodeId: node.id,
  field,
  message
});

/** Only outputs every event supplies at the same type; the rest may be absent at run time. */
function intersectOutputs(a: NodeOutputs, b: NodeOutputs): NodeOutputs {
  const shared: NodeOutputs = {};
  for (const [name, type] of Object.entries(a)) {
    const other = b[name];
    if (other !== undefined && typesEqual(type, other)) shared[name] = type;
  }
  return shared;
}

export const NODE_KINDS: {
  [K in WorkflowNodeType]: NodeKind<Extract<WorkflowNode, { type: K }>>;
} = {
  trigger: {
    handles: () => [DEFAULT_HANDLE],
    values: () => [],
    outputs: (node, ctx) => {
      if (node.data.schedule !== undefined) return {};
      const events = node.data.events.map((id) => ctx.catalog.getEvent(id));
      const [first, ...rest] = events;
      if (first === undefined) return undefined;
      let shared = { ...first.outputs };
      for (const event of rest) {
        if (event === undefined) return undefined;
        shared = intersectOutputs(shared, event.outputs);
      }
      return shared;
    },
    loopList: () => undefined,
    configured: (node, ctx) =>
      node.data.schedule !== undefined ||
      (node.data.events.length > 0 &&
        node.data.events.every((id) => ctx.catalog.getEvent(id) !== undefined)),
    checkTypes: () => [],
    checkConfig: (node, ctx) =>
      node.data.events
        .filter((eventId) => ctx.catalog.getEvent(eventId) === undefined)
        .map((eventId) => ({
          code: "UNKNOWN_EVENT" as const,
          nodeId: node.id,
          field: eventId,
          message: `"${eventId}" is not something we can watch for any more.`
        }))
  },

  condition: {
    handles: (node) => node.data.paths.map((path) => path.id),
    values: (node) =>
      node.data.paths.flatMap((path) =>
        clauseValues(path.clauses, `paths.${path.id}.clauses`)
      ),
    outputs: () => ({}),
    loopList: () => undefined,
    configured: () => true,
    checkTypes: (node, ctx) =>
      node.data.paths.flatMap((path) =>
        checkClauses(node, path.clauses, `paths.${path.id}.clauses`, ctx)
      ),
    checkConfig: (node) => {
      if (node.data.paths.length === 0) {
        return [
          incomplete(node, "paths", "Add at least one branch to this check.")
        ];
      }
      return node.data.paths
        .filter((path) => path.kind !== "else" && path.clauses.length === 0)
        .map((path) =>
          incomplete(
            node,
            `paths.${path.id}.clauses`,
            "This branch has nothing to check."
          )
        );
    }
  },

  entity: {
    handles: () => [DEFAULT_HANDLE],
    values: (node) => inputValues(node.data.inputs),
    outputs: (node, ctx) => {
      const operation = ctx.catalog.getOperation(node.data.operation);
      return operation === undefined
        ? undefined
        : { [DEFAULT_OUTPUT]: operation.output };
    },
    loopList: () => undefined,
    configured: (node, ctx) =>
      ctx.catalog.getOperation(node.data.operation) !== undefined,
    checkTypes: (node, ctx) => {
      const operation = ctx.catalog.getOperation(node.data.operation);
      return operation === undefined
        ? []
        : checkInputs(node, node.data.inputs, operation.inputs, false, ctx);
    },
    checkConfig: (node, ctx) => {
      if (node.data.operation.length === 0) {
        return [incomplete(node, "operation", "Choose what to work out.")];
      }
      if (ctx.catalog.getOperation(node.data.operation) !== undefined)
        return [];
      return [
        {
          code: "UNKNOWN_OPERATION",
          nodeId: node.id,
          field: "operation",
          message: `"${node.data.operation}" is not something we can work out any more.`
        }
      ];
    }
  },

  lookup: {
    handles: () => [SUCCESS_HANDLE, FAILURE_HANDLE],
    values: (node) => clauseValues(node.data.match, "match"),
    outputs: (node, ctx) => {
      const entity = ctx.catalog.getEntity(node.data.entity);
      if (entity === undefined) return undefined;
      const one: ValueType = { kind: "entity", of: entity.name };
      return {
        [DEFAULT_OUTPUT]:
          node.data.returns === "list" ? { kind: "list", of: one } : one
      };
    },
    loopList: () => undefined,
    configured: (node, ctx) =>
      ctx.catalog.getEntity(node.data.entity) !== undefined,
    checkTypes: (node, ctx) =>
      checkClauses(node, node.data.match, "match", ctx),
    checkConfig: (node, ctx) => {
      if (node.data.entity.length === 0) {
        return [
          incomplete(node, "entity", "Choose what kind of record to find.")
        ];
      }
      if (ctx.catalog.getEntity(node.data.entity) !== undefined) return [];
      return [
        {
          code: "UNKNOWN_ENTITY",
          nodeId: node.id,
          field: "entity",
          message: `"${node.data.entity}" is not a kind of record we know.`
        }
      ];
    }
  },

  filter: {
    handles: () => [DEFAULT_HANDLE],
    values: (node) => [
      ...(node.data.source === undefined
        ? []
        : [{ value: node.data.source, field: "source" }]),
      ...clauseValues(node.data.clauses, "clauses")
    ],
    outputs: (node, ctx) => {
      const list = filterLoopList(node, ctx);
      return "type" in list ? { [DEFAULT_OUTPUT]: list.type } : undefined;
    },
    loopList: filterLoopList,
    // A filter has no catalog entry to be missing.
    configured: () => true,
    checkTypes: (node, ctx) => {
      if (node.data.source === undefined) return [];
      const source = ctx.typeOf(node.data.source, node.id);
      if (source === undefined) return [];
      if (source.kind !== "list") {
        return [
          {
            code: "TYPE_MISMATCH",
            nodeId: node.id,
            field: "source",
            message: `A filter works through a list, but this is ${describeType(source)}.`
          }
        ];
      }
      return checkClauses(node, node.data.clauses, "clauses", ctx);
    },
    checkConfig: (node) =>
      node.data.source === undefined
        ? [incomplete(node, "source", "Choose the list to filter.")]
        : []
  },

  action: {
    handles: () => [SUCCESS_HANDLE, FAILURE_HANDLE],
    values: (node) => inputValues(node.data.inputs),
    outputs: (node, ctx) => ctx.catalog.getAction(node.data.action)?.outputs,
    loopList: actionLoopList,
    configured: (node, ctx) =>
      ctx.catalog.getAction(node.data.action) !== undefined,
    checkTypes: (node, ctx) => {
      const action = ctx.catalog.getAction(node.data.action);
      return action === undefined
        ? []
        : checkInputs(
            node,
            node.data.inputs,
            action.inputs,
            node.data.batch && action.batchable,
            ctx
          );
    },
    checkConfig: (node, ctx) => {
      if (node.data.action.length === 0) {
        return [incomplete(node, "action", "Choose what this step should do.")];
      }
      if (ctx.catalog.getAction(node.data.action) === undefined) {
        return [
          {
            code: "UNKNOWN_ACTION",
            nodeId: node.id,
            field: "action",
            message: `"${node.data.action}" is not something we can do any more.`
          }
        ];
      }
      if (node.data.batch) {
        const loop = ctx.loopListOf(node.id);
        if (loop === undefined || !("type" in loop)) {
          return [
            incomplete(
              node,
              "batch",
              "A step that repeats needs exactly one list to repeat over."
            )
          ];
        }
      }
      return [];
    }
  }
};

// Cast: TypeScript cannot see that `NODE_KINDS[node.type]` and `node` narrow to
// the same member of the union.
function kindOf<N extends WorkflowNode>(node: N): NodeKind<N> {
  return NODE_KINDS[node.type] as unknown as NodeKind<N>;
}

export const getNodeHandles = (node: WorkflowNode): string[] =>
  kindOf(node).handles(node);

export const getNodeValues = (node: WorkflowNode): ValueSite[] =>
  kindOf(node).values(node);

export const getNodeOutputs = (
  node: WorkflowNode,
  ctx: NodeContext
): NodeOutputs | undefined => kindOf(node).outputs(node, ctx);

export const getNodeLoopList = (
  node: WorkflowNode,
  ctx: NodeContext
): LoopList | undefined => kindOf(node).loopList(node, ctx);

export const isNodeConfigured = (
  node: WorkflowNode,
  ctx: NodeContext
): boolean => kindOf(node).configured(node, ctx);

export const checkNodeTypes = (
  node: WorkflowNode,
  ctx: NodeContext
): WorkflowIssue[] => kindOf(node).checkTypes(node, ctx);

export const checkNodeConfig = (
  node: WorkflowNode,
  ctx: NodeContext
): WorkflowIssue[] => kindOf(node).checkConfig(node, ctx);
