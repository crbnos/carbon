// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import ts from "typescript5";
import type { ConformanceCheck, Violation } from "../check";

/**
 * The supabase-js client has no transaction: every `.from(t).insert(…)`,
 * `.update(…)`, `.upsert(…)` or `.delete(…)` is its own PostgREST request and
 * commits on its own. A function that makes two of them, awaited in turn or
 * fanned out with `Promise.all`, leaves the data half applied when the second
 * fails: a delete without its re-insert (efd366dba0, the quote line prices), a
 * Draft header whose source was set Active without its copy (37f71945a4), a
 * contact without its customer link (f922057bbc).
 *
 * Reads the function bodies with the TypeScript parser. A write belongs to the
 * nearest enclosing function that is not a callback (a callback passed to a
 * call, `items.map(async …)`, runs as part of its caller), so a write fanned
 * out over a list counts toward the function that fans it out. A write inside
 * a Kysely transaction's callback (`ctx.transaction`, `withTransaction`,
 * `db.transaction().execute`) is not counted.
 *
 * Two writes that can never run in the same call are not a chain: the two
 * branches of an `if`/`else`, a `? :` or a `switch`, and a write followed by a
 * `return` or `throw` in its own block before the next write (the
 * `if (id) return update(); return insert();` upsert). A write in a loop is
 * one write here: a per-row loop is a different mistake.
 *
 * Not seen: writes made by a building block the function calls
 * (`await insertX(client, …); await updateY(client, …)`), and `.rpc(…)`, which
 * reads as often as it writes.
 */

const FILES = [
  /^apps\/erp\/app\/modules\/.+\.(?:service|server)\.ts$/,
  /^apps\/mes\/app\/services\/.+\.ts$/
];

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

/** A callback handed to one of these runs inside the Kysely transaction. */
const TRANSACTION_CALLEE = /\bwithTransaction\b|\btransaction\b/;

type Write = {
  node: ts.CallExpression;
  table: string;
  op: string;
  label: string;
};

const unwrap = (e: ts.Expression): ts.Expression => {
  let node = e;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  return node;
};

/** The table and verb when `call` is a supabase-js `.from(t).insert/update/upsert/delete(…)`. */
function clientWrite(
  call: ts.CallExpression,
  source: ts.SourceFile
): { table: string; op: string } | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const op = callee.name.text;
  if (!WRITE_METHODS.has(op)) return null;
  const from = unwrap(callee.expression);
  if (!ts.isCallExpression(from) || from.arguments.length !== 1) return null;
  const fromCallee = from.expression;
  if (
    !ts.isPropertyAccessExpression(fromCallee) ||
    fromCallee.name.text !== "from"
  ) {
    return null;
  }
  const base = unwrap(fromCallee.expression);
  // `Array.from(…)`, `Buffer.from(…)`, and a storage bucket's `.update(path, file)`.
  if (ts.isIdentifier(base) && /^(?:Array|Buffer|Uint8Array)$/.test(base.text))
    return null;
  if (ts.isPropertyAccessExpression(base) && base.name.text === "storage")
    return null;
  const table = from.arguments[0] as ts.Expression;
  const name = ts.isStringLiteralLike(table)
    ? table.text
    : table.getText(source).replace(/\s+/g, "");
  return { table: name, op };
}

/** A function handed to a call as an argument: it runs as part of its caller. */
function isCallback(fn: ts.Node): boolean {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return false;
  const parent = fn.parent;
  if (!ts.isCallExpression(parent) && !ts.isNewExpression(parent)) {
    return false;
  }
  return (parent.arguments ?? []).some((argument) => argument === fn);
}

/**
 * The function a write belongs to, or null when it runs in a transaction's
 * callback or at the top level.
 */
function ownerOf(
  node: ts.Node,
  source: ts.SourceFile
): ts.FunctionLikeDeclaration | null {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (!ts.isFunctionLike(n)) continue;
    if (isCallback(n)) {
      const call = n.parent as ts.CallExpression;
      if (TRANSACTION_CALLEE.test(call.expression.getText(source))) return null;
      continue;
    }
    return n as ts.FunctionLikeDeclaration;
  }
  return null;
}

/** The property a function is the value of in an object literal, if any. */
function propertyOf(fn: ts.Node): ts.ObjectLiteralElementLike | null {
  if (ts.isMethodDeclaration(fn) && ts.isObjectLiteralExpression(fn.parent)) {
    return fn;
  }
  if (fn.parent && ts.isPropertyAssignment(fn.parent)) return fn.parent;
  return null;
}

const isDefineServiceFnArgument = (object: ts.Node) =>
  ts.isCallExpression(object.parent) &&
  ts.isIdentifier(object.parent.expression) &&
  object.parent.expression.text === "defineServiceFn";

/** The nearest function `node` sits in, or null at the top level. */
function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) return n as ts.FunctionLikeDeclaration;
  }
  return null;
}

/**
 * The name the owner is known by: its own, or the const it is defined in. A
 * function that is a property of an object literal (a callback option) is
 * `<outer>.<property>`, except a service function's `run`, which is the const.
 */
function nameOf(fn: ts.FunctionLikeDeclaration, source: ts.SourceFile): string {
  const property = propertyOf(fn);
  if (property?.name && !isDefineServiceFnArgument(property.parent)) {
    const key = property.name.getText(source);
    const outer = enclosingFunction(property);
    return outer ? `${nameOf(outer, source)}.${key}` : key;
  }
  for (let n: ts.Node | undefined = fn; n; n = n.parent) {
    if (ts.isVariableDeclaration(n)) return n.name.getText(source);
    if (
      (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) &&
      n.name &&
      !ts.isObjectLiteralExpression(n.parent)
    ) {
      const cls =
        ts.isMethodDeclaration(n) && ts.isClassLike(n.parent) && n.parent.name
          ? `${n.parent.name.text}.`
          : "";
      return `${cls}${n.name.getText(source)}`;
    }
    if (ts.isSourceFile(n)) break;
  }
  return fn.name?.getText(source) ?? "<anonymous>";
}

