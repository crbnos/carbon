// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ITEM_PAGES, pageById, pagesOf } from "@carbon/database/access";
import type {
  Argument,
  ObjectProperty,
  PropertyKey,
  VariableDeclaration
} from "oxc-parser";
import type { SourceFile } from "../check";
import { erpRouteOf } from "./route-pages";
import { declarationOf, parseTypescript } from "./syntax";

// Reads the pages a permission gate names, from its TypeScript: a page gate
// (`{ "inventory.receipts": "View" }`), `anyOf(...)`, `pagesOf(...)`, and the
// named gate constants and list gates a route may gate on instead.

const CONSTANT = /^[A-Z][A-Z0-9_]*$/;

const isPage = (text: string) => pageById(text) !== undefined;

/** The text of a string literal, or of a template with no substitutions. */
function stringValue(node: Argument | PropertyKey): string | undefined {
  if (node.type === "Literal") {
    const value = node.value;
    return typeof value === "string" ? value : undefined;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

/**
 * The expression under parentheses, `as` and `satisfies`. An optional chain
 * (`anyOf?.(…)`) is read as the call or member inside it.
 */
const unwrap = (node: Argument): Argument =>
  node.type === "ParenthesizedExpression" ||
  node.type === "TSAsExpression" ||
  node.type === "TSSatisfiesExpression" ||
  node.type === "ChainExpression"
    ? unwrap(node.expression)
    : node;

/**
 * The pages a gate expression names; undefined when part of it cannot be
 * read (a variable, a property of a row, a call other than `anyOf`/`pagesOf`).
 * `constants` are the gate constants it may name (`gateConstants`).
 */
export function pagesNamed(
  argument: Argument,
  constants: ReadonlyMap<string, readonly string[]>
): string[] | undefined {
  const node = unwrap(argument);
  const text = stringValue(node);
  if (text !== undefined) return isPage(text) ? [text] : [];
  if (node.type === "Identifier") {
    if (node.name === "ITEM_PAGES") return [...ITEM_PAGES];
    const pages = constants.get(node.name);
    return pages ? [...pages] : undefined;
  }
  if (node.type === "ObjectExpression") {
    const out: string[] = [];
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        const inner = pagesNamed(property.argument, constants);
        if (!inner) return undefined;
        out.push(...inner);
        continue;
      }
      // A shorthand, a method, an accessor or a computed name is unreadable.
      if (
        property.kind !== "init" ||
        property.method ||
        property.shorthand ||
        property.computed
      )
        return undefined;
      const name =
        property.key.type === "Identifier"
          ? property.key.name
          : stringValue(property.key);
      if (name === undefined) return undefined;
      if (isPage(name)) out.push(name);
      // `{ anyOf: [...] }`
      else if (name === "anyOf") {
        const inner = pagesNamed(property.value, constants);
        if (!inner) return undefined;
        out.push(...inner);
      }
    }
    return out;
  }
  if (node.type === "ArrayExpression") {
    const out: string[] = [];
    for (const element of node.elements) {
      // A hole (`[a, , b]`) is unreadable.
      if (!element) return undefined;
      const inner = pagesNamed(
        element.type === "SpreadElement" ? element.argument : element,
        constants
      );
      if (!inner) return undefined;
      out.push(...inner);
    }
    return out;
  }
  if (node.type === "ConditionalExpression") {
    const a = pagesNamed(node.consequent, constants);
    const b = pagesNamed(node.alternate, constants);
    return a && b ? [...a, ...b] : undefined;
  }
  if (node.type === "CallExpression" && node.callee.type === "Identifier") {
    const [first] = node.arguments;
    if (!first) return undefined;
    if (node.callee.name === "anyOf") return pagesNamed(first, constants);
    const area = stringValue(first);
    if (node.callee.name === "pagesOf" && area !== undefined)
      return pagesOf(area);
  }
  return undefined;
}

/** The top-level `const`/`let`/`var` statements of a file, exported or not. */
function variableStatements(file: string, contents: string) {
  const out: { declaration: VariableDeclaration; exported: boolean }[] = [];
  for (const statement of parseTypescript(file, contents).program.body) {
    const { node, exported } = declarationOf(statement);
    if (node.type === "VariableDeclaration")
      out.push({ declaration: node, exported });
  }
  return out;
}

/**
 * The exported upper-case constants of the ERP's non-route files that name
 * pages (`export const CONTRACT_READ_GATE = anyOf([...], "View")`), so a
 * route may gate on one by name.
 */
export function gateConstants(
  files: readonly SourceFile[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { file, contents } of files) {
    if (!file.startsWith("apps/erp/app/") || erpRouteOf(file) !== undefined)
      continue;
    if (!/export const [A-Z]/.test(contents)) continue;
    for (const { declaration, exported } of variableStatements(
      file,
      contents
    )) {
      if (!exported) continue;
      for (const { id, init } of declaration.declarations) {
        if (id.type !== "Identifier" || !CONSTANT.test(id.name) || !init)
          continue;
        const pages = pagesNamed(init, out);
        if (pages?.length) out.set(id.name, pages);
      }
    }
  }
  return out;
}

/**
 * The pages each exported list of the list registry gates on, by the list's
 * name: `export const receiptsList = searchList({ gate, … })` or
 * `export const paymentsList = { key, gate, … }`. A route that loads a list
 * with `loadListPage(request, receiptsList)` gates on it.
 */
export function listGates(files: readonly SourceFile[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { file, contents } of files) {
    if (!contents.includes("gate:")) continue;
    for (const { declaration } of variableStatements(file, contents)) {
      for (const { id, init } of declaration.declarations) {
        if (id.type !== "Identifier" || !init) continue;
        const value = unwrap(init);
        const definition =
          value.type === "CallExpression"
            ? value.arguments[0] && unwrap(value.arguments[0])
            : value;
        if (definition?.type !== "ObjectExpression") continue;
        const gate = definition.properties.find(
          (property): property is ObjectProperty =>
            property.type === "Property" &&
            property.kind === "init" &&
            !property.method &&
            !property.shorthand &&
            !property.computed &&
            property.key.type === "Identifier" &&
            property.key.name === "gate"
        );
        const pages = gate && pagesNamed(gate.value, new Map());
        if (pages?.length) out.set(id.name, pages);
      }
    }
  }
  return out;
}
