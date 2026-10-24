// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import ts from "typescript";
import type { SourceFile, Violation } from "../check";

export const STAMP_MATCHES_COLUMNS = "stamp-matches-columns";

/**
 * A service function's `payload(ctx, value)…forCreate()` (or `forUpdate`,
 * `forUpsert`, `for(op)`, `build`) adds identity fields to the payload it
 * hands a building block. When the building block
 * spreads that payload into a write, every added field is a column of the
 * write: one the table does not have fails the whole statement (PGRST204),
 * and `createdBy` added to a payload that only ever reaches an `.update(`
 * rewrites the row's author on every save. Both shipped: `createAccount`
 * stamped `companyId` onto the group-scoped `account`, `upsertItemCost`
 * restamped `createdBy` on each cost edit.
 *
 * Follows each `payload(...)` chain in `<module>.server.ts` into the `service.<fn>(...)`
 * it is passed to, finds that function in `<module>.service.ts`, and reads
 * the writes whose row is the parameter itself (`insert([p])`, `...p`,
 * `sanitize(p)`). A field of a nested object (`...p.contact`) is never added
 * by `payload`, so it is not followed.
 */
export function findStampColumnMismatches(
  modules: { server: SourceFile; service: SourceFile }[],
  columns: Map<string, Set<string>>
): Violation[] {
  const out: Violation[] = [];
  for (const { server, service } of modules) {
    const serviceFns = exportedFunctions(parse(service));
    const serverSf = parse(server);
    visit(serverSf, (node) => {
      const chain = payloadChain(node);
      if (!chain) return;
      const { fields, operation } = chain;
      const outer = enclosingServiceCall(node);
      if (!outer) return;
      const fn = serviceFns.get(outer.name);
      const index = outer.call.arguments.findIndex((a) => contains(a, node));
      const param = fn?.parameters[index];
      if (!fn?.body || !param || !ts.isIdentifier(param.name)) return;
      const isList = /\[\]\s*$|^\s*Array</.test(param.type?.getText() ?? "");
      const added = fields.filter((field) =>
        field === "createdBy"
          ? operation !== "update"
          : isList
            ? false
            : field === "updatedBy"
              ? operation !== "create"
              : true
      );
      const writes = carriedWrites(fn.body, param.name.text);
      if (writes.length === 0) return;
      const line =
        serverSf.getLineAndCharacterOfPosition(node.getStart(serverSf)).line +
        1;
      const leaf = leafName(node);
      for (const table of new Set(writes.map((write) => write.table))) {
        const missing = added.filter((f) => !columns.get(table)?.has(f));
        if (columns.has(table) && missing.length > 0) {
          out.push({
            file: server.file,
            line,
            snippet: `${leaf} ${table} ${missing.join(",")}`,
            message: `${leaf} stamps ${missing.join(", ")} onto a row of "${table}", which has no such column: the write fails. Stamp only the fields the table has.`
          });
        }
      }
      if (
        added.includes("createdBy") &&
        writes.every((write) => write.verb === "update")
      ) {
        out.push({
          file: server.file,
          line,
          snippet: `${leaf} createdBy-on-update`,
          message: `${leaf} stamps createdBy onto a payload that only reaches an update, which rewrites the row's author. Stamp updatedBy instead.`
        });
      }
    });
  }
  return out;
}

function parse({ file, contents }: SourceFile): ts.SourceFile {
  return ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);
}

function visit(node: ts.Node, fn: (node: ts.Node) => void): void {
  fn(node);
  node.forEachChild((child) => visit(child, fn));
}

function contains(outer: ts.Node, inner: ts.Node): boolean {
  return inner.pos >= outer.pos && inner.end <= outer.end;
}

function exportedFunctions(sf: ts.SourceFile) {
  const out = new Map<string, ts.FunctionDeclaration>();
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      out.set(statement.name.text, statement);
    }
  }
  return out;
}