/**
 * An upsert written as two statements on one row: update it, and insert it
 * when nothing matched (`upsertExchangeRateOverride`); or insert it when absent,
 * then update it (`markIntegrationInstalled`). Only one of the two changes the
 * row, so a failure leaves nothing half applied. An insert followed by an
 * update of the same table is not this: the update is usually another row
 * (37f71945a4 inserted the Draft, then set its source Active).
 */
const oneUpsert = (a: Write, b: Write) =>
  a.table === b.table &&
  ((a.op === "update" && (b.op === "insert" || b.op === "upsert")) ||
    (a.op === "upsert" && b.op === "update"));

const ends = (s: ts.Node) => ts.isReturnStatement(s) || ts.isThrowStatement(s);

/** Whether `a` (earlier) and `b` (later) can never both run in one call of `owner`. */
function exclusive(a: ts.Node, b: ts.Node, owner: ts.Node): boolean {
  const pathA: ts.Node[] = [];
  for (let n: ts.Node | undefined = a; n && n !== owner; n = n.parent) {
    pathA.push(n);
  }
  const onA = new Set(pathA);
  let lca: ts.Node | undefined = b;
  let childB: ts.Node = b;
  while (lca && lca !== owner && !onA.has(lca)) {
    childB = lca;
    lca = lca.parent;
  }
  if (!lca || lca === owner) return false;
  const lcaAt = pathA.indexOf(lca);
  const childA = pathA[lcaAt - 1];
  if (!childA) return false;

  if (ts.isIfStatement(lca)) {
    if (childA === lca.thenStatement && childB === lca.elseStatement) {
      return true;
    }
  }
  if (
    ts.isConditionalExpression(lca) &&
    childA !== lca.condition &&
    childB !== lca.condition
  ) {
    return true;
  }
  if (ts.isCaseBlock(lca)) return true;

  // A `return`/`throw` after `a` in its own block, before the block that holds
  // `b`, ends the call. Only within the owner's own body: a return inside a
  // callback ends the callback.
  let start = 0;
  for (let i = 0; i < lcaAt; i++) {
    if (ts.isFunctionLike(pathA[i] as ts.Node)) start = i + 1;
  }
  for (let i = start; i < lcaAt; i++) {
    const node = pathA[i] as ts.Node;
    if (ends(node)) return true;
    const parent = pathA[i + 1];
    if (
      parent &&
      parent !== lca &&
      (ts.isBlock(parent) ||
        ts.isCaseClause(parent) ||
        ts.isDefaultClause(parent))
    ) {
      const statements = parent.statements;
      const at = statements.indexOf(node as ts.Statement);
      if (statements.slice(at + 1).some(ends)) return true;
    }
  }
  return false;
}

export const noChainedClientWrites: ConformanceCheck = {
  id: "no-chained-client-writes",
  description:
    "A function makes at most one supabase-js write; dependent writes run in one Kysely transaction or one RPC",
  provenance: {
    deprecates:
      "two or more supabase-js writes in one function, each committing on its own",
    replacedBy:
      "one Kysely transaction (`ctx.transaction` in a service function, `withTransaction(db, …)` in a building block), or one RPC",
    since: "2026-11-25",
    incidents: ["efd366dba0", "37f71945a4", "f922057bbc"]
  },
  triggers: [".insert(", ".update(", ".upsert(", ".delete("],
  scan(file: string, contents: string): Violation[] {
    if (!FILES.some((re) => re.test(file))) return [];
    if (!/\.(?:insert|update|upsert|delete)\(/.test(contents)) return [];
    const source = ts.createSourceFile(
      file,
      contents,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const byOwner = new Map<ts.FunctionLikeDeclaration, Write[]>();
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const write = clientWrite(node, source);
        if (write) {
          const owner = ownerOf(node, source);
          if (owner) {
            const writes = byOwner.get(owner) ?? [];
            writes.push({
              node,
              ...write,
              label: `${write.table}.${write.op}`
            });
            byOwner.set(owner, writes);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    const violations: Violation[] = [];
    for (const [owner, writes] of byOwner) {
      if (writes.length < 2) continue;
      const chained = new Set<Write>();
      let second: Write | null = null;
      for (let i = 0; i < writes.length; i++) {
        for (let j = i + 1; j < writes.length; j++) {
          const a = writes[i] as Write;
          const b = writes[j] as Write;
          if (oneUpsert(a, b) || exclusive(a.node, b.node, owner)) continue;
          chained.add(a);
          chained.add(b);
          if (!second || b.node.getStart(source) < second.node.getStart(source))
            second = b;
        }
      }
      if (!second) continue;
      const name = nameOf(owner, source);
      const labels = [
        ...new Set(writes.filter((w) => chained.has(w)).map((w) => w.label))
      ];
      violations.push({
        file,
        line:
          source.getLineAndCharacterOfPosition(second.node.getStart(source))
            .line + 1,
        snippet: `${name}: ${labels.join(", ")}`,
        message: `${name} makes ${chained.size} supabase-js writes (${labels.join(", ")}) and each commits on its own: when a later one fails, the earlier ones stay and the data is half applied. Do them in one Kysely transaction — \`ctx.transaction\` in a service function, \`withTransaction(db, …)\` in a building block — or in one RPC when the write must also run through PostgREST.`
      });
    }
    return violations;
  }
};
