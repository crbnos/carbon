import { type BatchPlan, batchPlan } from "./batch";
import type { CatalogInput, WorkflowCatalog } from "./catalog";
import type { WorkflowIssue } from "./issues";
import {
  type ActionNode,
  type ComputeNode,
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
  canAssign,
  describeType,
  expectedClauseRightType,
  operatorsForType,
  type ScalarType,
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

/** Names that frame the request rather than describe it. Letting a customer set one
 * changes how the message is delivered, not what it says. */
const RESERVED_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "keep-alive",
  "proxy-authorization"
]);

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
    ...(clause.right === undefined
      ? []
      : [{ value: clause.right, field: `${prefix}.${index}.right` }])
  ]);
}

/** A draft may save a clause with no right-hand side; publishing one may not. */
function clauseConfigIssues(
  node: WorkflowNode,
  clauses: Clause[],
  prefix: string
): WorkflowIssue[] {
  return clauses.flatMap((clause, index) =>
    clause.right === undefined
      ? [
          incomplete(
            node,
            `${prefix}.${index}.right`,
            "Choose what to compare this against."
          )
        ]
      : []
  );
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

/** The first operation input wired to a list where the operation expects a single value.
 * When set, the compute node runs the operation once per list item and returns a list. */
function computeBatchInput(
  node: ComputeNode,
  ctx: NodeContext
): string | undefined {
  const operation = ctx.catalog.getOperation(node.data.operation);
  if (operation === undefined) return undefined;
  for (const [name, inputDecl] of Object.entries(operation.inputs)) {
    if (inputDecl.type.kind === "list") continue; // already expects a list
    const supplied = node.data.inputs[name];
    if (supplied === undefined || supplied.kind === "item") continue;
    const resolved = ctx.resolveValue(supplied, node.id);
    if ("type" in resolved && resolved.type.kind === "list") return name;
  }
  return undefined;
}

/** The wiring decides whether an action repeats; nothing is stored. */
function actionBatchPlan(node: ActionNode, ctx: NodeContext): BatchPlan {
  const action = ctx.catalog.getAction(node.data.action);
  if (action === undefined) return { kind: "none" };
  return batchPlan(action, node.data.inputs, (name) => {
    const supplied = node.data.inputs[name];
    return supplied === undefined ? undefined : ctx.typeOf(supplied, node.id);
  });
}

function actionLoopList(
  node: ActionNode,
  ctx: NodeContext
): LoopList | undefined {
  // With no catalog entry there is nothing to read the wiring against. `unconfigured`
  // is suppressed, so an item ref reports the missing action rather than piling on.
  if (ctx.catalog.getAction(node.data.action) === undefined) {
    return { failure: "unconfigured" };
  }
  const plan = actionBatchPlan(node, ctx);
  if (plan.kind === "none") return undefined;
  return plan.kind === "repeats"
    ? { type: plan.type }
    : { failure: "unconfigured" };
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

    // An absent right-hand side is a completeness problem, not a type one.
    if (clause.right === undefined) return;
    const right = ctx.typeOf(clause.right, node.id);
    if (right === undefined) return;
    const expected = expectedClauseRightType(left, clause.operator);
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

  /** Literal-only: a gate whose target holds a variable cannot be read here, so it opens. */
  const gateValue = (declaration: CatalogInput): string | undefined => {
    const gate = declaration.showWhen;
    if (gate === undefined) return undefined;
    const target = inputs[gate.input];
    if (target === undefined || target.kind !== "literal") return undefined;
    if (typeof target.value !== "string") return undefined;
    return gate.equals.includes(target.value) ? undefined : target.value;
  };

  for (const [name, declaration] of Object.entries(declared)) {
    const supplied = inputs[name];

    const closedBy = gateValue(declaration);
    if (closedBy !== undefined) {
      if (supplied !== undefined) {
        issues.push({
          code: "INCOMPLETE_CONFIG",
          nodeId: node.id,
          field: name,
          message: `"${name}" does not apply when ${declaration.showWhen?.input} is "${closedBy}". Clear it to continue.`
        });
      }
      continue;
    }

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

    if (supplied.kind === "pairs" || declaration.pairs === true) {
      if (supplied.kind !== "pairs") {
        issues.push({
          code: "TYPE_MISMATCH",
          nodeId: node.id,
          field: name,
          message: `"${name}" takes a list of names and values.`
        });
        continue;
      }
      if (declaration.pairs !== true) {
        issues.push({
          code: "TYPE_MISMATCH",
          nodeId: node.id,
          field: name,
          message: `"${name}" does not take a list of names and values.`
        });
        continue;
      }
      const seen = new Set<string>();
      supplied.entries.forEach((entry, index) => {
        const field = `${name}.entries.${index}`;
        const key = entry.name.trim().toLowerCase();
        if (key === "") {
          issues.push({
            code: "INCOMPLETE_CONFIG",
            nodeId: node.id,
            field,
            message: "This row needs a name."
          });
          return;
        }
        if (RESERVED_HEADER_NAMES.has(key)) {
          issues.push({
            code: "INCOMPLETE_CONFIG",
            nodeId: node.id,
            field,
            message: `"${entry.name}" is set by Carbon and cannot be changed here.`
          });
          return;
        }
        if (seen.has(key)) {
          issues.push({
            code: "INCOMPLETE_CONFIG",
            nodeId: node.id,
            field,
            message: `"${entry.name}" is set twice.`
          });
          return;
        }
        seen.add(key);
      });
      continue;
    }

    if (supplied.kind === "template") {
      if (
        declaration.type.kind === "primitive" &&
        declaration.type.of === "string"
      ) {
        continue;
      }
      issues.push({
        code: "TYPE_MISMATCH",
        nodeId: node.id,
        field: name,
        message: `"${name}" takes ${describeType(declaration.type)}, and a message can only be text.`
      });
      continue;
    }

    const type = ctx.typeOf(supplied, node.id);
    if (type === undefined) continue;

    if (declaration.type.kind !== "list" && type.kind === "list") {
      if (canAssign(type, declaration.type, { batching })) continue;
      issues.push({
        code: "LIST_INTO_SINGLE",
        nodeId: node.id,
        field: name,
        message: `"${name}" takes one ${describeType(declaration.type)}, but this is ${describeType(type)}. This step cannot work through a list.`
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

    if (
      declaration.choices !== undefined &&
      supplied.kind === "literal" &&
      typeof supplied.value === "string" &&
      !declaration.choices.includes(supplied.value)
    ) {
      issues.push({
        code: "INCOMPLETE_CONFIG",
        message: `"${supplied.value}" is not a valid ${name}.`,
        nodeId: node.id,
        field: `inputs.${name}`
      });
    }
  }

  // Without this a definition could quietly carry a field the executor would drop.
  for (const name of Object.keys(inputs)) {
    if (declared[name] !== undefined) continue;
    issues.push({
      code: "UNKNOWN_INPUT",
      nodeId: node.id,
      field: name,
      message: `"${name}" is not something this step can set.`
    });
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

export const NODE_KINDS: {
  [K in WorkflowNodeType]: NodeKind<Extract<WorkflowNode, { type: K }>>;
} = {
  trigger: {
    handles: () => [DEFAULT_HANDLE],
    values: () => [],
    outputs: (node, ctx) => {
      if (node.data.schedule !== undefined) return {};
      const eventId = node.data.events[0];
      if (eventId === undefined) return undefined;
      const event = ctx.catalog.getEvent(eventId);
      if (event === undefined) return undefined;
      return { ...event.outputs };
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
      const empty = node.data.paths
        .filter((path) => path.kind !== "else" && path.clauses.length === 0)
        .map((path) =>
          incomplete(
            node,
            `paths.${path.id}.clauses`,
            "This branch has nothing to check."
          )
        );
      if (empty.length > 0) return empty;
      return node.data.paths.flatMap((path) =>
        clauseConfigIssues(node, path.clauses, `paths.${path.id}.clauses`)
      );
    }
  },

  compute: {
    handles: () => [DEFAULT_HANDLE],
    values: (node) => inputValues(node.data.inputs),
    outputs: (node, ctx) => {
      const operation = ctx.catalog.getOperation(node.data.operation);
      if (operation === undefined) return undefined;
      const batchInput = computeBatchInput(node, ctx);
      if (batchInput !== undefined && operation.output.kind !== "list") {
        return {
          [DEFAULT_OUTPUT]: { kind: "list", of: operation.output as ScalarType }
        };
      }
      return { [DEFAULT_OUTPUT]: operation.output };
    },
    loopList: (node, ctx) => {
      const operation = ctx.catalog.getOperation(node.data.operation);
      if (operation === undefined) return { failure: "unconfigured" };
      const batchInput = computeBatchInput(node, ctx);
      if (batchInput === undefined || operation.output.kind === "list")
        return undefined;
      return { type: { kind: "list", of: operation.output as ScalarType } };
    },
    configured: (node, ctx) =>
      ctx.catalog.getOperation(node.data.operation) !== undefined,
    checkTypes: (node, ctx) => {
      const operation = ctx.catalog.getOperation(node.data.operation);
      if (operation === undefined) return [];
      const batchInput = computeBatchInput(node, ctx);
      return checkInputs(
        node,
        node.data.inputs,
        operation.inputs,
        batchInput !== undefined,
        ctx
      );
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
    values: (node) =>
      node.data.match.flatMap((rule, index) =>
        rule.value === undefined
          ? []
          : [{ value: rule.value, field: `match.${index}.value` }]
      ),
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
    checkTypes: (node, ctx) => {
      const entity = ctx.catalog.getEntity(node.data.entity);
      if (entity === undefined) return [];
      const issues: WorkflowIssue[] = [];

      node.data.match.forEach((rule, index) => {
        const field = `match.${index}`;
        // A blank rule is reported by `checkConfig`; typing it would be noise.
        if (rule.field === "" || rule.value === undefined) return;
        const property = entity.properties[rule.field];
        if (property === undefined) {
          issues.push({
            code: "UNKNOWN_INPUT",
            nodeId: node.id,
            field: `${field}.field`,
            message: `A ${entity.name} has no "${rule.field}".`
          });
          return;
        }

        if (!operatorsForType(property).includes(rule.operator)) {
          issues.push({
            code: "TYPE_MISMATCH",
            nodeId: node.id,
            field: `${field}.operator`,
            message: `"${rule.operator}" is not a test you can apply to ${describeType(property)}.`
          });
          return;
        }

        const supplied = ctx.typeOf(rule.value, node.id);
        if (supplied === undefined) return;
        // `contains` on a list tests membership, so the value is one item.
        const expected =
          property.kind === "list" && rule.operator === "contains"
            ? property.of
            : property;
        if (!typesEqual(supplied, expected)) {
          issues.push({
            code: "TYPE_MISMATCH",
            nodeId: node.id,
            field: `${field}.value`,
            message: `This compares ${describeType(property)} against ${describeType(supplied)}.`
          });
        }
      });

      return issues;
    },
    checkConfig: (node, ctx) => {
      if (node.data.entity.length === 0) {
        return [
          incomplete(node, "entity", "Choose what kind of record to find.")
        ];
      }
      if (ctx.catalog.getEntity(node.data.entity) === undefined) {
        return [
          {
            code: "UNKNOWN_ENTITY",
            nodeId: node.id,
            field: "entity",
            message: `"${node.data.entity}" is not a kind of record we know.`
          }
        ];
      }
      const issues: WorkflowIssue[] = [];
      node.data.match.forEach((rule, index) => {
        if (rule.field === "") {
          issues.push(
            incomplete(
              node,
              `match.${index}.field`,
              "Choose which property to match on."
            )
          );
          return;
        }
        if (rule.value === undefined) {
          issues.push(
            incomplete(
              node,
              `match.${index}.value`,
              "Choose what to match this property against."
            )
          );
          return;
        }
        const choices = ctx.catalog.getEnum(node.data.entity, rule.field);
        if (
          choices !== undefined &&
          rule.value.kind === "literal" &&
          typeof rule.value.value === "string" &&
          !choices.includes(rule.value.value)
        ) {
          issues.push({
            code: "INCOMPLETE_CONFIG",
            message: `"${rule.value.value}" is not a valid ${rule.field}.`,
            nodeId: node.id,
            field: `match.${index}.value`
          });
        }
      });
      return issues;
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
        : clauseConfigIssues(node, node.data.clauses, "clauses")
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
      if (action === undefined) return [];
      // Ambiguity counts as batching here so two wired lists raise the one issue that
      // explains them, rather than that issue plus a rejection of each list.
      const batching = actionBatchPlan(node, ctx).kind !== "none";
      return checkInputs(node, node.data.inputs, action.inputs, batching, ctx);
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
      const plan = actionBatchPlan(node, ctx);
      if (plan.kind === "ambiguous") {
        return [
          incomplete(
            node,
            // Blamed on the second list, since the first was already working.
            plan.second,
            `Lists are wired into both "${plan.first}" and "${plan.second}", so this step cannot tell which one to repeat over.`
          )
        ];
      }
      const action = ctx.catalog.getAction(node.data.action);
      for (const group of action?.requireOneOf ?? []) {
        if (group.some((name) => node.data.inputs[name] !== undefined))
          continue;
        return [
          incomplete(
            node,
            group[0] ?? "inputs",
            `This step needs at least one of: ${group.join(", ")}.`
          )
        ];
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
