/**
 * Effect summary: what each published service export DOES, derived from its code
 * rather than its name.
 *
 * The manifest classifies an operation by its name prefix (`get*` → READ,
 * `delete*` → DESTRUCTIVE, otherwise WRITE; see `classifyFunction`). A name is a
 * claim, not a fact: `getNextSequence` consumes a document number and
 * `lookupBuyPrice` writes nothing. This pass walks each export's body — and every
 * same-repo function it calls, transitively — for the calls that change state:
 *
 *   - supabase table writes: `.insert/.update/.upsert/.delete` on a query builder
 *   - Kysely writes: `insertInto/updateTable/deleteFrom/replaceInto/mergeInto`
 *   - `.rpc(fn)` where fn's LATEST migration body writes (INSERT/UPDATE/DELETE/
 *     TRUNCATE, `nextval`, or a call to another writing SQL function)
 *   - edge functions (`functions.invoke`), background jobs (`trigger`)
 *   - storage writes (`upload/update/move/copy/remove/createSignedUploadUrl/…`)
 *   - auth admin mutations (`auth.admin.*` other than get/list)
 *
 * Function volatility markers are deliberately NOT used: dozens of pure-read
 * RPCs (aging, trial balance, inventory quantities) carry no STABLE marker and
 * default to VOLATILE. The body is the fact.
 *
 * The result is a CHECKER input (see `checkClassifications` in
 * service-metadata.ts), never the classifier itself: a disagreement between the
 * name and the effects fails the generator until a grounded override settles it.
 */

import * as fs from "fs";
import * as path from "path";
import {
  type CallExpression,
  Node,
  type SourceFile,
  SyntaxKind,
  type TaggedTemplateExpression
} from "ts-morph";
import type { ServiceProject } from "./response-schema";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "packages/database/supabase/migrations");

export type EffectKind =
  | "table-write"
  | "kysely-write"
  | "sql-write"
  | "rpc-write"
  | "rpc-unresolved"
  | "edge-function"
  | "job-trigger"
  | "storage-write"
  | "auth-admin";

export interface Effect {
  kind: EffectKind;
  /** What was called: `salesOrder.insert`, `rpc get_next_sequence`, … */
  detail: string;
  /** Call chain from the export to the effect, outermost first. Empty = direct. */
  via: string[];
}

/**
 * RPCs whose effect the migration scan cannot settle — the function is not
 * defined in the repo's migrations, or its writes only touch data the caller
 * never sees. `write` counts as an effect, `read` does not. Every entry needs a
 * reason.
 */
export const RPC_EFFECTS: Record<string, { effect: "read" | "write"; reason: string }> = {};

/**
 * Edge functions (`functions.invoke(name)`) are effects by default: nearly all
 * post, create or recalculate documents. The ones listed here only compute.
 */
export const EDGE_FUNCTION_EFFECTS: Record<string, { effect: "read"; reason: string }> = {
  embedding: {
    effect: "read",
    reason:
      "packages/database/supabase/functions/embedding returns a vector for the given text and touches no table."
  }
};

const KYSELY_WRITES = new Set([
  "insertInto",
  "updateTable",
  "deleteFrom",
  "replaceInto",
  "mergeInto"
]);
/** `client.storage.from(…)` or the `storage(client)` wrapper from `@carbon/files`. */
const STORAGE_RECEIVER = /\.storage\.|(^|[^\w.])storage\(/;
const TABLE_WRITES = new Set(["insert", "update", "upsert", "delete"]);
const STORAGE_WRITES = new Set([
  "upload",
  "update",
  "uploadToSignedUrl",
  "createSignedUploadUrl",
  "move",
  "copy",
  "remove",
  "emptyBucket",
  "createBucket",
  "deleteBucket",
  "updateBucket"
]);

// ---------------------------------------------------------------------------
// SQL: which database functions write
// ---------------------------------------------------------------------------

interface SqlFunction {
  name: string;
  body: string;
}

/**
 * Every function defined in the migrations, latest definition per signature.
 * Overloads are kept side by side and unioned when judged, so a writing overload
 * is never hidden behind a reading one.
 */
export function loadSqlFunctions(
  migrationsDir: string = MIGRATIONS_DIR
): Map<string, SqlFunction[]> {
  const bySignature = new Map<string, SqlFunction>();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const header =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\s*\.\s*)?"?([A-Za-z_]\w*)"?\s*\(/gi;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    header.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = header.exec(sql)) !== null) {
      const name = match[1];
      const argsStart = match.index + match[0].length;
      const argsEnd = matchingParen(sql, argsStart - 1);
      if (argsEnd === -1) continue;
      const signature = `${name}(${sql
        .slice(argsStart, argsEnd)
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()})`;
      const tag = /\$([A-Za-z_]*)\$/g;
      tag.lastIndex = argsEnd;
      const open = tag.exec(sql);
      if (!open) continue;
      const bodyStart = open.index + open[0].length;
      const bodyEnd = sql.indexOf(open[0], bodyStart);
      if (bodyEnd === -1) continue;
      bySignature.set(signature, { name, body: sql.slice(bodyStart, bodyEnd) });
      header.lastIndex = bodyEnd + open[0].length;
    }
  }
  const byName = new Map<string, SqlFunction[]>();
  for (const fn of bySignature.values()) {
    const list = byName.get(fn.name) ?? [];
    list.push(fn);
    byName.set(fn.name, list);
  }
  return byName;
}