const TERMINALS: Record<string, { fields: string[]; operation?: string }> = {
  forCreate: { fields: ["createdBy"], operation: "create" },
  forUpdate: { fields: ["updatedBy"], operation: "update" },
  forUpsert: { fields: ["createdBy", "updatedBy"] },
  for: { fields: ["createdBy", "updatedBy"] },
  build: { fields: [] }
};

/**
 * The fields and operation of a `payload(ctx, value).<modifiers>.<terminal>()`
 * chain, read off its calls; undefined for any other call.
 */
function payloadChain(
  node: ts.Node
): (ts.CallExpression & { fields: string[]; operation?: string }) | undefined {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  ) {
    return undefined;
  }
  const name = node.expression.name.text;
  if (!Object.hasOwn(TERMINALS, name)) return undefined;
  const terminal = TERMINALS[name]!;
  const fields = new Set(["companyId", ...terminal.fields]);
  const operation =
    node.expression.name.text === "for"
      ? stringValue(node.arguments[0])
      : terminal.operation;
  let inner: ts.Expression = node.expression.expression;
  while (
    ts.isCallExpression(inner) &&
    ts.isPropertyAccessExpression(inner.expression)
  ) {
    const modifier = inner.expression.name.text;
    if (modifier === "withGroup") fields.add("companyGroupId");
    else if (modifier === "withUser") fields.add("userId");
    else if (modifier === "withoutCompany") fields.delete("companyId");
    else return undefined;
    inner = inner.expression.expression;
  }
  if (
    !ts.isCallExpression(inner) ||
    !ts.isIdentifier(inner.expression) ||
    inner.expression.text !== "payload"
  ) {
    return undefined;
  }
  return Object.assign(node, { fields: [...fields], operation });
}

function stringValue(node: ts.Node | undefined): string | undefined {
  return node && ts.isStringLiteral(node) ? node.text : undefined;
}

/** The `service.<name>(…)` call the stamped value is an argument of. */
function enclosingServiceCall(
  node: ts.Node
): { call: ts.CallExpression; name: string } | undefined {
  for (let n = node.parent; n; n = n.parent) {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "service"
    ) {
      return { call: n, name: n.expression.name.text };
    }
    if (ts.isArrowFunction(n) || ts.isFunctionLike(n)) return undefined;
  }
  return undefined;
}

function leafName(node: ts.Node): string {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      return n.name.text;
    }
  }
  return "?";
}

/** Writes whose row is `param` itself, with their table. */
function carriedWrites(
  body: ts.Block,
  param: string
): { table: string; verb: string }[] {
  const out: { table: string; verb: string }[] = [];
  const carriesName = (arg: ts.Expression, name: string) => {
    const text = arg.getText().replace(/\s+/g, "");
    return (
      text === name ||
      text === `[${name}]` ||
      new RegExp(`\\.\\.\\.(sanitize\\()?${name}(?![.\\w])`).test(text) ||
      text.includes(`sanitize(${name})`)
    );
  };
  // One level of aliasing: `const data = sanitize(param)` carries it too.
  const names = [param];
  visit(body, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      carriesName(node.initializer, param)
    ) {
      names.push(node.name.text);
    }
  });
  const carries = (arg: ts.Expression) =>
    names.some((name) => carriesName(arg, name));
  visit(body, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression)
    ) {
      return;
    }
    const verb = node.expression.name.text;
    const [row] = node.arguments;
    if (
      !["insert", "update", "upsert"].includes(verb) ||
      !row ||
      !carries(row)
    ) {
      return;
    }
    const table = fromTable(node.expression.expression);
    if (table) out.push({ table, verb });
  });
  return out;
}

/** The `.from("t")` at the root of a builder chain, never `storage.from`. */
function fromTable(node: ts.Expression): string | undefined {
  let n: ts.Expression = node;
  for (;;) {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "from" &&
        !callee.expression.getText().endsWith("storage")
      ) {
        return stringValue(n.arguments[0]);
      }
      n = callee;
    } else if (ts.isPropertyAccessExpression(n)) {
      n = n.expression;
    } else if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) {
      n = n.expression;
    } else {
      return undefined;
    }
  }
}
