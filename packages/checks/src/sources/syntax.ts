// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Directive,
  type Node,
  type ParseResult,
  type ParserOptions,
  parseSync,
  rawTransferSupported,
  type Statement,
  type StaticMemberExpression,
  visitorKeys
} from "oxc-parser";

// A rule about TypeScript syntax that is not an oxlint rule reads the tree
// oxc's parser returns (ESTree, with the TypeScript and JSX node types). Every
// node has `type`, and `start` / `end` as offsets into the text it was parsed
// from, so `contents.slice(node.start, node.end)` is its source.

export type { Node };

/**
 * The parsed file: `program` (the tree), `comments`, and `module` (its imports
 * and exports, already read). The file name decides the language: `.tsx` is
 * parsed with JSX. A file with syntax errors still returns the tree the parser
 * recovered.
 */
export function parseTypescript(file: string, contents: string): ParseResult {
  return parseSync(file, contents, OPTIONS);
}

// Raw transfer reads the tree from the parser's own memory and does not copy
// it through JSON, which is most of the cost of a parse. The option is
// experimental and not in oxc-parser's types, hence the cast. Where it is not
// supported (Node older than 22, a 32-bit or big-endian machine) the parser
// runs in its default mode and returns the same tree.
const OPTIONS = (
  rawTransferSupported() ? { experimentalRawTransfer: true } : {}
) as ParserOptions;

// A child field holds a node, a list of nodes (with `null` for a hole, as in
// `[a, , b]`), or nothing.
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value;

/** The direct child nodes of `node`, in source order. */
export function childrenOf(node: Node): Node[] {
  const children: Node[] = [];
  for (const key of visitorKeys[node.type] ?? []) {
    const value: unknown = Reflect.get(node, key);
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) children.push(item);
    } else if (isNode(value)) {
      children.push(value);
    }
  }
  return children;
}

/**
 * Calls `visit` for `node` and every node under it, parents first. `ancestors`
 * is the path from the root to the node's parent. Return `false` from `visit`
 * to skip the node's children.
 *
 * It reads the child fields itself and does not call `childrenOf`: a large
 * service file has a hundred thousand nodes, and a list per node is most of
 * the cost of a walk.
 */
export function walk(
  node: Node,
  visit: (node: Node, ancestors: Node[]) => boolean | void,
  ancestors: Node[] = []
): void {
  if (visit(node, ancestors) === false) return;
  const keys = visitorKeys[node.type];
  if (!keys) return;
  ancestors.push(node);
  for (const key of keys) {
    const value: unknown = Reflect.get(node, key);
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) walk(item, visit, ancestors);
    } else if (isNode(value)) {
      walk(value, visit, ancestors);
    }
  }
  ancestors.pop();
}

/**
 * Whether `node` is `a.name` or `a?.name`: not `a[key]`, not `a.#name`. Then
 * `node.property.name` is the name and `node.object` is `a`.
 */
export function isNamedMember(node: Node): node is StaticMemberExpression {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier"
  );
}

/**
 * What a top-level statement declares, with `export` or `export default` taken
 * off, and whether it was exported: `export const a = 1` gives the `const`.
 * `export default` of an expression, and `export { … }`, give the statement.
 */
export function declarationOf(statement: Directive | Statement): {
  node: Directive | Statement;
  exported: boolean;
} {
  if (statement.type === "ExportNamedDeclaration" && statement.declaration)
    return { node: statement.declaration, exported: true };
  if (
    statement.type === "ExportDefaultDeclaration" &&
    (statement.declaration.type === "FunctionDeclaration" ||
      statement.declaration.type === "ClassDeclaration" ||
      statement.declaration.type === "TSInterfaceDeclaration")
  )
    return { node: statement.declaration, exported: true };
  return { node: statement, exported: false };
}
