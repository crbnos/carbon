/**
 * Write-site guards for the declared context contract (service-signatures.ts).
 *
 * The dispatcher stamps exactly the identity fields a service declares. That is
 * only safe when the declaration is true to the table the payload is written
 * to, so two checks follow each payload into its writes:
 *
 * - column guard: every declared identity field that REACHES a write is a
 *   column of the written table — a declared `createdBy` spread into a table
 *   without the column is a PGRST204 on every call;
 * - converse guard: a NOT NULL audit column without a default on the written
 *   table (`createdBy` / `updatedBy` required by the table's Insert type) is
 *   either declared by the payload or set by the service itself — otherwise the
 *   insert is a 23502 on every call.
 *
 * Data-flow scoped on purpose: a field reaches a write only through the param
 * itself, `sanitize(param)`, an array of it, an object literal spreading it, or
 * a local that still carries it (a rest binding that did not destructure the
 * field out, or a copy). `updateCompanyPlan` declares `companyId` but uses it
 * only in `.eq("id", companyId)`: not a write, so not checked. The table must
 * be a literal at the write site (`.from("t")`, `insertInto("t")`,
 * `updateTable("t")`); every other shape is skipped and reported.
 */

import type { FunctionDeclaration, Node as MorphNode } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";
import { getDbTableTypeFields } from "./db-types";
import {
  agreedFields,
  discriminate,
  type IdentityField,
  type PayloadSignature,
  type SignatureIndex
} from "./service-signatures";

type WriteOp = "insert" | "update" | "upsert";

export interface GuardFinding {
  tool: string;
  table: string;
  op: WriteOp;
  field: string;
  kind: "absent-column" | "undeclared-required";
}

export interface GuardReport {
  findings: GuardFinding[];
  /** Write sites of a declaring payload the guards could not follow. */
  skipped: string[];
  /** Write sites checked. */
  checked: number;
}

/** A local that carries the payload: which fields it no longer carries. */
interface Alias {
  excluded: Set<string>;
}

function aliasesOf(
  fn: FunctionDeclaration,
  paramName: string
): Map<string, Alias> {
  const aliases = new Map<string, Alias>([
    [paramName, { excluded: new Set() }]
  ]);
  for (const declaration of fn.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration
  )) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const nameNode = declaration.getNameNode();
    const carried = carriedBy(initializer, aliases);
    if (Node.isIdentifier(nameNode) && carried) {
      aliases.set(nameNode.getText(), {
        excluded: new Set([...carried.alias.excluded, ...carried.explicit])
      });
      continue;
    }
    if (
      Node.isObjectBindingPattern(nameNode) &&
      Node.isIdentifier(initializer) &&
      aliases.has(initializer.getText())
    ) {
      const source = aliases.get(initializer.getText()) as Alias;
      const destructured = new Set<string>();
      let rest: string | null = null;
      for (const element of nameNode.getElements()) {
        if (element.getDotDotDotToken()) rest = element.getName();
        else
          destructured.add(
            element.getPropertyNameNode()?.getText() ?? element.getName()
          );
      }
      if (rest) {
        aliases.set(rest, {
          excluded: new Set([...source.excluded, ...destructured])
        });
      }
    }
  }
  return aliases;
}

/**
 * The payload local an expression carries into a write, and the properties the
 * expression sets explicitly (those are the service's own values).
 */
