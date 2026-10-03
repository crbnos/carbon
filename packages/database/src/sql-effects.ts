// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Whether a SQL function writes — read off its definition with Postgres's own
 * parser, never off its name or its text.
 *
 * The API generator sees every `.rpc("name")` a service makes, but a function's
 * body is SQL, which the TypeScript compiler cannot read. `settings_getNextSequence`
 * was published as a READ gated on `settings:view` for that reason: its rpc runs
 * `UPDATE sequence SET next = next + step`.
 *
 * `sqlFunctionEffects` takes SQL sources in the order they are applied
 * (migrations by timestamp, then the managed function files), keeps the current
 * definition of every function, and answers one question about a name: does a
 * call to it write, only read, or can that not be told? The last is an answer,
 * not a default — dynamic SQL, a language the parser does not read, a call into
 * an extension nobody has classified, or a definition the parser could not read
 * all come back `unknown` with the reason, so a caller can refuse rather than
 * guess.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, parsePlPgSQL } from "libpg-query";

/** libpg-query's AST is untyped JSON. */
type Ast = any;

export type SqlEffect =
  | { kind: "reads" }
  | { kind: "writes"; reason: string }
  | { kind: "unknown"; reason: string };

export interface SqlSource {
  /** Shown in a reason, so a reader can find the definition. */
  name: string;
  sql: string;
}

export interface SqlFunctionEffects {
  /** The effect of calling `name` (`public` unless qualified), over every overload. */
  effectOf(name: string): SqlEffect;
  readonly stats: {
    sources: number;
    functions: number;
    /** Sources the parser refused, with its message. */
    unparsed: Array<{ name: string; error: string }>;
  };
}

interface Definition {
  key: string;
  signature: string;
  language: string;
  /** The `CREATE FUNCTION` statement's own text. */
  statement: string;
  /** The body, for a function whose body is a SQL string. */
  body?: string;
  /** The body, for a `BEGIN ATOMIC` function: already a tree. */
  bodyTree?: Ast;
  source: string;
}

interface DirectEffects {
  writes: string[];
  calls: string[];
  unknown: string[];
}

/** Statements that change the database, by the parser's node name. */
const WRITE_STATEMENTS: Record<string, string> = {
  InsertStmt: "INSERT",
  UpdateStmt: "UPDATE",
  DeleteStmt: "DELETE",
  MergeStmt: "MERGE",
  TruncateStmt: "TRUNCATE",
  CopyStmt: "COPY",
  CreateStmt: "CREATE TABLE",
  CreateTableAsStmt: "CREATE TABLE AS",
  AlterTableStmt: "ALTER TABLE",
  DropStmt: "DROP",
  IndexStmt: "CREATE INDEX",
  RefreshMatViewStmt: "REFRESH MATERIALIZED VIEW",
  NotifyStmt: "NOTIFY"
};

/** Built-in functions that change state. Every other built-in only computes. */
const WRITING_BUILTINS = new Set(["nextval", "setval", "pg_notify"]);

/**
 * Functions defined outside the repo's own SQL (extensions, Supabase's schemas),
 * classified by hand because their definitions are not here to read. A qualified
 * call to anything absent from both lists is `unknown`.
 */
const EXTERNAL_READS = new Set([
  "auth.uid",
  "auth.role",
  "auth.jwt",
  "auth.email",
  "extensions.uuid_generate_v4",
  "extensions.gen_random_uuid",
  "extensions.gen_random_bytes",
  "extensions.digest",
  "extensions.similarity",
  "extensions.word_similarity",
  "storage.foldername",
  "storage.filename",
  "storage.extension"
]);
const EXTERNAL_WRITES = new Set([
  "pgmq.send",
  "pgmq.send_batch",
  "pgmq.read",
  "pgmq.pop",
  "pgmq.delete",
  "pgmq.archive",
  "net.http_post",
  "net.http_get",
  "net.http_delete",
  "cron.schedule",
  "cron.unschedule",
  "vault.create_secret",
  "vault.update_secret",
  "supabase_functions.http_request"
]);

/**
 * Functions whose dynamic SQL a person has read and found to only read, each
 * with the source that holds the definition that was read. A later source that
 * redefines the function is a different body, so the review stops applying and
 * the function is `unknown` again until it is read again.
 */
