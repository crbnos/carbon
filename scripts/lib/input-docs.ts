// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  type CallExpression,
  Node,
  SyntaxKind,
  type VariableDeclaration
} from "ts-morph";

/** The `input:` expression of a `defineServiceFn({ … })` call. */
function inputOf(call: CallExpression): Node | undefined {
  const definition = call.getArguments()[0];
  if (!Node.isObjectLiteralExpression(definition)) return undefined;
  const input = definition.getProperty("input");
  return Node.isPropertyAssignment(input) ? input.getInitializer() : undefined;
}

/**
 * The validator a schema expression is built from: `x` in
 * `x.extend({ … }).required(…)`, as its declared value.
 */
function baseValidator(expression: Node): Node | undefined {
  let node: Node = expression;
  while (Node.isCallExpression(node) || Node.isPropertyAccessExpression(node)) {
    node = node.getExpression();
  }
  if (!Node.isIdentifier(node) || node.getText() === "z") return undefined;
  const definition = node.getDefinitionNodes()[0];
  if (!definition || definition.getSourceFile().isInNodeModules()) return;
  return Node.isVariableDeclaration(definition)
    ? (definition as VariableDeclaration).getInitializer()
    : undefined;
}

/**
 * The text of a `.describe("…")` on a field's own schema: its method chain
 * (`z.string().min(1).describe("…").optional()`), never a call inside an
 * argument, so a nested field's description stays on the nested field.
 */
function describeText(initializer: Node | undefined): string | undefined {
  let node = initializer;
  while (node && Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return undefined;
    if (callee.getName() === "describe") {
      const text = node.getArguments()[0];
      return Node.isStringLiteral(text) ||
        Node.isNoSubstitutionTemplateLiteral(text)
        ? text.getLiteralValue()
        : undefined;
    }
    node = callee.getExpression();
  }
  return undefined;
}

/**
 * The `.describe("…")` text of each top-level field of a service function's
 * zod input. The published schema is built from the input's TYPE, which
 * carries no descriptions, so they are read from the source: the object
 * literals the input expression passes to `z.object` / `.extend` and the
 * validator it extends, never a nested object's fields.
 */
export function inputFieldDescriptions(
  call: CallExpression
): Map<string, string> {
  const out = new Map<string, string>();
  let expression = inputOf(call);
  for (let depth = 0; expression && depth < 3; depth++) {
    const fieldLists = [expression, ...expression.getDescendantsOfKind(SyntaxKind.CallExpression)]
      .filter(Node.isCallExpression)
      .filter((candidate) => {
        const callee = candidate.getExpression();
        const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : "";
        return ["object", "looseObject", "strictObject", "extend"].includes(name);
      })
      .map((candidate) => candidate.getArguments()[0])
      .filter(Node.isObjectLiteralExpression);
    // Only the outermost object literals: a field's own object is nested.
    const outermost = fieldLists.filter(
      (list) => !fieldLists.some((other) => other !== list && list.getPos() > other.getPos() && list.getEnd() <= other.getEnd())
    );
    for (const list of outermost) {
      for (const property of list.getProperties()) {
        if (!Node.isPropertyAssignment(property)) continue;
        const name = property.getName().replace(/^["']|["']$/g, "");
        const text = describeText(property.getInitializer());
        if (text && !out.has(name)) out.set(name, text);
      }
    }
    expression = baseValidator(expression);
  }
  return out;
}

const genericFilterCache = new Map<string, Set<string>>();

/** The functions of a service file that call `setGenericQueryFilters`. */
function genericFilterFunctions(serviceFile: string): Set<string> {
  let names = genericFilterCache.get(serviceFile);
  if (names) return names;
  names = new Set();
  let text = "";
  try {
    text = readFileSync(serviceFile, "utf8");
  } catch {
    genericFilterCache.set(serviceFile, names);
    return names;
  }
  const starts = [...text.matchAll(/^export (?:async )?function (\w+)\(/gm)];
  starts.forEach((match, index) => {
    const end = starts[index + 1]?.index ?? text.length;
    if (text.slice(match.index, end).includes("setGenericQueryFilters(")) {
      names.add(match[1]!);
    }
  });
  genericFilterCache.set(serviceFile, names);
  return names;
}

/**
 * Whether a service function's `run` calls a building block of its module's
 * `.service.ts` that applies the generic list filters.
 */
export function appliesGenericFilters(call: CallExpression): boolean {
  const serverFile = call.getSourceFile().getFilePath();
  const serviceFile = path.join(
    path.dirname(serverFile),
    path.basename(serverFile).replace(/\.server\.ts$/, ".service.ts")
  );
  const filtered = genericFilterFunctions(serviceFile);
  if (filtered.size === 0) return false;
  const definition = call.getArguments()[0];
  const run = Node.isObjectLiteralExpression(definition)
    ? definition.getProperty("run")
    : undefined;
  const text = run?.getText() ?? "";
  return [...text.matchAll(/\bservice\.(\w+)\(/g)].some((match) =>
    filtered.has(match[1]!)
  );
}