function carriedBy(
  expression: MorphNode,
  aliases: Map<string, Alias>
): { alias: Alias; explicit: Set<string> } | null {
  let node: MorphNode = expression;
  // `x as any`, `(x)`, `x!`
  while (
    Node.isAsExpression(node) ||
    Node.isParenthesizedExpression(node) ||
    Node.isNonNullExpression(node)
  ) {
    node = node.getExpression();
  }
  if (Node.isIdentifier(node)) {
    const alias = aliases.get(node.getText());
    return alias ? { alias, explicit: new Set() } : null;
  }
  if (Node.isCallExpression(node)) {
    // sanitize(x) keeps every key it is given.
    if (
      node.getExpression().getText() === "sanitize" &&
      node.getArguments().length === 1
    ) {
      return carriedBy(node.getArguments()[0], aliases);
    }
    return null;
  }
  if (Node.isArrayLiteralExpression(node)) {
    const elements = node.getElements();
    if (elements.length !== 1) return null;
    return carriedBy(elements[0], aliases);
  }
  if (Node.isObjectLiteralExpression(node)) {
    let alias: Alias | null = null;
    const explicit = new Set<string>();
    for (const property of node.getProperties()) {
      if (Node.isSpreadAssignment(property)) {
        const spread = carriedBy(property.getExpression(), aliases);
        if (spread) alias = spread.alias;
        continue;
      }
      if (
        Node.isPropertyAssignment(property) ||
        Node.isShorthandPropertyAssignment(property)
      ) {
        explicit.add(property.getName());
      }
    }
    return alias ? { alias, explicit } : null;
  }
  return null;
}

interface WriteSite {
  node: MorphNode;
  table: string | null;
  op: WriteOp;
  value: MorphNode;
}

/** `.from("t").insert|update|upsert(x)` and `insertInto("t").values(x)` /
 *  `updateTable("t").set(x)`, with the table when it is a literal. */
function writeSites(fn: FunctionDeclaration): WriteSite[] {
  const sites: WriteSite[] = [];
  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const method = callee.getName();
    const args = call.getArguments();
    if (args.length === 0) continue;
    const receiver = callee.getExpression();
    const tableOf = (name: string): string | null | undefined => {
      if (!Node.isCallExpression(receiver)) return undefined;
      const inner = receiver.getExpression();
      if (!Node.isPropertyAccessExpression(inner) || inner.getName() !== name) {
        return undefined;
      }
      const tableArg = receiver.getArguments()[0];
      return tableArg && Node.isStringLiteral(tableArg)
        ? tableArg.getLiteralValue()
        : null;
    };
    if (method === "insert" || method === "update" || method === "upsert") {
      const table = tableOf("from");
      if (table === undefined) continue;
      sites.push({ node: call, table, op: method, value: args[0] });
    } else if (method === "values") {
      const table = tableOf("insertInto");
      if (table === undefined) continue;
      sites.push({ node: call, table, op: "insert", value: args[0] });
    } else if (method === "set") {
      const table = tableOf("updateTable");
      if (table === undefined) continue;
      sites.push({ node: call, table, op: "update", value: args[0] });
    }
  }
  return sites;
}

/**
 * Which union branch a write sits in: the `then` of `if ("key" in alias)`, its
 * `else`, or after an `if ("key" in alias) { … return … }` — the shapes the
 * discriminated upserts use. `null` when the write is outside all of them.
 */
function branchAt(
  site: MorphNode,
  key: string,
  aliases: Map<string, Alias>
): "present" | "absent" | null {
  const isTest = (expression: MorphNode) =>
    Node.isBinaryExpression(expression) &&
    expression.getOperatorToken().getKind() === SyntaxKind.InKeyword &&
    Node.isStringLiteral(expression.getLeft()) &&
    expression.getLeft().getText().slice(1, -1) === key &&
    aliases.has(expression.getRight().getText());

  let child: MorphNode = site;
  for (
    let parent = site.getParent();
    parent;
    child = parent, parent = parent.getParent()
  ) {
    if (Node.isIfStatement(parent) && isTest(parent.getExpression())) {
      if (parent.getThenStatement() === child) return "present";
      if (parent.getElseStatement() === child) return "absent";
    }
    if (Node.isBlock(parent) || Node.isSourceFile(parent)) {
      // An earlier sibling `if (test) { …; return }` means this is the else.
      for (const statement of parent.getStatements()) {
        if (statement === child) break;
        if (
          Node.isIfStatement(statement) &&
          isTest(statement.getExpression()) &&
          !statement.getElseStatement() &&
          statement
            .getThenStatement()
            .getDescendantsOfKind(SyntaxKind.ReturnStatement).length > 0
        ) {
          return "absent";
        }
      }
    }
    if (Node.isFunctionDeclaration(parent)) break;
  }
  return null;
}

