import type { CatalogInput, WorkflowCatalog } from "./catalog";
import type { WorkflowIssue } from "./issues";
import {
  DEFAULT_HANDLE,
  DEFAULT_OUTPUT,
  FAILURE_HANDLE,
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
  type ValueType,
  type VariableRef
} from "./types";

export type NodeOutputs = Record<string, ValueType>;

/**
 * Why a reference could not be resolved. `unconfigured` means the node it points
 * at has no catalog entry, so its outputs are unknowable and the config layer
 * reports that instead — showing both would be two problems where there is one.
 */
export type ResolveFailure =
  | "unknown-node"
  | "not-upstream"
  | "unknown"
  | "unconfigured";

export type ResolvedRef = { type: ValueType } | { failure: ResolveFailure };

/** One place a node reads a value from elsewhere, and the field it sits in. */
export interface RefSite {
  ref: VariableRef;
  field: string;
}

/**
 * What a node needs to know about the rest of the definition in order to answer
 * questions about itself. Implemented by the resolver in `validate.ts`; declared
 * here so node behaviour never has to import the validator.
 */
export interface NodeContext {
  catalog: WorkflowCatalog;
  resolveRef(ref: VariableRef, atNodeId: string): ResolvedRef;
  typeOf(value: ValueOrRef, atNodeId: string): ValueType | undefined;
  outputsOf(nodeId: string): NodeOutputs | undefined;
}

/**
 * Everything one kind of node declares about itself. Keeping the six behaviours
 * together means adding a node type is a single entry in `NODE_KINDS` rather
 * than six switches to remember, and the mapped type below makes forgetting one
 * a compile error instead of a node that silently validates clean.
 */
interface NodeKind<N extends WorkflowNode> {
  /** Outgoing connection points, by name. */
  handles(node: N): string[];
  /** Every value this node reads from somewhere else. */
  refs(node: N): RefSite[];
  /** What it hands onward; `undefined` when its catalog entry is missing. */
  outputs(node: N, ctx: NodeContext): NodeOutputs | undefined;
  /** Is its catalog entry resolvable? Type checking is skipped when not. */
  configured(node: N, ctx: NodeContext): boolean;
  /** Are the values plugged into it the kind of values that fit? */
  checkTypes(node: N, ctx: NodeContext): WorkflowIssue[];
  /** Is anything left unchosen, or chosen but no longer offered? */
  checkConfig(node: N, ctx: NodeContext): WorkflowIssue[];
}

// ---------------------------------------------------------------------------
// Shared checks — clauses (condition, lookup, filter) and inputs (entity, action)
// ---------------------------------------------------------------------------

function clauseRefs(clauses: Clause[], prefix: string): RefSite[] {
  const refs: RefSite[] = [];
  clauses.forEach((clause, index) => {
    if (clause.left.kind === "ref") {
      refs.push({ ref: clause.left, field: `${prefix}.${index}.left` });
    }
    if (clause.right.kind === "ref") {
      refs.push({ ref: clause.right, field: `${prefix}.${index}.right` });
    }
  });
  return refs;
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

/**
 * The narrowest promise a trigger listening to several events can make: only the
 * outputs every event supplies, at the same type. Anything else could be absent
 * at run time depending on which event fired.
 */
function intersectOutputs(a: NodeOutputs, b: NodeOutputs): NodeOutputs {
  const shared: NodeOutputs = {};
  for (const [name, type] of Object.entries(a)) {
    const other = b[name];
    if (other !== undefined && typesEqual(type, other)) shared[name] = type;
  }
  return shared;
}

// ---------------------------------------------------------------------------
// The node kinds
// ---------------------------------------------------------------------------

export const NODE_KINDS: {
  [K in WorkflowNodeType]: NodeKind<Extract<WorkflowNode, { type: K }>>;
} = {
  trigger: {
    handles: () => [DEFAULT_HANDLE],
    refs: () => [],
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
    refs: (node) =>
      node.data.paths.flatMap((path) =>
        clauseRefs(path.clauses, `paths.${path.id}.clauses`)
      ),
    outputs: () => ({}),
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
    refs: (node) =>
      Object.entries(node.data.inputs).flatMap(([field, value]) =>
        value.kind === "ref" ? [{ ref: value, field }] : []
      ),
    outputs: (node, ctx) => {
      const operation = ctx.catalog.getOperation(node.data.operation);
      return operation === undefined
        ? undefined
        : { [DEFAULT_OUTPUT]: operation.output };
    },
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
    refs: (node) => clauseRefs(node.data.match, "match"),
    outputs: (node, ctx) => {
      const entity = ctx.catalog.getEntity(node.data.entity);
      if (entity === undefined) return undefined;
      const one: ValueType = { kind: "entity", of: entity.name };
      return {
        [DEFAULT_OUTPUT]:
          node.data.returns === "list" ? { kind: "list", of: one } : one
      };
    },
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
    refs: (node) => [
      ...(node.data.source === undefined
        ? []
        : [{ ref: node.data.source, field: "source" }]),
      ...clauseRefs(node.data.clauses, "clauses")
    ],
    outputs: (node, ctx) => {
      if (node.data.source === undefined) return undefined;
      const source = ctx.resolveRef(node.data.source, node.id);
      if (!("type" in source) || source.type.kind !== "list") return undefined;
      return { [DEFAULT_OUTPUT]: source.type };
    },
    // A filter has no catalog entry to be missing; a bad source is a type error
    // it reports itself, below.
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
    refs: (node) =>
      Object.entries(node.data.inputs).flatMap(([field, value]) =>
        value.kind === "ref" ? [{ ref: value, field }] : []
      ),
    outputs: (node, ctx) => ctx.catalog.getAction(node.data.action)?.outputs,
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
      if (ctx.catalog.getAction(node.data.action) !== undefined) return [];
      return [
        {
          code: "UNKNOWN_ACTION",
          nodeId: node.id,
          field: "action",
          message: `"${node.data.action}" is not something we can do any more.`
        }
      ];
    }
  }
};

/**
 * The one cast in the dispatch. TypeScript cannot see that `NODE_KINDS[n.type]`
 * and `n` are narrowed to the same member of the union, so each accessor asserts
 * it once here instead of every call site re-deriving it with a switch.
 */
function kindOf<N extends WorkflowNode>(node: N): NodeKind<N> {
  return NODE_KINDS[node.type] as unknown as NodeKind<N>;
}

export const getNodeHandles = (node: WorkflowNode): string[] =>
  kindOf(node).handles(node);

export const getNodeRefs = (node: WorkflowNode): RefSite[] =>
  kindOf(node).refs(node);

export const getNodeOutputs = (
  node: WorkflowNode,
  ctx: NodeContext
): NodeOutputs | undefined => kindOf(node).outputs(node, ctx);

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
