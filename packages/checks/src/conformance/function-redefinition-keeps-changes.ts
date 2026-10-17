// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";

export const FUNCTION_REDEFINITION_KEEPS_CHANGES =
  "function-redefinition-keeps-changes";

/** Migrations before this one are history; only a new redefinition is checked. */
export const CHECKED_SINCE = "20261016000000";

/** Fewer dropped lines than this is a deliberate edit, not a lost change. */
const MIN_DROPPED = 2;

/**
 * A migration that redefines a function must start from its newest definition.
 * `20261014171619_receive-consumed-serial-units` forked `complete_job_to_inventory`
 * from an older migration, and its `CREATE OR REPLACE` silently undid the two
 * migrations between them: every company posting job costing (always-post) and
 * the lock on the production events a completion posts.
 *
 * For each redefinition, the lines the previous definition ADDED over its own
 * predecessor must still be in the new body. A rewrite that drops them on
 * purpose goes in the baseline with the reason in its migration header.
 */
export function findDroppedFunctionChanges(
  migrations: SourceFile[]
): Violation[] {
  const definitions = new Map<
    string,
    { name: string; file: string; lines: Set<string> }[]
  >();
  for (const { file, contents } of [...migrations].sort((a, b) =>
    a.file.localeCompare(b.file)
  )) {
    for (const { signature, name, lines } of functionBodies(contents)) {
      const list = definitions.get(signature) ?? [];
      list.push({ name, file, lines });
      definitions.set(signature, list);
    }
  }

  const out: Violation[] = [];
  for (const [signature, list] of definitions) {
    for (let k = 2; k < list.length; k++) {
      const current = list[k]!;
      if (current.file < CHECKED_SINCE) continue;
      const previous = list[k - 1]!;
      const older = list[k - 2]!;
      const dropped = [...previous.lines].filter(
        (line) => !older.lines.has(line) && !current.lines.has(line)
      );
      if (dropped.length < MIN_DROPPED) continue;
      out.push({
        file: current.file,
        line: 0,
        snippet: `${current.name} drops ${previous.file}`,
        message: `${current.file} redefines ${signature} without ${dropped.length} lines that ${previous.file} added (e.g. "${dropped[0]}"). Start the CREATE OR REPLACE from the newest definition. If the change is removed on purpose, say so in the migration header and baseline this finding.`
      });
    }
  }
  return out;
}

/** First words of the multi-word types, which carry no argument name before them. */
const TYPE_STARTS = new Set([
  "bit",
  "char",
  "character",
  "double",
  "interval",
  "national",
  "time",
  "timestamp"
]);

/** The spellings Postgres treats as one type. */
const TYPE_ALIASES: Record<string, string> = {
  bool: "boolean",
  decimal: "numeric",
  float4: "real",
  float8: "double precision",
  int: "integer",
  int2: "smallint",
  int4: "integer",
  int8: "bigint",
  timestamp: "timestamp without time zone",
  timestamptz: "timestamp with time zone",
  varchar: "character varying"
};

/** The parts of an argument list, split on the commas outside parentheses. */
function splitArguments(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function normalizeType(type: string): string {
  const base = type
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/^public\./, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const array = /(\s*\[\])+$/.exec(base)?.[0] ?? "";
  const name = base.slice(0, base.length - array.length).trim();
  return (TYPE_ALIASES[name] ?? name) + array.replace(/\s/g, "");
}

/**
 * What identifies a function besides its name: the types of its input
 * arguments (an OUT argument is not one), written the way Postgres resolves
 * them, so `int` and `integer` are the same function.
 */
function argumentTypes(list: string): string[] {
  const types: string[] = [];
  for (const argument of splitArguments(list.replace(/--[^\n]*/g, ""))) {
    let words = argument
      .replace(/\s*(?:\bDEFAULT\b|=)[\s\S]*$/i, "")
      .trim()
      .split(/\s+/);
    const mode = words[0]?.toUpperCase();
    if (mode === "OUT") continue;
    if (mode === "IN" || mode === "INOUT" || mode === "VARIADIC") {
      words = words.slice(1);
    }
    const first = words[0]?.toLowerCase().replace(/"/g, "") ?? "";
    if (words.length > 1 && !TYPE_STARTS.has(first)) words = words.slice(1);
    if (words.length > 0) types.push(normalizeType(words.join(" ")));
  }
  return types;
}

/** The index of the `)` that closes the `(` just before `from`. */
function closingParen(sql: string, from: number): number {
  let depth = 1;
  for (let i = from; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Each `CREATE [OR REPLACE] FUNCTION`: its signature (schema, name and
 * argument types — an overload is another function), the name a finding
 * shows, and its body lines, comments and blanks left out.
 */
function functionBodies(
  sql: string
): { signature: string; name: string; lines: Set<string> }[] {
  const out: { signature: string; name: string; lines: Set<string> }[] = [];
  const header =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?([A-Za-z_]\w*)"?\.)?"?([A-Za-z_]\w*)"?\s*\(/gi;
  for (const match of sql.matchAll(header)) {
    const open = match.index + match[0].length;
    const close = closingParen(sql, open);
    if (close < 0) continue;
    const schema = (match[1] ?? "public").toLowerCase();
    const name = schema === "public" ? match[2]! : `${schema}.${match[2]!}`;
    const signature = `${schema}.${match[2]!}(${argumentTypes(sql.slice(open, close)).join(", ")})`;
    const rest = sql.slice(close);
    const tag = /\$[A-Za-z_]*\$/.exec(rest);
    if (!tag) continue;
    const start = close + tag.index + tag[0].length;
    const end = sql.indexOf(tag[0], start);
    if (end < 0) continue;
    const lines = new Set(
      sql
        .slice(start, end)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 12 && !line.startsWith("--"))
    );
    out.push({ signature, name, lines });
  }
  return out;
}
