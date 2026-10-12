// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";
import { blankComments } from "./no-unscoped-kysely-write";

// A journal reader that filters `status <> 'Draft'` counts every non-Draft
// status, so the Provisional and Superseded journals of the accounting cutover
// land in the balances. Journal readers pick one of the named status lists
// instead: GL (Posted, Reversed), document, or open item.
//
// The check works per STATEMENT, not per file: a not-Draft filter is flagged
// only when the statement that holds it reads the journal table. A statement
// is the text between two semicolons, comments blanked — in SQL that is one
// statement (a plpgsql body splits into its own statements), in TypeScript it
// is one query chain, or one raw SQL text in a sql`` template or a
// `client.query(...)` string. A chain built across several variables
// (`let q = …; q = q.where(…)`) is split at its first `;` and escapes the
// check.

// Migrations older than the one that changed the GL readers have false
// positives (`j` is also the alias of `job`), so the SQL side starts there.
// Migration filenames start with a 14-digit timestamp, so string order is
// chronological.
const SINCE_MIGRATION = "20261009005144";

/**
 * `status`, quoted or not, qualified or not. The qualifier is captured as `q`:
 * a qualified status counts only when `q` is the journal table or one of its
 * aliases in the statement, so `i."status" NOT IN ('Draft', …)` in a query
 * that also joins journal is the invoice's filter, not the journal's.
 */
const STATUS = String.raw`(?:"?(?<q>\w+)"?\s*\.\s*)?"?status"?`;
/** A `status` key in a TS call: `"status"`, `"j.status"`, `"journal.status"`. */
const STATUS_KEY = String.raw`["'\x60](?:(?<q>\w+)\.)?status["'\x60]`;
const DRAFT_KEY = String.raw`["'\x60]Draft["'\x60]`;

/** Not-Draft filters written in SQL — a migration, or raw SQL inside TS. */
const SQL_NOT_DRAFT = [
  new RegExp(String.raw`\b${STATUS}\s*(?:<>|!=)\s*'Draft'`, "gi"),
  new RegExp(String.raw`'Draft'(?:::"?\w+"?)?\s*(?:<>|!=)\s*${STATUS}`, "gi"),
  new RegExp(String.raw`\b${STATUS}\s+NOT\s+IN\s*\([^)]*'Draft'`, "gi"),
  new RegExp(String.raw`\b${STATUS}\s+IS\s+DISTINCT\s+FROM\s+'Draft'`, "gi")
];

/** Not-Draft filters written with the Supabase or Kysely builders. */
const TS_NOT_DRAFT = [
  // .neq("status", "Draft")
  new RegExp(String.raw`\.neq\(\s*${STATUS_KEY}\s*,\s*${DRAFT_KEY}`, "g"),
  // .where("j.status", "<>", "Draft"), eb("status", "!=", "Draft"),
  // .filter("status", "neq", "Draft")
  new RegExp(
    String.raw`${STATUS_KEY}\s*,\s*["'\x60](?:<>|!=|neq)["'\x60]\s*,\s*${DRAFT_KEY}`,
    "g"
  ),
  // .where("status", "not in", ["Draft", …])
  new RegExp(
    String.raw`${STATUS_KEY}\s*,\s*["'\x60]not in["'\x60]\s*,\s*\[[^\]]*${DRAFT_KEY}`,
    "gi"
  ),
  // .not("status", "eq", "Draft"), .not("status", "in", '("Draft")')
  new RegExp(
    String.raw`\.not\(\s*${STATUS_KEY}\s*,\s*["'\x60](?:eq|in)["'\x60]\s*,[^)]*Draft`,
    "g"
  )
];