const REVIEWED_DYNAMIC_READS: Readonly<Record<string, string>> = {
  // EXECUTE format('SELECT count(*) FROM %I WHERE "companyId" = $2 AND (%s)', …)
  "util.unit_of_measure_usage":
    "20260814061809_prevent-unit-of-measure-deletion-in-use.sql"
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, "../supabase/migrations");
/** One `CREATE OR REPLACE FUNCTION` per file; applied after every migration. */
const MANAGED_DIRS = [
  path.join(HERE, "authz/helpers"),
  path.join(HERE, "event-system/functions")
];

function nameParts(names: Ast[] | undefined): string[] {
  return (names ?? [])
    .map((part) => part.String?.sval as string | undefined)
    .filter((part): part is string => part !== undefined);
}

/** `name` → `public.name`; an already qualified name is kept. */
function qualify(parts: string[]): string {
  return parts.length === 1 ? `public.${parts[0]}` : parts.join(".");
}

function typeName(node: Ast): string {
  const type = node?.TypeName ?? node;
  const names = nameParts(type?.names);
  const base = names[names.length - 1] ?? "?";
  return type?.arrayBounds ? `${base}[]` : base;
}

/** The types that identify an overload: every parameter a caller passes. */
function signatureOf(parameters: Ast[] | undefined): string {
  return (parameters ?? [])
    .map((parameter) => parameter.FunctionParameter)
    .filter(
      (parameter) =>
        parameter &&
        parameter.mode !== "FUNC_PARAM_OUT" &&
        parameter.mode !== "FUNC_PARAM_TABLE"
    )
    .map((parameter) => typeName(parameter.argType))
    .join(",");
}

function option(statement: Ast, name: string): Ast | undefined {
  return (statement.options ?? []).find(
    (entry: Ast) => entry.DefElem?.defname === name
  )?.DefElem;
}

/** Every node of a parsed SQL tree, depth first. */
function walk(node: Ast, visit: (kind: string, value: Ast) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    visit(key, value);
    walk(value, visit);
  }
}

function collect(tree: Ast, into: DirectEffects): void {
  walk(tree, (kind, value) => {
    const write = WRITE_STATEMENTS[kind];
    if (write) {
      const relation =
        value?.relation?.relname ?? value?.relation?.RangeVar?.relname;
      into.writes.push(relation ? `${write} ${relation}` : write);
    }
    if (kind === "FuncCall") {
      const parts = nameParts(value?.funcname);
      if (parts.length > 0) into.calls.push(parts.join("."));
    }
  });
}

/**
 * A PL/pgSQL statement carries its SQL as text: a whole statement, a bare
 * expression, or an assignment (`total := a + b`). Each is turned into
 * something the SQL parser reads; what still does not parse is reported.
 */
