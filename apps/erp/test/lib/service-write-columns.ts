import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Static reader for the service-write-columns guard
// (test/service-write-columns.test.ts). postgrest-js types `.insert()`,
// `.update()` and `.upsert()` generically, so an object literal naming a column
// the table does not have compiles; PostgREST then refuses the whole write at
// runtime (PGRST204, "Could not find the 'x' column"). This module reads the
// generated `Database` type and every literal write in the ERP modules'
// service and server files, and reports each key that is not a column.

/** Columns writable per public table, from the generated Insert/Update types. */
export type TableColumns = Map<
  string,
  { insert: Set<string>; update: Set<string> }
>;

export type WriteOp = "insert" | "update" | "upsert";

export interface LiteralWrite {
  file: string;
  line: number;
  table: string;
  op: WriteOp;
  /** Keys the literal names outright, including both arms of a conditional spread. */
  keys: string[];
}

export interface UnknownColumn {
  file: string;
  line: number;
  table: string;
  op: WriteOp;
  column: string;
}

const WRITE_OPS: ReadonlySet<string> = new Set(["insert", "update", "upsert"]);

function propertyName(name: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

function membersOf(node: ts.TypeNode | undefined): ts.TypeElement[] {
  return node && ts.isTypeLiteralNode(node) ? [...node.members] : [];
}

function member(
  members: readonly ts.TypeElement[],
  name: string
): ts.PropertySignature | undefined {
  return members.find(
    (m): m is ts.PropertySignature =>
      ts.isPropertySignature(m) && !!m.name && propertyName(m.name) === name
  );
}

function keysOf(node: ts.TypeNode | undefined): Set<string> {
  const keys = new Set<string>();
  for (const m of membersOf(node)) {
    if (ts.isPropertySignature(m) && m.name) {
      const name = propertyName(m.name);
      if (name) keys.add(name);
    }
  }
  return keys;
}

/**
 * Reads `Database["public"]["Tables"]` from the generated types file. Views are
 * left out: a write to one goes through its INSTEAD OF trigger, whose columns
 * the generated type does not describe.
 */
export function readTableColumns(typesSource: string): TableColumns {
  const sf = ts.createSourceFile(
    "types.ts",
    typesSource,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );
  const tables: TableColumns = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== "Database") {
      continue;
    }
    const pub = member(membersOf(stmt.type), "public");
    const tablesNode = member(membersOf(pub?.type), "Tables");
    for (const table of membersOf(tablesNode?.type)) {
      if (!ts.isPropertySignature(table) || !table.name) continue;
      const name = propertyName(table.name);
      if (!name) continue;
      const shape = membersOf(table.type);
      tables.set(name, {
        insert: keysOf(member(shape, "Insert")?.type),
        update: keysOf(member(shape, "Update")?.type)
      });
    }
  }
  return tables;
}

/** The string table name of the nearest `.from("t")` in a call chain. */
function tableOfChain(expr: ts.Expression): string | null {
  let cur: ts.Expression = expr;
  while (true) {
    if (ts.isCallExpression(cur)) {
      const callee = cur.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "from" &&
        cur.arguments.length === 1
      ) {
        const arg = cur.arguments[0];
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          return arg.text;
        }
        return null;
      }
      cur = callee;
    } else if (ts.isPropertyAccessExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isParenthesizedExpression(cur) || ts.isAwaitExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isNonNullExpression(cur) || ts.isAsExpression(cur)) {
      cur = cur.expression;
    } else {
      return null;
    }
  }
}

function enclosingFunction(node: ts.Node): ts.Node {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionLike(cur)) return cur;
    cur = cur.parent;
  }
  return node.getSourceFile();
}

/**
 * The object literal an identifier was declared with, when it was declared in
 * the same function (`const update = { … }; … .update(update)`). Keys assigned
 * later (`update.x = …`) are added.
 */
