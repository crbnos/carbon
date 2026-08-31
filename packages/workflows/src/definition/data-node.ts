import { walkPath } from "./catalog";
import {
  DATA_OPERATIONS,
  type DataOperation,
  operationOf as sharedOperationOf
} from "./data-operations";
import {
  checkClauses,
  clauseConfigIssues,
  clauseValues,
  incomplete,
  type LoopList,
  type NodeContext,
  type NodeKind,
  type NodeOutputs
} from "./nodes";
import { DEFAULT_HANDLE, DEFAULT_OUTPUT, type FilterNode } from "./schema";
import { describeType, rendersAsText, type ValueType } from "./types";

/**
 * The data node — filtering, counting, picking and projecting over a list.
 *
 * Its stored `type` is still `"filter"`: widening the node that already owned
 * `loopList` and `ItemRef` was the whole point, so a saved workflow needs no
 * migration and there is only ever ONE thing "the current item" can mean.
 *
 * Lives beside `nodes.ts` rather than inside it because six operations across four
 * hooks is more than a kind block should be, and `runtime/` already splits one file
 * per node kind.
 */

/**
 * Which operation this node performs.
 *
 * The zod default only applies to a definition that was PARSED. The builder holds
 * raw node objects in memory — a node just dropped on the canvas, or one loaded
 * before this field existed — so the key can genuinely be absent here, and reading
 * it unguarded made `DATA_OPERATIONS[undefined]` and produced no outputs at all.
 */
const operationOf = (node: FilterNode): DataOperation =>
  sharedOperationOf(node.data.operation);

/** The type each operation hands onward, or `undefined` when the source cannot
 * support it — which reads as "not configured" and suppresses downstream errors. */
function resultType(node: FilterNode, ctx: NodeContext): ValueType | undefined {
  const source =
    node.data.source === undefined
      ? undefined
      : ctx.typeOf(node.data.source, node.id);
  if (source === undefined || source.kind !== "list") return undefined;

  switch (operationOf(node)) {
    case "filter":
      return source;
    case "count":
      return { kind: "primitive", of: "number" };
    case "first":
    case "last":
      return source.of;
    case "pluck": {
      // Only an object or a record has fields to take. A list of plain values has
      // nothing to project, and letting it through produced a list of nulls.
      if (source.of.kind !== "record" && source.of.kind !== "entity") {
        return undefined;
      }
      const field = node.data.field;
      if (field === undefined || field.trim() === "") return undefined;
      const picked = walkPath(source.of, field.split("."), ctx.catalog);
      if (picked === undefined) return undefined;
      // A field that is itself a list can only be projected FLAT: `list<list<T>>`
      // has no representation, so without flattening there is nothing to return.
      if (picked.kind === "list") {
        return node.data.flatten ? picked : undefined;
      }
      return { kind: "list", of: picked };
    }
    case "join":
      // Anything with a reading in a sentence can be joined — that is exactly what
      // `rendersAsText` decides, and it is what the template renderer already uses.
      // Requiring a primitive refused a list of Carbon records, each of which reads
      // perfectly well as its display name. An OBJECT still has no such reading.
      return rendersAsText(source.of)
        ? { kind: "primitive", of: "string" }
        : undefined;
  }
}

/** Only `filter` walks the list item by item, so only it exposes a loop item. */
function dataLoopList(
  node: FilterNode,
  ctx: NodeContext
): LoopList | undefined {
  if (!DATA_OPERATIONS[operationOf(node)].loops) return undefined;
  if (node.data.source === undefined) return { failure: "unconfigured" };
  const source = ctx.resolveValue(node.data.source, node.id);
  if ("type" in source && source.type.kind === "list") {
    return { type: source.type };
  }
  return { failure: "unconfigured" };
}

function dataOutputs(
  node: FilterNode,
  ctx: NodeContext
): NodeOutputs | undefined {
  const type = resultType(node, ctx);
  return type === undefined ? undefined : { [DEFAULT_OUTPUT]: type };
}

export const dataNodeKind: NodeKind<FilterNode> = {
  handles: () => [DEFAULT_HANDLE],
  values: (node) => [
    ...(node.data.source === undefined
      ? []
      : [{ value: node.data.source, field: "source" }]),
    // Clauses only exist for filtering; another operation never stores one.
    ...(DATA_OPERATIONS[operationOf(node)].usesClauses
      ? clauseValues(node.data.clauses, "clauses")
      : [])
  ],
  outputs: dataOutputs,
  loopList: dataLoopList,
  // A data node has no catalog entry to be missing.
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
          message: `This step works through a list, but this is ${describeType(source)}.`
        }
      ];
    }

    const spec = DATA_OPERATIONS[operationOf(node)];

    if (
      spec.usesField &&
      source.of.kind !== "record" &&
      source.of.kind !== "entity"
    ) {
      return [
        {
          code: "TYPE_MISMATCH",
          nodeId: node.id,
          field: "source",
          message: `${describeType(source)} has no fields to take — its items are single values.`
        }
      ];
    }

    if (spec.usesField && node.data.field !== undefined) {
      const picked = walkPath(
        source.of,
        node.data.field.split("."),
        ctx.catalog
      );
      if (picked === undefined) {
        return [
          {
            code: "TYPE_MISMATCH",
            nodeId: node.id,
            field: "field",
            message: `The items in that list have no "${node.data.field}".`
          }
        ];
      }
      if (picked.kind === "list" && !node.data.flatten) {
        return [
          {
            code: "TYPE_MISMATCH",
            nodeId: node.id,
            field: "field",
            message: `"${node.data.field}" is itself a list, so it can only be taken as one combined list.`
          }
        ];
      }
    }

    if (operationOf(node) === "join" && !rendersAsText(source.of)) {
      return [
        {
          code: "TYPE_MISMATCH",
          nodeId: node.id,
          field: "source",
          message: `The items in ${describeType(source)} have no reading as text, so they cannot be joined.`
        }
      ];
    }

    return spec.usesClauses
      ? checkClauses(node, node.data.clauses, "clauses", ctx)
      : [];
  },
  checkConfig: (node) => {
    if (node.data.source === undefined) {
      return [incomplete(node, "source", "Choose the list to work through.")];
    }
    const spec = DATA_OPERATIONS[operationOf(node)];
    if (spec.usesField && (node.data.field ?? "").trim() === "") {
      return [incomplete(node, "field", "Choose which field to take.")];
    }
    return spec.usesClauses
      ? clauseConfigIssues(node, node.data.clauses, "clauses")
      : [];
  }
};