function branchFieldsAt(
  payload: PayloadSignature,
  site: MorphNode,
  aliases: Map<string, Alias>
): IdentityField[] {
  const agreed = agreedFields(payload.members);
  if (agreed) return agreed;
  const split = discriminate(payload);
  if ("problem" in split) return [];
  const branch = branchAt(site, split.key, aliases);
  if (branch === "present") return split.present;
  if (branch === "absent") return split.absent;
  return [...new Set([...split.present, ...split.absent])];
}

/** Run both guards over every operation of the manifest. */
export function checkContextWrites(
  tools: ReadonlyArray<{ name: string; module: string }>,
  signatures: SignatureIndex
): GuardReport {
  const findings: GuardFinding[] = [];
  const skipped: string[] = [];
  let checked = 0;

  for (const tool of tools) {
    const fnName = tool.name.slice(tool.module.length + 1);
    const signature = signatures.get(tool.module, fnName);
    const fn = signatures.declaration(tool.module, fnName);
    if (!signature || !fn) continue;

    for (const param of signature.params) {
      if (param.slot !== "payload" || !param.name) continue;
      const payload = param.payload;
      if (payload.scalar || payload.opaque) continue;

      const aliases = aliasesOf(fn, param.name);
      for (const site of writeSites(fn)) {
        const carried = carriedBy(site.value, aliases);
        if (!carried) {
          // A property read (`args.locationId`) is an explicit, type-checked
          // value; only the payload passed on WHOLE can carry an undeclared key.
          const mentions = [site.value, ...site.value.getDescendants()].some(
            (node) => {
              if (!Node.isIdentifier(node) || !aliases.has(node.getText())) {
                return false;
              }
              const parent = node.getParent();
              return !(
                (Node.isPropertyAccessExpression(parent) ||
                  Node.isElementAccessExpression(parent)) &&
                parent.getExpression() === node
              );
            }
          );
          if (mentions) {
            skipped.push(
              `${tool.name}: ${site.op} of a value built from "${param.name}" in a shape the guard does not follow`
            );
          }
          continue;
        }
        if (site.table === null) {
          skipped.push(`${tool.name}: ${site.op} into a non-literal table`);
          continue;
        }
        const columns = getDbTableTypeFields(
          site.table,
          site.op === "update" ? "Update" : "Insert"
        );
        if (!columns) {
          skipped.push(`${tool.name}: ${site.op} into "${site.table}" (no table type)`);
          continue;
        }
        checked++;
        const names = new Set(columns.map((c) => c.name));
        const declared = branchFieldsAt(payload, site.node, aliases);
        const reaching = declared.filter(
          (field) =>
            !carried.alias.excluded.has(field) && !carried.explicit.has(field)
        );
        for (const field of reaching) {
          if (!names.has(field)) {
            findings.push({
              tool: tool.name,
              table: site.table,
              op: site.op,
              field,
              kind: "absent-column"
            });
          }
        }
        if (site.op === "update") continue;
        for (const column of columns) {
          if (column.name !== "createdBy" && column.name !== "updatedBy") {
            continue;
          }
          if (column.optional) continue;
          if (
            reaching.includes(column.name as IdentityField) ||
            carried.explicit.has(column.name)
          ) {
            continue;
          }
          findings.push({
            tool: tool.name,
            table: site.table,
            op: site.op,
            field: column.name,
            kind: "undeclared-required"
          });
        }
      }
    }
  }

  return { findings, skipped, checked };
}

