// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The service files as an AST, so the manifest generator can ask the compiler
 * what a function does instead of grepping its text.
 *
 * The text scans this replaces shared two defects. They could not tell a call
 * from a comment, a string, or a nested closure — the same looseness that
 * produced two false-positive classes in `no-missing-audit-column` — and they
 * located a function by the FIRST regex match of its name in the service file
 * concatenated with its `mcp.server.ts` companion, so a wrapper's scans were
 * taken from the service body it shadows. Here a declaration is a declaration,
 * and the shadowing rule is explicit.
 *
 * ts-morph is already a dependency of this generator: `response-schema.ts`
 * builds the same `Project` over the same files to reflect return types. One
 * project is built and shared rather than two.
 */
import * as fs from "fs";
import * as path from "path";
import {
  type FunctionDeclaration,
  Node,
  Project,
  type SourceFile,
  SyntaxKind
} from "ts-morph";

const ROOT = path.resolve(__dirname, "../..");
const ERP_ROOT = path.join(ROOT, "apps/erp");
const MODULES_DIR = path.join(ERP_ROOT, "app/modules");

/** Relations a write targets, by the call that names them. */
const TABLE_NAMING = new Set(["from", "insertInto", "updateTable"]);
/** Calls that mutate. `.delete`/`deleteFrom` are also counted by `deletes`. */
const WRITE_CALLS = new Set([
  "insert",
  "upsert",
  "update",
  "delete",
  "insertInto",
  "updateTable",
  "deleteFrom"
]);
const DELETE_CALLS = new Set(["delete", "deleteFrom"]);
const PAGINATION_CALLS = new Set(["setGenericQueryFilters", "range"]);

export interface ServiceAst {
  readonly project: Project;
  /** Exported declarations by `{module}_{fn}`; the mcp.server companion wins. */
  readonly functions: ReadonlyMap<string, FunctionDeclaration>;
  readonly sources: ReadonlyMap<string, SourceFile[]>;
}

/**
 * Build the project once. The `mcp.server.ts` companion is added LAST and
 * overwrites, matching the runtime registry where its spread wins — and unlike
 * the text scans, that resolution now also governs which BODY is inspected.
 */
export function buildServiceAst(modules: readonly string[]): ServiceAst {
  const project = new Project({
    tsConfigFilePath: path.join(ERP_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true
  });
  const functions = new Map<string, FunctionDeclaration>();
  const sources = new Map<string, SourceFile[]>();

  for (const mod of modules) {
    const added: SourceFile[] = [];
    for (const name of [
      `${mod}.service.ts`,
      `${mod}.ee.service.ts`,
      `${mod}.mcp.server.ts`
    ]) {
      const file = path.join(MODULES_DIR, mod, name);
      if (!fs.existsSync(file)) continue;
      const source = project.addSourceFileAtPath(file);
      added.push(source);
      for (const fn of source.getFunctions()) {
        if (!fn.isExported()) continue;
        const fnName = fn.getName();
        if (fnName) functions.set(`${mod}_${fnName}`, fn);
      }
    }
    sources.set(mod, added);
  }
  return { project, functions, sources };
}

/** The member name of a call, e.g. `insert` for `x.from("t").insert(…)`. */
function calleeName(call: Node): string | undefined {
  const expr = call.asKind(SyntaxKind.CallExpression)?.getExpression();
  return (
    expr?.asKind(SyntaxKind.PropertyAccessExpression)?.getName() ??
    expr?.asKind(SyntaxKind.Identifier)?.getText()
  );
}

function callsNamed(fn: FunctionDeclaration, names: ReadonlySet<string>) {
  return fn
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((c) => {
      const n = calleeName(c);
      return n !== undefined && names.has(n);
    });
}

/** Whether the function deletes rows. */
export function astDeletes(fn: FunctionDeclaration): boolean {
  return callsNamed(fn, DELETE_CALLS).length > 0;
}

/** Whether the function performs any write. */
export function astWrites(fn: FunctionDeclaration): boolean {
  return callsNamed(fn, WRITE_CALLS).length > 0;
}

/** Whether the function applies limit/offset itself. */
export function astPaginates(fn: FunctionDeclaration): boolean {
  return callsNamed(fn, PAGINATION_CALLS).length > 0;
}

/**
 * Relations the function names in a `.from("t")` / `insertInto("t")` /
 * `updateTable("t")` call. Reads count: a function that reads one table and
 * writes another yields two names, which `withoutAbsentAuditColumns` treats as
 * "can't tell" and leaves alone — the same conservative rule as before.
 */
export function astTables(fn: FunctionDeclaration): string[] {
  const names = new Set<string>();
  for (const call of callsNamed(fn, TABLE_NAMING)) {
    const arg = call.asKind(SyntaxKind.CallExpression)?.getArguments()[0];
    const literal =
      arg?.asKind(SyntaxKind.StringLiteral) ??
      arg?.asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
    if (literal) names.add(literal.getLiteralText());
  }
  return [...names];
}

/**
 * Whether the function branches on `"createdBy" in x` / `"updatedBy" in x` to
 * pick its insert-vs-update path. A text scan matched the words anywhere,
 * including inside a row literal that merely SETS them; this matches the `in`
 * operator itself.
 */
export function astUsesOperationDiscriminator(
  fn: FunctionDeclaration,
  fields: readonly string[]
): boolean {
  return fn
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .some((bin) => {
      if (bin.getOperatorToken().getKind() !== SyntaxKind.InKeyword) {
        return false;
      }
      const left = bin.getLeft();
      const text =
        left.asKind(SyntaxKind.StringLiteral)?.getLiteralText() ??
        (Node.isNoSubstitutionTemplateLiteral(left)
          ? left.getLiteralText()
          : undefined);
      return text !== undefined && fields.includes(text);
    });
}