/** The statement reads the journal table: quoted or not, aliased or not. */
const SQL_JOURNAL = [
  /\b(?:FROM|JOIN|UPDATE)\s+(?:"?public"?\s*\.\s*)?"?journal"?(?![\w"])/i,
  /\bjournal"?\s*\.\s*"?status\b/i
];
const TS_JOURNAL = [
  ...SQL_JOURNAL,
  // .from("journal"), selectFrom("journal as j"), innerJoin("journal as j", …)
  /\b(?:from|selectFrom|innerJoin|leftJoin|rightJoin|fullJoin|updateTable|deleteFrom)\(\s*["'`]journal(?:\s+as\s+\w+)?["'`]/,
  // a Supabase embed: select("…, journal!inner(status)")
  /\bjournal(?:!\w+)?\s*\(/
];

/** `FROM journal j`, `JOIN "journal" AS j`, `"journal as j"` — the alias. */
const JOURNAL_ALIAS = [
  /\b(?:FROM|JOIN)\s+(?:"?public"?\s*\.\s*)?"?journal"?\s+(?:AS\s+)?"?(\w+)"?/gi,
  /["'`]journal\s+as\s+(\w+)["'`]/g
];
const NOT_AN_ALIAS = new Set([
  "on",
  "where",
  "join",
  "left",
  "right",
  "inner",
  "full",
  "cross",
  "using",
  "group",
  "order",
  "limit",
  "set",
  "natural",
  "lateral",
  "union",
  "window"
]);

/** The names a status may be qualified with to mean the journal's status. */
function journalNames(statement: string): Set<string> {
  const names = new Set(["journal"]);
  for (const pattern of JOURNAL_ALIAS) {
    for (const m of statement.matchAll(pattern)) {
      const alias = m[1]?.toLowerCase();
      if (alias && !NOT_AN_ALIAS.has(alias)) names.add(alias);
    }
  }
  return names;
}

const MESSAGE =
  "Filter journal status with GL_JOURNAL_STATUSES, DOCUMENT_JOURNAL_STATUSES or OPEN_ITEM_JOURNAL_STATUSES (@carbon/database/accounting-posting).";

function basename(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

/** Replace SQL comment text with spaces, keeping newlines and offsets. */
function blankSqlComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (c) => " ".repeat(c.length));
}

/** The [start, end) offsets of the text between consecutive semicolons. */
function statements(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ";") {
      out.push([start, i]);
      start = i + 1;
    }
  }
  out.push([start, text.length]);
  return out;
}

function scanStatements(
  file: string,
  contents: string,
  text: string,
  journal: RegExp[],
  notDraft: RegExp[]
): Violation[] {
  const lines = contents.split("\n");
  const flagged = new Set<number>();
  const violations: Violation[] = [];
  for (const [start, end] of statements(text)) {
    const statement = text.slice(start, end);
    if (!statement.includes("Draft")) continue;
    if (!journal.some((pattern) => pattern.test(statement))) continue;
    const names = journalNames(statement);
    for (const pattern of notDraft) {
      for (const m of statement.matchAll(pattern)) {
        const qualifier = m.groups?.q?.toLowerCase();
        if (qualifier && !names.has(qualifier)) continue;
        const line = text.slice(0, start + (m.index ?? 0)).split("\n").length;
        if (flagged.has(line)) continue;
        flagged.add(line);
        violations.push({
          file,
          line,
          snippet: (lines[line - 1] ?? "").trim(),
          message: MESSAGE
        });
      }
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

export const journalStatusFilter: ConformanceCheck = {
  id: "journal-status-filter",
  description:
    "Journal readers filter status with a named status list, not `status <> 'Draft'`",
  provenance: {
    deprecates: "journal status filters written as status <> 'Draft'",
    replacedBy:
      "GL_JOURNAL_STATUSES, DOCUMENT_JOURNAL_STATUSES or OPEN_ITEM_JOURNAL_STATUSES from @carbon/database/accounting-posting",
    since: SINCE_MIGRATION
  },
  scan(file: string, contents: string): Violation[] {
    if (!contents.includes("Draft") || !/journal/i.test(contents)) return [];
    if (file.endsWith(".sql")) {
      if (basename(file) < SINCE_MIGRATION) return [];
      return scanStatements(
        file,
        contents,
        blankSqlComments(contents),
        SQL_JOURNAL,
        SQL_NOT_DRAFT
      );
    }
    return scanStatements(file, contents, blankComments(contents), TS_JOURNAL, [
      ...TS_NOT_DRAFT,
      ...SQL_NOT_DRAFT
    ]);
  }
};
