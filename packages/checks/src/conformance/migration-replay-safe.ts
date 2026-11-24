// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";
import { GENERATED_AUTHZ_MIGRATION } from "./no-authz-ddl-in-migrations";

// The deploy runner re-runs a failed migration over what it already committed
// (a migration may `COMMIT` part way), so a statement that errors on an object
// already there, or already gone, fails every later deploy (`cb75027fc2`).

/** Migrations up to here are applied history and cannot be edited. */
const LAST_UNCHECKED = "20261119125737";

const PART = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const NAME = String.raw`${PART}(?:\s*\.\s*${PART})?`;
const NAME_LIST = String.raw`${NAME}(?:\s*,\s*${NAME})*`;

/**
 * `"public".x` and `x` are one object; unquoted parts fold to lower case, as in
 * Postgres.
 */
function normalizeName(raw: string): string {
  const parts = [...raw.matchAll(new RegExp(PART, "g"))].map(([p]) =>
    p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase()
  );
  return parts.length === 2 && parts[0] === "public"
    ? (parts[1] ?? "")
    : parts.join(".");
}

const namesIn = (list: string) =>
  [...list.matchAll(new RegExp(NAME, "g"))].map(([n]) => normalizeName(n));

const blank = (s: string) => s.replace(/[^\n]/g, " ");

type Masked = {
  /** What runs at migration time, with guarded DO bodies blanked. */
  top: string;
  /** Same, but every DO body kept: where an earlier DROP or DELETE may sit. */
  full: string;
};

/**
 * A function body runs when called, not at migration time, so it is blanked.
 * A DO body guarded by IF/EXCEPTION is trusted whole and blanked from `top`;
 * an unguarded one is scanned.
 */
function maskSql(sql: string): Masked {
  let top = "";
  let full = "";
  const emit = (t: string, f: string = t) => {
    top += t;
    full += f;
  };
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i] as string;
    const next = sql[i + 1];

    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      emit(blank(sql.slice(i, stop)));
      i = stop;
      continue;
    }

    if (c === "/" && next === "*") {
      // Postgres block comments nest.
      let depth = 0;
      let j = i;
      while (j < n) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else j++;
      }
      emit(blank(sql.slice(i, j)));
      i = j;
      continue;
    }

    if (c === "'") {
      // E'…' takes backslash escapes, so \' does not end it.
      const escapes = /(?:^|[^\w$])[eE]$/.test(
        sql.slice(Math.max(0, i - 2), i)
      );
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === "\\") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      emit(`'${blank(sql.slice(i + 1, j))}'`);
      i = j + 1;
      continue;
    }

    if (c === '"') {
      const j = sql.indexOf('"', i + 1);
      const stop = j === -1 ? n : j + 1;
      emit(sql.slice(i, stop));
      i = stop;
      continue;
    }

    if (c === "$" && !/[\w$]/.test(sql[i - 1] ?? "")) {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 64))?.[0];
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        const body = sql.slice(i + tag.length, close === -1 ? n : close);
        if (/\bDO(?:\s+LANGUAGE\s+\w+)?\s*$/i.test(full.slice(-64))) {
          const inner = maskSql(body);
          const guarded = /\b(?:IF|EXCEPTION)\b/i.test(
            inner.full.replace(/"[^"]*"/g, "")
          );
          emit(
            blank(tag) + (guarded ? blank(body) : inner.top) + blank(tag),
            blank(tag) + inner.full + blank(tag)
          );
        } else {
          emit(blank(sql.slice(i, end)));
        }
        i = end;
        continue;
      }
    }

    emit(c);
    i++;
  }
  return { top, full };
}

/**
 * The same text with every quoted identifier's contents replaced, so a
 * keyword inside a name (`"… can insert into the public bucket"`) is never
 * read as a statement. Same length, so offsets carry over.
 */
const hideIdentifiers = (sql: string) =>
  sql.replace(/"[^"\n]*"/g, (m) => `"${"_".repeat(m.length - 2)}"`);

type Rule = {
  /**
   * Matches the statement head. Group `name` is the object; group `table`,
   * when there is one, the table it lives on (or, for an INSERT, writes to).
   */
  pattern: RegExp;
  /**
   * The DROP kind that, earlier in the file, makes re-creating `name` safe. A
   * DROP with no IF EXISTS counts too: the DROP rule reports it, once.
   */
  undoneBy?: string;
  /**
   * A statement-level escape, e.g. `ON CONFLICT` anywhere in an INSERT. An
   * earlier `DELETE FROM` or `TRUNCATE` of the table escapes it too.
   */
  guardedBy?: RegExp;
  message: (name: string) => string;
};