function resolveIdentifier(
  id: ts.Identifier
): { literal: ts.ObjectLiteralExpression; assigned: string[] } | null {
  const scope = enclosingFunction(id);
  let literal: ts.ObjectLiteralExpression | null = null;
  const assigned: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === id.text &&
      node.initializer
    ) {
      let init: ts.Expression = node.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) {
        init = init.expression;
      }
      if (ts.isObjectLiteralExpression(init)) literal = init;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === id.text
    ) {
      assigned.push(node.left.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return literal ? { literal, assigned } : null;
}

/** Keys of an object literal, following spreads of literals and conditionals. */
function literalKeys(obj: ts.ObjectLiteralExpression): string[] {
  const keys: string[] = [];
  const fromSpread = (expr: ts.Expression) => {
    if (ts.isParenthesizedExpression(expr)) return fromSpread(expr.expression);
    if (ts.isObjectLiteralExpression(expr)) {
      keys.push(...literalKeys(expr));
    } else if (ts.isConditionalExpression(expr)) {
      fromSpread(expr.whenTrue);
      fromSpread(expr.whenFalse);
    } else if (
      ts.isBinaryExpression(expr) &&
      (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      fromSpread(expr.right);
    }
    // Any other spread (a parameter, a call result) is typed by the checker
    // or unknowable statically; its keys are not claimed here.
  };
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
      const name = propertyName(prop.name);
      if (name) keys.push(name);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      keys.push(prop.name.text);
    } else if (ts.isSpreadAssignment(prop)) {
      fromSpread(prop.expression);
    }
  }
  return keys;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let cur = expr;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isSatisfiesExpression(cur) ||
    ts.isNonNullExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

function keysOfArgument(arg: ts.Expression): string[] | null {
  const expr = unwrap(arg);
  if (ts.isObjectLiteralExpression(expr)) return literalKeys(expr);
  if (ts.isArrayLiteralExpression(expr)) {
    const keys: string[] = [];
    let any = false;
    for (const el of expr.elements) {
      const inner = unwrap(el);
      if (ts.isObjectLiteralExpression(inner)) {
        any = true;
        keys.push(...literalKeys(inner));
      }
    }
    return any ? keys : null;
  }
  if (ts.isIdentifier(expr)) {
    const resolved = resolveIdentifier(expr);
    if (resolved) {
      return [...literalKeys(resolved.literal), ...resolved.assigned];
    }
  }
  return null;
}

/** Every `.from("t").insert|update|upsert(<literal>)` in one source file. */
export function findLiteralWrites(
  file: string,
  source: string
): LiteralWrite[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const writes: LiteralWrite[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITE_OPS.has(node.expression.name.text) &&
      node.arguments.length >= 1
    ) {
      const table = tableOfChain(node.expression.expression);
      const keys = table ? keysOfArgument(node.arguments[0]) : null;
      if (table && keys) {
        writes.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          table,
          op: node.expression.name.text as WriteOp,
          keys: [...new Set(keys)]
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return writes;
}

/** Keys a write names that its table's generated Insert/Update type lacks. */
export function unknownColumns(
  writes: readonly LiteralWrite[],
  tables: TableColumns
): UnknownColumn[] {
  const out: UnknownColumn[] = [];
  for (const w of writes) {
    const cols = tables.get(w.table);
    // Not a public table: a view, another schema, or a typo the checker
    // already rejects at `.from()`.
    if (!cols) continue;
    const allowed =
      w.op === "update"
        ? cols.update
        : w.op === "insert"
          ? cols.insert
          : new Set([...cols.insert, ...cols.update]);
    for (const column of w.keys) {
      if (!allowed.has(column)) {
        out.push({ file: w.file, line: w.line, table: w.table, op: w.op, column });
      }
    }
  }
  return out;
}

/**
 * Builds a type-checked program from a tsconfig. Only the checker is used; no
 * diagnostics are collected, so this costs one parse and bind of the app.
 */
export function createProgram(tsconfigPath: string): ts.Program {
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(tsconfigPath)
  );
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true }
  });
}

/**
 * Every `.from("t").insert|update|upsert(arg)` in the program's files that
 * `include` accepts, with the property names of `arg`'s static type. This
 * reaches what the literal scan cannot: a spread parameter, a validator type,
 * a variable built elsewhere. An argument typed `any` has no knowable keys and
 * is left out.
 */
export function findTypedWrites(
  program: ts.Program,
  root: string,
  include: (fileName: string) => boolean
): LiteralWrite[] {
  const checker = program.getTypeChecker();
  const propertyNames = (type: ts.Type): string[] | null => {
    const names = new Set<string>();
    let untyped = false;
    const add = (t: ts.Type) => {
      if (t.isUnion()) {
        t.types.forEach(add);
        return;
      }
      if (checker.isArrayType(t) || checker.isTupleType(t)) {
        checker.getTypeArguments(t as ts.TypeReference).forEach(add);
        return;
      }
      if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
        untyped = true;
        return;
      }
      for (const p of checker.getPropertiesOfType(t)) names.add(p.name);
    };
    add(type);
    return untyped ? null : [...names];
  };

  const writes: LiteralWrite[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !include(sf.fileName)) continue;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        WRITE_OPS.has(node.expression.name.text) &&
        node.arguments.length >= 1
      ) {
        const table = tableOfChain(node.expression.expression);
        const keys = table
          ? propertyNames(checker.getTypeAtLocation(node.arguments[0]))
          : null;
        if (table && keys) {
          writes.push({
            file: path.relative(root, sf.fileName),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            table,
            op: node.expression.name.text as WriteOp,
            keys
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return writes;
}

/** ERP module files that write through a Supabase client. */
export function serviceWriteFiles(modulesDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "ui" && entry.name !== "node_modules") walk(full);
      } else if (
        /\.(service|server)\.ts$/.test(entry.name) &&
        !entry.name.endsWith(".test.ts")
      ) {
        files.push(full);
      }
    }
  };
  walk(modulesDir);
  return files.sort();
}