async function collectFragment(
  fragment: string,
  into: DirectEffects
): Promise<void> {
  const assigned = fragment.match(/^\s*[\w."[\]]+\s*:=\s*([\s\S]*)$/);
  const candidates = assigned
    ? [`SELECT ${assigned[1]}`]
    : [fragment, `SELECT ${fragment}`];
  for (const candidate of candidates) {
    try {
      collect(await parse(candidate), into);
      return;
    } catch {
      // try the next reading
    }
  }
  into.unknown.push(
    `a statement the parser could not read: ${fragment.replace(/\s+/g, " ").slice(0, 80)}`
  );
}

async function directEffects(definition: Definition): Promise<DirectEffects> {
  const effects: DirectEffects = { writes: [], calls: [], unknown: [] };

  if (definition.bodyTree) {
    collect(definition.bodyTree, effects);
    return effects;
  }

  if (definition.language === "sql") {
    try {
      collect(await parse(definition.body ?? ""), effects);
    } catch (error) {
      effects.unknown.push(
        `a body the parser could not read (${String(error)})`
      );
    }
    return effects;
  }

  if (definition.language !== "plpgsql") {
    effects.unknown.push(`a body written in ${definition.language}`);
    return effects;
  }

  let tree: Ast;
  try {
    tree = await parsePlPgSQL(definition.statement);
  } catch (error) {
    effects.unknown.push(`a body the parser could not read (${String(error)})`);
    return effects;
  }

  const reviewed = REVIEWED_DYNAMIC_READS[definition.key] === definition.source;
  const fragments: string[] = [];
  walk(tree, (kind, value) => {
    if (
      !reviewed &&
      (kind === "PLpgSQL_stmt_dynexecute" || kind === "PLpgSQL_stmt_dynfors")
    ) {
      effects.unknown.push(
        "dynamic SQL (EXECUTE), which has to be read by a person and listed in REVIEWED_DYNAMIC_READS"
      );
    }
    if (kind === "PLpgSQL_expr" && typeof value?.query === "string") {
      fragments.push(value.query);
    }
  });
  for (const fragment of fragments) await collectFragment(fragment, effects);
  return effects;
}

/**
 * The effect of every function defined by `sources`, applied in order. A later
 * `CREATE OR REPLACE` of the same signature replaces the earlier one, another
 * signature adds an overload, and `DROP FUNCTION` removes what it names.
 */
export async function sqlFunctionEffects(
  sources: readonly SqlSource[]
): Promise<SqlFunctionEffects> {
  const definitions = new Map<string, Map<string, Definition>>();
  const unparsed: Array<{ name: string; error: string; sql: string }> = [];

  for (const source of sources) {
    // Most migrations define no function; parsing them would be wasted work.
    if (!/\bfunction\b/i.test(source.sql)) continue;

    const bytes = Buffer.from(source.sql, "utf8");
    let tree: Ast;
    try {
      tree = await parse(source.sql);
    } catch (error) {
      unparsed.push({
        name: source.name,
        error: String(error),
        sql: source.sql
      });
      continue;
    }

    for (const entry of tree.stmts ?? []) {
      const create = entry.stmt?.CreateFunctionStmt;
      if (create) {
        const key = qualify(nameParts(create.funcname));
        const signature = signatureOf(create.parameters);
        // Statement positions are byte offsets, not character offsets.
        const start = entry.stmt_location ?? 0;
        const end = entry.stmt_len ? start + entry.stmt_len : bytes.length;
        const body = option(create, "as")?.arg?.List?.items?.[0]?.String?.sval;
        const overloads = definitions.get(key) ?? new Map();
        overloads.set(signature, {
          key,
          signature,
          language: (
            option(create, "language")?.arg?.String?.sval ?? "sql"
          ).toLowerCase(),
          statement: bytes.subarray(start, end).toString("utf8"),
          body,
          bodyTree: create.sql_body,
          source: source.name
        });
        definitions.set(key, overloads);
        continue;
      }

      const drop = entry.stmt?.DropStmt;
      if (
        drop &&
        ["OBJECT_FUNCTION", "OBJECT_ROUTINE", "OBJECT_PROCEDURE"].includes(
          drop.removeType
        )
      ) {
        for (const object of drop.objects ?? []) {
          const target = object.ObjectWithArgs;
          if (!target) continue;
          const key = qualify(nameParts(target.objname));
          const overloads = definitions.get(key);
          if (!overloads) continue;
          if (target.args_unspecified) overloads.clear();
          else overloads.delete((target.objargs ?? []).map(typeName).join(","));
          if (overloads.size === 0) definitions.delete(key);
        }
      }
    }
  }

  const direct = new Map<Definition, DirectEffects>();
  for (const overloads of definitions.values()) {
    for (const definition of overloads.values()) {
      direct.set(definition, await directEffects(definition));
    }
  }

  const userSchemas = new Set(
    [...definitions.keys()].map((key) => key.slice(0, key.indexOf(".")))
  );

  /** A call as written → the function it names, or how to treat it. */
  function resolveCall(call: string): { key?: string; effect?: SqlEffect } {
    const parts = call.split(".");
    const schema = parts[0] ?? "";
    const name = parts[parts.length - 1] ?? "";
    if (parts.length === 1) {
      const key = `public.${call}`;
      if (definitions.has(key)) return { key };
      return WRITING_BUILTINS.has(call)
        ? { effect: { kind: "writes", reason: `${call}()` } }
        : { effect: { kind: "reads" } };
    }
    if (definitions.has(call)) return { key: call };
    if (schema === "pg_catalog") {
      return WRITING_BUILTINS.has(name)
        ? { effect: { kind: "writes", reason: `${name}()` } }
        : { effect: { kind: "reads" } };
    }
    if (EXTERNAL_WRITES.has(call)) {
      return { effect: { kind: "writes", reason: `${call}()` } };
    }
    if (EXTERNAL_READS.has(call)) return { effect: { kind: "reads" } };
    // A schema the repo defines functions in, but not this one: it was dropped,
    // or never defined. A schema it defines nothing in: an extension.
    return {
      effect: {
        kind: "unknown",
        reason: userSchemas.has(schema)
          ? `${call}(), which no source defines`
          : `${call}(), an external function that is not classified in sql-effects.ts`
      }
    };
  }

  const memo = new Map<string, SqlEffect>();
  // How often a call led back to a function still being worked out.
  let cycleHits = 0;

  function effectOfKey(key: string, visiting: Set<string>): SqlEffect {
    const known = memo.get(key);
    if (known) return known;
    // A function reached again while it is being worked out adds nothing new.
    if (visiting.has(key)) {
      cycleHits++;
      return { kind: "reads" };
    }
    const hitsBefore = cycleHits;

    const overloads = definitions.get(key);
    if (!overloads) {
      const mentioned = unparsed.find((entry) =>
        new RegExp(`\\b${key.slice(key.indexOf(".") + 1)}\\b`).test(entry.sql)
      );
      return {
        kind: "unknown",
        reason: mentioned
          ? `${key} is named in ${mentioned.name}, which the parser could not read`
          : `${key} is not defined by any source`
      };
    }

    visiting.add(key);
    let unknown: SqlEffect | undefined;
    let result: SqlEffect = { kind: "reads" };
    for (const definition of overloads.values()) {
      const own = direct.get(definition) as DirectEffects;
      if (own.writes.length > 0) {
        result = { kind: "writes", reason: `${key}: ${own.writes[0]}` };
        break;
      }
      for (const call of own.calls) {
        const resolved = resolveCall(call);
        const effect = resolved.key
          ? effectOfKey(resolved.key, visiting)
          : (resolved.effect as SqlEffect);
        if (effect.kind === "writes") {
          result = {
            kind: "writes",
            reason: resolved.key
              ? `${key} calls ${effect.reason}`
              : `${key}: ${effect.reason}`
          };
          break;
        }
        if (effect.kind === "unknown" && !unknown) {
          unknown = {
            kind: "unknown",
            reason: `${key} calls ${effect.reason}`
          };
        }
      }
      if (result.kind === "writes") break;
      if (own.unknown.length > 0 && !unknown) {
        unknown = { kind: "unknown", reason: `${key} has ${own.unknown[0]}` };
      }
    }
    visiting.delete(key);

    // A write is certain whatever else could not be read; otherwise one part
    // that could not be read makes the whole answer unknown.
    const effect = result.kind === "writes" ? result : (unknown ?? result);
    // An answer that leaned on a caller not yet worked out is provisional: A
    // calls B, B calls A, A then writes — B looked like a read from inside A.
    // Keeping it would let a read tool call B. A write is certain either way.
    if (effect.kind === "writes" || cycleHits === hitsBefore) {
      memo.set(key, effect);
    }
    return effect;
  }

  return {
    effectOf(name) {
      return effectOfKey(qualify(name.split(".")), new Set());
    },
    stats: {
      sources: sources.length,
      functions: [...definitions.values()].reduce(
        (count, overloads) => count + overloads.size,
        0
      ),
      unparsed: unparsed.map(({ name, error }) => ({ name, error }))
    }
  };
}

function sqlFiles(directory: string): SqlSource[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      name: file,
      sql: readFileSync(path.join(directory, file), "utf8")
    }));
}

/** The effects of the repo's own functions: every migration, then the managed files. */
export function loadSqlFunctionEffects(): Promise<SqlFunctionEffects> {
  return sqlFunctionEffects([
    ...sqlFiles(MIGRATIONS_DIR),
    ...MANAGED_DIRS.flatMap(sqlFiles)
  ]);
}