const RULES: Rule[] = [
  {
    pattern: new RegExp(
      String.raw`\bDROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|TRIGGER|INDEX(?:\s+CONCURRENTLY)?|TYPE|POLICY|CONSTRAINT|COLUMN|SEQUENCE|SCHEMA)\s+(?!IF\s+EXISTS\b)(?<name>${NAME})`,
      "dgi"
    ),
    message: (name) =>
      `DROP of ${name} has no IF EXISTS: on a re-run after a failed deploy it is already gone and the migration fails again. Write DROP … IF EXISTS.`
  },
  {
    // An unnamed index (`CREATE INDEX ON t`) gets a new name on a re-run, so
    // it does not fail.
    pattern: new RegExp(
      String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?!IF\s+NOT\s+EXISTS\b|ON\b)(?<name>${NAME})\s+ON\s+(?:ONLY\s+)?(?<table>${NAME})`,
      "dgi"
    ),
    undoneBy: String.raw`INDEX(?:\s+CONCURRENTLY)?`,
    message: (name) =>
      `CREATE INDEX ${name} has no IF NOT EXISTS: on a re-run after a failed deploy the index is already there and the migration fails again.`
  },
  {
    pattern: new RegExp(
      String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?!IF\s+NOT\s+EXISTS\b)(?<name>${NAME})`,
      "dgi"
    ),
    undoneBy: "TABLE",
    message: (name) =>
      `CREATE TABLE ${name} has no IF NOT EXISTS: on a re-run after a failed deploy the table is already there and the migration fails again.`
  },
  {
    pattern: new RegExp(
      String.raw`\bCREATE\s+(?:SCHEMA|SEQUENCE)\s+(?!IF\s+NOT\s+EXISTS\b)(?<name>${NAME})`,
      "dgi"
    ),
    message: (name) =>
      `CREATE of ${name} has no IF NOT EXISTS: on a re-run after a failed deploy it is already there and the migration fails again.`
  },
  {
    pattern: new RegExp(String.raw`\bCREATE\s+TYPE\s+(?<name>${NAME})`, "dgi"),
    undoneBy: "TYPE",
    message: (name) =>
      `CREATE TYPE ${name} fails on a re-run after a failed deploy: the type is already there. CREATE TYPE has no IF NOT EXISTS; create it in a DO block that checks pg_type first, or catches duplicate_object.`
  },
  {
    pattern: new RegExp(
      String.raw`\bALTER\s+TYPE\s+(?<name>${NAME})\s+ADD\s+VALUE\s+(?!IF\s+NOT\s+EXISTS\b)`,
      "dgi"
    ),
    message: (name) =>
      `ALTER TYPE ${name} ADD VALUE has no IF NOT EXISTS: on a re-run after a failed deploy the value is already there and the migration fails again.`
  },
  {
    // OR REPLACE never matches: OR sits between CREATE and the kind.
    pattern: new RegExp(
      String.raw`\bCREATE\s+(?:(?:RECURSIVE\s+)?VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE)\s+(?!IF\s+NOT\s+EXISTS\b)(?<name>${NAME})`,
      "dgi"
    ),
    undoneBy: String.raw`(?:MATERIALIZED\s+)?(?:VIEW|FUNCTION|PROCEDURE)`,
    message: (name) =>
      `CREATE of ${name} has no OR REPLACE and no earlier DROP … IF EXISTS: on a re-run after a failed deploy it is already there and the migration fails again.`
  },
  {
    pattern: new RegExp(
      String.raw`\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)(?<name>${NAME})`,
      "dgi"
    ),
    message: (name) =>
      `ADD COLUMN ${name} has no IF NOT EXISTS: on a re-run after a failed deploy the column is already there and the migration fails again.`
  },
  {
    pattern: new RegExp(
      String.raw`\bADD\s+CONSTRAINT\s+(?<name>${NAME})`,
      "dgi"
    ),
    undoneBy: "CONSTRAINT",
    message: (name) =>
      `ADD CONSTRAINT ${name} fails on a re-run after a failed deploy: the constraint is already there. Drop it first with DROP CONSTRAINT IF EXISTS, or add it in a DO block that checks pg_constraint.`
  },
  {
    pattern: new RegExp(
      String.raw`\bCREATE\s+POLICY\s+(?<name>${NAME})\s+ON\s+(?<table>${NAME})`,
      "dgi"
    ),
    undoneBy: "POLICY",
    message: (name) =>
      `CREATE POLICY ${name} fails on a re-run after a failed deploy: the policy is already there. Precede it with DROP POLICY IF EXISTS on the same table.`
  },
  {
    // CREATE OR REPLACE TRIGGER never matches: OR sits between CREATE and TRIGGER.
    pattern: new RegExp(
      String.raw`\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+(?<name>${NAME})[^;]*?\bON\s+(?<table>${NAME})`,
      "dgi"
    ),
    undoneBy: "TRIGGER",
    message: (name) =>
      `CREATE TRIGGER ${name} fails on a re-run after a failed deploy: the trigger is already there. Precede it with DROP TRIGGER IF EXISTS on the same table, or write CREATE OR REPLACE TRIGGER.`
  },
  {
    pattern: new RegExp(String.raw`\bINSERT\s+INTO\s+(?<table>${NAME})`, "dgi"),
    // An anti-join (`LEFT JOIN … WHERE x.id IS NULL`, `NOT IN (SELECT …)`,
    // `EXCEPT`) inserts only what is missing, as NOT EXISTS does.
    guardedBy:
      /\bON\s+CONFLICT\b|\bNOT\s+EXISTS\b|\bIS\s+NULL\b|\bNOT\s+IN\s*\(\s*SELECT\b|\bEXCEPT\b/i,
    message: (name) =>
      `INSERT INTO ${name} has no ON CONFLICT and no WHERE NOT EXISTS: on a re-run after a failed deploy the rows are already there, and it fails on a unique key or writes them twice.`
  }
];