function matchingParen(text: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripSqlComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

/** Normalizes `"public"."salesOrder"` / `public.x` / `"x"` to `x`. */
function tableName(raw: string): string {
  const parts = raw.split(".");
  return parts[parts.length - 1].replace(/"/g, "");
}

/**
 * The first write a SQL body performs, or null. Writes to a TEMP table the same
 * body creates are scratch space, not state. `FOR UPDATE` is a lock, not a write.
 */
export function sqlBodyWrite(body: string): string | null {
  const sql = stripSqlComments(body);
  const temps = new Set(
    [
      ...sql.matchAll(
        /CREATE\s+(?:LOCAL\s+)?TEMP(?:ORARY)?\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi
      )
    ].map((m) => tableName(m[1]))
  );
  const patterns: [RegExp, string][] = [
    [/\bINSERT\s+INTO\s+([\w."]+)/gi, "INSERT INTO"],
    [/(?<!FOR\s+(?:NO\s+KEY\s+)?)\bUPDATE\s+(?:ONLY\s+)?([\w."]+)(?:\s+(?:AS\s+)?\w+)?\s+SET\b/gi, "UPDATE"],
    [/\bDELETE\s+FROM\s+(?:ONLY\s+)?([\w."]+)/gi, "DELETE FROM"],
    [/\bTRUNCATE\s+(?:TABLE\s+)?([\w."]+)/gi, "TRUNCATE"]
  ];
  for (const [pattern, verb] of patterns) {
    for (const m of sql.matchAll(pattern)) {
      const table = tableName(m[1]);
      if (temps.has(table)) continue;
      return `${verb} ${table}`;
    }
  }
  if (/\bnextval\s*\(/i.test(sql)) return "nextval()";
  return null;
}

export interface SqlEffectResolver {
  /** A description of the write, `null` for a pure read, `undefined` when unknown. */
  (rpcName: string): string | null | undefined;
}

/**
 * Resolve whether calling a database function writes, following calls into
 * other repo-defined functions (`PERFORM assert_x(…)`, `SELECT get_next_sequence(…)`).
 */
export function createSqlEffectResolver(
  functions: Map<string, SqlFunction[]> = loadSqlFunctions()
): SqlEffectResolver {
  const memo = new Map<string, string | null>();
  const known = [...functions.keys()];
  const callPattern = new RegExp(
    `(?<![\\w.])"?(${known.map(escapeRegExp).join("|")})"?\\s*\\(`,
    "g"
  );

  const resolve = (name: string, stack: Set<string>): string | null | undefined => {
    const override = RPC_EFFECTS[name];
    if (override) return override.effect === "write" ? `${name} (RPC_EFFECTS)` : null;
    if (memo.has(name)) return memo.get(name);
    const defs = functions.get(name);
    if (!defs) return undefined;
    if (stack.has(name)) return null;
    stack.add(name);
    let result: string | null = null;
    for (const def of defs) {
      const direct = sqlBodyWrite(def.body);
      if (direct) {
        result = direct;
        break;
      }
      const body = stripSqlComments(def.body);
      callPattern.lastIndex = 0;
      for (const call of body.matchAll(callPattern)) {
        const callee = call[1];
        if (callee === name) continue;
        const nested = resolve(callee, stack);
        if (nested) {
          result = `${callee} → ${nested}`;
          break;
        }
      }
      if (result) break;
    }
    stack.delete(name);
    memo.set(name, result);
    return result;
  };

  return (rpcName) => resolve(rpcName, new Set());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// TypeScript: which service exports cause effects
// ---------------------------------------------------------------------------

export interface EffectIndex {
  /**
   * The effects `{module}_{fn}` causes (first few, with their call chains);
   * empty when none were found; null when the export was not analyzed.
   */
  get(module: string, functionName: string): Effect[] | null;
  readonly stats: { functions: number; withEffects: number };
}

/** Cap per function — the checker needs one witness, a reviewer maybe three. */
const MAX_EFFECTS = 3;

type FunctionLike = Node;

export function buildEffectIndex(
  serviceProject: ServiceProject,
  sqlEffect: SqlEffectResolver = createSqlEffectResolver()
): EffectIndex {
  const memo = new Map<FunctionLike, Effect[]>();
  const inProgress = new Set<FunctionLike>();

  const directEffect = (call: CallExpression): Effect | null => {
    const callee = call.getExpression();
    if (Node.isIdentifier(callee)) {
      const name = callee.getText();
      if (name === "trigger" || name === "batchTrigger") {
        return { kind: "job-trigger", detail: name, via: [] };
      }
      return null;
    }
    if (!Node.isPropertyAccessExpression(callee)) return null;
    const name = callee.getName();
    const receiver = callee.getExpression();
    const receiverText = receiver.getText().replace(/\s+/g, "");

    if (KYSELY_WRITES.has(name)) {
      return { kind: "kysely-write", detail: `${name}(${firstArgText(call)})`, via: [] };
    }
    if (name === "invoke" && /(^|\.)functions$/.test(receiverText)) {
      const fn = firstArgText(call);
      if (EDGE_FUNCTION_EFFECTS[fn]?.effect === "read") return null;
      return { kind: "edge-function", detail: `functions.invoke(${fn})`, via: [] };
    }
    if (name === "trigger" || name === "batchTrigger") {
      return { kind: "job-trigger", detail: `${receiverText}.${name}`, via: [] };
    }
    if (name === "rpc") {
      const arg = unwrapExpression(call.getArguments()[0]);
      const rpcName =
        arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))
          ? arg.getLiteralText()
          : null;
      if (rpcName === null) {
        return { kind: "rpc-unresolved", detail: `rpc(${arg?.getText() ?? ""})`, via: [] };
      }
      const write = sqlEffect(rpcName);
      if (write === undefined) {
        return { kind: "rpc-unresolved", detail: `rpc ${rpcName} (not defined in migrations)`, via: [] };
      }
      return write ? { kind: "rpc-write", detail: `rpc ${rpcName}: ${write}`, via: [] } : null;
    }
    if (/\.auth\.admin$|^auth\.admin$/.test(receiverText) && !/^(get|list)/.test(name)) {
      return { kind: "auth-admin", detail: `auth.admin.${name}`, via: [] };
    }
    if (STORAGE_WRITES.has(name) && STORAGE_RECEIVER.test(receiverText)) {
      return { kind: "storage-write", detail: `storage.${name}`, via: [] };
    }
    if (TABLE_WRITES.has(name) && isQueryBuilder(receiver)) {
      return { kind: "table-write", detail: `${fromTable(receiver)}.${name}`, via: [] };
    }
    return null;
  };

  const analyze = (fn: FunctionLike): Effect[] => {
    const cached = memo.get(fn);
    if (cached) return cached;
    if (inProgress.has(fn)) return [];
    inProgress.add(fn);

    const effects: Effect[] = [];
    const seen = new Set<string>();
    const add = (effect: Effect) => {
      const key = `${effect.kind}:${effect.detail}`;
      if (seen.has(key) || effects.length >= MAX_EFFECTS) return;
      seen.add(key);
      effects.push(effect);
    };

    for (const tagged of fn.getDescendantsOfKind(
      SyntaxKind.TaggedTemplateExpression
    )) {
      const write = sqlTemplateWrite(tagged);
      if (write) add({ kind: "sql-write", detail: write, via: [] });
    }

    for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (effects.length >= MAX_EFFECTS) break;
      const direct = directEffect(call);
      if (direct) {
        add(direct);
        continue;
      }
      for (const target of calledFunctions(call)) {
        const nested = analyze(target.node);
        for (const effect of nested) {
          add({ ...effect, via: [target.name, ...effect.via] });
        }
      }
    }

    inProgress.delete(fn);
    memo.set(fn, effects);
    return effects;
  };

  const index = new Map<string, Effect[]>();
  const stats = { functions: 0, withEffects: 0 };
  for (const { mod, source } of serviceProject.sources) {
    for (const [name, node] of exportedFunctions(source)) {
      const effects = analyze(node);
      // Later sources (.mcp.server) overwrite earlier ones: the runtime
      // registry spreads the companion last, so its export is the one called.
      index.set(`${mod}_${name}`, effects);
    }
  }
  for (const effects of index.values()) {
    stats.functions++;
    if (effects.length > 0) stats.withEffects++;
  }

  return {
    get(module, functionName) {
      return index.get(`${module}_${functionName}`) ?? null;
    },
    stats
  };
}

function exportedFunctions(source: SourceFile): [string, FunctionLike][] {
  const out: [string, FunctionLike][] = [];
  for (const fn of source.getFunctions()) {
    const name = fn.getName();
    if (fn.isExported() && name) out.push([name, fn]);
  }
  return out;
}

/**
 * A Kysely raw `sql\`…\`` statement that writes. Interpolations become a
 * placeholder identifier, so `UPDATE ${sql.table(t)} AS t SET …` still reads as
 * an UPDATE of some table.
 */
function sqlTemplateWrite(tagged: TaggedTemplateExpression): string | null {
  const tag = tagged.getTag().getText();
  if (!/^sql(<[\s\S]*>)?$/.test(tag.replace(/\s+/g, ""))) return null;
  const template = tagged.getTemplate();
  const text = Node.isNoSubstitutionTemplateLiteral(template)
    ? template.getLiteralText()
    : [
        template.getHead().getLiteralText(),
        ...template
          .getTemplateSpans()
          .map((span) => span.getLiteral().getLiteralText())
      ].join(" __interpolated__ ");
  const write = sqlBodyWrite(text);
  return write ? `sql\`${write}\`` : null;
}

/** `"x" as unknown as "y"`, `("x")`, `"x" satisfies T` → `"x"`. */
function unwrapExpression(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current &&
    (Node.isAsExpression(current) ||
      Node.isParenthesizedExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isTypeAssertion(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

function firstArgText(call: CallExpression): string {
  const arg = unwrapExpression(call.getArguments()[0]);
  if (!arg) return "";
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.getLiteralText();
  }
  return arg.getText().slice(0, 40);
}

/**
 * A supabase query builder: the receiver chain goes through `.from(` (and not
 * through storage, whose `from(bucket)` has its own write verbs), or the
 * receiver's type is PostgREST's query builder — which also catches a builder
 * held in a variable. Map/Set `.delete` and friends fail both tests.
 */
function isQueryBuilder(receiver: Node): boolean {
  const text = receiver.getText().replace(/\s+/g, "");
  if (STORAGE_RECEIVER.test(text)) return false;
  if (/\.from\s*\(/.test(text)) return true;
  try {
    return /PostgrestQueryBuilder/.test(receiver.getType().getText());
  } catch {
    return false;
  }
}

function fromTable(receiver: Node): string {
  const m = receiver.getText().match(/\.from\s*\(\s*["'`]([\w-]+)["'`]/);
  return m ? m[1] : "<table>";
}

/**
 * The repo-defined functions a call can land in. External packages
 * (node_modules) are opaque: their effects are covered by the direct patterns
 * (supabase, Kysely, trigger) at the call site.
 */
function calledFunctions(call: CallExpression): { name: string; node: FunctionLike }[] {
  const callee = call.getExpression();
  const nameNode = Node.isPropertyAccessExpression(callee)
    ? callee.getNameNode()
    : Node.isIdentifier(callee)
      ? callee
      : null;
  if (!nameNode) return [];
  const name = nameNode.getText();

  const declarations: Node[] = [];
  let symbol = nameNode.getSymbol();
  if (symbol?.isAlias()) symbol = symbol.getAliasedSymbol() ?? symbol;
  declarations.push(...(symbol?.getDeclarations() ?? []));
  // A destructured binding the symbol cannot see through — `const { runMrp } =
  // await import("@carbon/planning")` — still has a resolved call signature.
  // Only bindings: resolving every builder call (`.eq`, `.select`) this way
  // costs more than the rest of the pass together.
  const onlyBindings =
    declarations.length > 0 &&
    declarations.every((d) => d.getKind() === SyntaxKind.BindingElement);
  if (onlyBindings) {
    try {
      const signature = call
        .getProject()
        .getTypeChecker()
        .getResolvedSignature(call);
      const decl = signature?.getDeclaration();
      if (decl) declarations.push(decl);
    } catch {
      // Unresolvable call — nothing to follow.
    }
  }

  const out: { name: string; node: FunctionLike }[] = [];
  for (const decl of declarations) {
    const file = decl.getSourceFile();
    const filePath = file.getFilePath();
    if (
      file.isDeclarationFile() ||
      filePath.includes("/node_modules/") ||
      !filePath.startsWith(ROOT)
    ) {
      continue;
    }
    const body = functionNode(decl);
    if (body) out.push({ name, node: body });
  }
  return out;
}

function functionNode(decl: Node): FunctionLike | null {
  if (
    Node.isFunctionDeclaration(decl) ||
    Node.isMethodDeclaration(decl) ||
    Node.isArrowFunction(decl) ||
    Node.isFunctionExpression(decl)
  ) {
    return decl;
  }
  if (Node.isVariableDeclaration(decl) || Node.isPropertyAssignment(decl)) {
    const init = decl.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      return init;
    }
  }
  return null;
}