function statementAt(text: string, index: number): string {
  const start = text.lastIndexOf(";", index - 1) + 1;
  const end = text.indexOf(";", index);
  return text.slice(start, end === -1 ? text.length : end);
}

const ALTER_TABLE = new RegExp(
  String.raw`^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?<table>${NAME})`,
  "di"
);

/**
 * Triggers and policies are named per table: a DROP that names a table must
 * name this one.
 */
function dropsEarlier(
  before: string,
  kind: string,
  name: string,
  table: string | undefined
): boolean {
  const drop = new RegExp(
    String.raw`\bDROP\s+${kind}\s+(?:IF\s+EXISTS\s+)?(?<names>${NAME_LIST})(?:\s+ON\s+(?<table>${NAME}))?`,
    "gi"
  );
  for (const m of before.matchAll(drop)) {
    if (!namesIn(m.groups?.names ?? "").includes(name)) continue;
    const on = m.groups?.table;
    if (table === undefined || on === undefined || normalizeName(on) === table)
      return true;
  }
  return false;
}

/** `DELETE FROM` / `TRUNCATE` of the table: a wipe and reseed repeats safely. */
function wipedEarlier(before: string, table: string): boolean {
  const wipe = new RegExp(
    String.raw`\b(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?<names>${NAME_LIST})`,
    "gi"
  );
  for (const m of before.matchAll(wipe))
    if (namesIn(m.groups?.names ?? "").includes(table)) return true;
  return false;
}

/** A temp table is new in every session, so a re-run starts it empty. */
function tempTables(sql: string): Set<string> {
  const temp = new RegExp(
    String.raw`\bCREATE\s+(?:(?:LOCAL|GLOBAL)\s+)?TEMP(?:ORARY)?\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<name>${NAME})`,
    "gi"
  );
  return new Set(
    [...sql.matchAll(temp)].map((m) => normalizeName(m.groups?.name ?? ""))
  );
}

function groupText(
  text: string,
  m: RegExpExecArray | RegExpMatchArray,
  group: string,
  offset = 0
): string | undefined {
  const span = m.indices?.groups?.[group];
  return span ? text.slice(span[0] + offset, span[1] + offset) : undefined;
}

export function scanReplaySafety(file: string, contents: string): Violation[] {
  if (contents.startsWith(GENERATED_AUTHZ_MIGRATION)) return [];
  const { top, full } = maskSql(contents);
  const code = hideIdentifiers(top);
  const temps = tempTables(top);
  const violations: Violation[] = [];
  for (const rule of RULES) {
    for (const m of code.matchAll(rule.pattern)) {
      const index = m.index ?? 0;
      const statement = statementAt(code, index);
      if (rule.guardedBy?.test(statement)) continue;

      // `code` hides identifiers, so names are read from `top` at the same offsets.
      const stmtStart = code.lastIndexOf(";", index - 1) + 1;
      const alter = ALTER_TABLE.exec(statement);
      const tableRaw =
        groupText(top, m, "table") ??
        (alter ? groupText(top, alter, "table", stmtStart) : undefined);
      const table = tableRaw ? normalizeName(tableRaw) : undefined;
      const nameRaw = groupText(top, m, "name");
      const name = nameRaw ? normalizeName(nameRaw) : (table ?? "");

      if (
        temps.has(name) ||
        name.startsWith("pg_temp.") ||
        (table && temps.has(table))
      )
        continue;

      const before = full.slice(0, index);
      if (rule.undoneBy && dropsEarlier(before, rule.undoneBy, name, table))
        continue;
      // A table dropped earlier is re-created empty, with nothing on it.
      if (table && dropsEarlier(before, "TABLE", table, undefined)) continue;
      if (rule.guardedBy && table && wipedEarlier(before, table)) continue;

      violations.push({
        file,
        line: top.slice(0, index).split("\n").length,
        snippet: top.slice(index, index + m[0].length).replace(/\s+/g, " "),
        message: rule.message(name)
      });
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

export const migrationReplaySafe: ConformanceCheck = {
  id: "migration-replay-safe",
  description:
    "Every migration statement must succeed when the migration is re-run over a failed deploy's partial state.",
  provenance: {
    deprecates: 'CREATE TABLE "x" / ADD COLUMN "y" / DROP CONSTRAINT "z"',
    replacedBy:
      'CREATE TABLE IF NOT EXISTS "x" / ADD COLUMN IF NOT EXISTS "y" / DROP CONSTRAINT IF EXISTS "z"',
    since: `after ${LAST_UNCHECKED}_job-wip-balance.sql`
  },
  scan(file, contents) {
    const timestamp = /^(\d{14})_/.exec(file)?.[1];
    if (!timestamp || timestamp <= LAST_UNCHECKED) return [];
    return scanReplaySafety(file, contents);
  }
};
