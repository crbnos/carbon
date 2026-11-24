// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Node } from "libpg-query";
import {
  type Check,
  type ConformanceCheck,
  eachFile,
  fileCheck,
  type Violation
} from "../check";
import { blankComments } from "../sources/comments";
import { read } from "../sources/cross-file";
import { migrations, typescript } from "../sources/inputs";
import {
  ancestorsOf,
  nameParts,
  nodesIn,
  relationName,
  sqlFragments,
  sqlNodes
} from "../sources/sql";
import { lineOf } from "../sources/text";

// Accounting: rules for the schema and the readers of the general ledger. A
// foreign key to an account restricts its delete and is classified for the
// chart of accounts import, and a journal reader filters status with a named
// status list.

/** The migration that made every foreign key to `account` RESTRICT. Older ones are history. */
const SINCE = "20261013005642";

export const ACCOUNT_REFERENCE_POLICY_FILE =
  "packages/database/src/account-import.ts";

export type AccountReferencePolicy = {
  /** `table.column` pairs REFERENCE_POLICY lists. */
  classified: ReadonlySet<string>;
  /** UNCLASSIFIED_ACCOUNT_REFERENCES: each a table or a `table.column`. */
  unclassified: readonly string[];
};

function exportedArray(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  const end = source.indexOf("\n];", start);
  if (start === -1 || end === -1) {
    throw new Error(
      `${name} not found in ${ACCOUNT_REFERENCE_POLICY_FILE}; update account-fk-classified to read where it moved.`
    );
  }
  return source.slice(start, end);
}

/**
 * Read from the source of `account-import.ts` so this package does not depend
 * on `@carbon/database`.
 */
export function parseReferencePolicy(source: string): AccountReferencePolicy {
  const classified = new Set(
    [
      ...exportedArray(source, "REFERENCE_POLICY").matchAll(
        /\btable:\s*"([^"]+)",\s*column:\s*"([^"]+)"/g
      )
    ].map(([, table, column]) => `${table}.${column}`)
  );
  const unclassified = [
    ...exportedArray(source, "UNCLASSIFIED_ACCOUNT_REFERENCES").matchAll(
      /"([^"]+)"/g
    )
  ].map(([, ref]) => ref as string);
  return { classified, unclassified };
}

export function loadAccountReferencePolicy(
  root: string
): AccountReferencePolicy {
  return parseReferencePolicy(
    read(root, ACCOUNT_REFERENCE_POLICY_FILE).contents
  );
}

type AccountReference = {
  line: number;
  snippet: string;
  /** Whether the key is ON DELETE RESTRICT. */
  restricts: boolean;
  /** `table.column`; undefined when the statement names no column. */
  ref: string | undefined;
};

/** Every foreign key to `account` a migration writes, in a table or a column. */
function accountReferences(file: string, contents: string): AccountReference[] {
  if (file < SINCE) return [];
  const references: AccountReference[] = [];
  for (const found of sqlNodes(contents)) {
    const { node, fragment } = found;
    if (!("Constraint" in node)) continue;
    const { contype, pktable, fk_attrs, fk_del_action } = node.Constraint;
    if (contype !== "CONSTR_FOREIGN" || !pktable) continue;
    if (relationName(pktable) !== "account") continue;

    let table: string | undefined;
    let column = nameParts(fk_attrs)[0];
    for (const parent of ancestorsOf(found)) {
      if ("CreateStmt" in parent && parent.CreateStmt.relation) {
        table ??= relationName(parent.CreateStmt.relation);
      }
      if ("AlterTableStmt" in parent && parent.AlterTableStmt.relation) {
        table ??= relationName(parent.AlterTableStmt.relation);
      }
      if ("ColumnDef" in parent) column ??= parent.ColumnDef.colname;
    }
    const ref = table && column ? `${table}.${column}` : undefined;
    references.push({
      line: fragment.lineAt(pktable.location),
      snippet: `${ref ?? "?"} REFERENCES account`,
      restricts: fk_del_action === "r",
      ref
    });
  }
  return references;
}

const provenance = {
  deprecates: 'REFERENCES "account"("id") ON DELETE SET NULL',
  replacedBy: 'REFERENCES "account"("id") ON DELETE RESTRICT',
  since: "20261013005642_account-delete-restrict.sql"
};

/**
 * Fails a foreign key to `account` that is not `ON DELETE RESTRICT`: inline, a
 * table-level `FOREIGN KEY`, or `ALTER TABLE … ADD CONSTRAINT`. `SET NULL` let
 * a deleted account silently empty Draft and Provisional journal lines. `NO
 * ACTION` and no `ON DELETE` fail too, because the default is not a stated
 * decision.
 *
 * Only the table `account` matches, with or without `public.`.
 * `accountingPeriod`, `accountDefault`, a quoted `"Account"` and another
 * schema's `account` do not. Migrations before `SINCE` are history.
 *
 * The baselined keys (`project.costAccountId`, `projectElement.costAccountId`,
 * `purchaseOrderLineVersion.accountId`, all `ON DELETE SET NULL`) were reviewed
 * and wait for a decision. Each fix is a schema change, so the user decides. A
 * version snapshot may want `history` rather than `RESTRICT` semantics.
 */
export const accountFkRestrict = fileCheck(migrations, {
  id: "account-fk-restrict",
  description: "A foreign key to account must be ON DELETE RESTRICT.",
  provenance,
  scan(file, contents) {
    return accountReferences(file, contents)
      .filter(({ restricts }) => !restricts)
      .map(({ line, snippet }) => ({
        file,
        line,
        snippet,
        message:
          "A foreign key to account must be ON DELETE RESTRICT: SET NULL lets a deleted account silently empty Draft and Provisional lines, and no ON DELETE leaves the choice unstated. Add ON DELETE RESTRICT, and classify the column in REFERENCE_POLICY (packages/database/src/account-import.ts)."
      }));
  }
});

const ABOUT = {
  id: "account-fk-classified",
  description:
    "A column with a foreign key to account must be classified in REFERENCE_POLICY.",
  provenance
};

/**
 * The apply-account-import live test checks the catalog; this catches a
 * missing class without a database.
 *
 * Fails a column with a foreign key to `account` that `REFERENCE_POLICY` does
 * not list. `UNCLASSIFIED_ACCOUNT_REFERENCES` exempts `accountDefault`,
 * `fixedAssetClass` and `account.parentId`; the live test imports the same
 * list. The column is named from the enclosing `CREATE TABLE` or `ALTER TABLE`
 * and the `FOREIGN KEY (…)` list or the column definition. A key whose table or
 * column it cannot name, or one built by `EXECUTE format(...)`, is skipped; the
 * live test still covers it.
 */
export function accountFkClassified({
  classified,
  unclassified
}: AccountReferencePolicy): ConformanceCheck {
  return {
    ...ABOUT,
    scan(file, contents) {
      const violations: Violation[] = [];
      for (const { line, snippet, ref } of accountReferences(file, contents)) {
        if (
          !ref ||
          classified.has(ref) ||
          unclassified.some((u) => ref === u || ref.startsWith(`${u}.`))
        ) {
          continue;
        }
        violations.push({
          file,
          line,
          snippet,
          message: `${ref} names an account but is not in REFERENCE_POLICY (packages/database/src/account-import.ts), so the chart of accounts import cannot tell whether a merge may move it. Classify it: repoint, repoint-if-status, repoint-if-parent-status or history.`
        });
      }
      return violations;
    }
  };
}

export const accountFkClassifiedCheck: Check = {
  ...ABOUT,
  find: (repo) =>
    eachFile(
      repo.read(migrations),
      accountFkClassified(repo.read(loadAccountReferencePolicy)).scan
    )
};

// A journal reader that filters `status <> 'Draft'` counts every non-Draft
// status, so the Provisional and Superseded journals of the accounting cutover
// land in the balances. Journal readers pick one of the named status lists
// instead: GL (Posted, Reversed), document, or open item.
//
// The check works per STATEMENT, not per file: a not-Draft filter is flagged
// only when the statement that holds it reads the journal table. In a
// migration, a statement is one the SQL parser returns (see `scanSql`). In
// TypeScript, a statement is the text between two semicolons, comments
// blanked: one query chain, or one raw SQL text in a sql`` template or a
// `client.query(...)` string. A chain built across several variables
// (`let q = …; q = q.where(…)`) is split at its first `;` and escapes the
// check.

// Migrations older than the one that changed the GL readers hold the old
// `status <> 'Draft'` readers, which later migrations replace. They are
// history, so the SQL side starts there. Migration filenames start with a
// 14-digit timestamp, so string order is chronological.
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
        const line = lineOf(text, start + (m.index ?? 0));
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

/** `'Draft'`, with or without a cast to the status type. */
function isDraft(node: Node | undefined): boolean {
  if (!node) return false;
  if ("TypeCast" in node) return isDraft(node.TypeCast.arg);
  return "A_Const" in node && node.A_Const.sval?.sval === "Draft";
}

/** The qualifier of a `status` column (`j` in `j.status`, "" for none), else undefined. */
function statusQualifier(node: Node | undefined): string | undefined {
  if (!node || !("ColumnRef" in node)) return undefined;
  const fields = nameParts(node.ColumnRef.fields);
  if (fields.at(-1) !== "status") return undefined;
  return fields.at(-2)?.toLowerCase() ?? "";
}

/**
 * The qualifier of the status a not-Draft filter tests: `status <> 'Draft'`
 * (either way round; the parser reads `!=` as `<>`), `status NOT IN ('Draft', …)`
 * or `status IS DISTINCT FROM 'Draft'`.
 */
function notDraftStatus(node: Node): string | undefined {
  if (!("A_Expr" in node)) return undefined;
  const { kind, name, lexpr, rexpr } = node.A_Expr;
  const operator = nameParts(name)[0];
  if (kind === "AEXPR_OP" && operator === "<>") {
    if (isDraft(rexpr)) return statusQualifier(lexpr);
    if (isDraft(lexpr)) return statusQualifier(rexpr);
  }
  if (kind === "AEXPR_IN" && operator === "<>" && rexpr && "List" in rexpr) {
    if (rexpr.List.items?.some(isDraft)) return statusQualifier(lexpr);
  }
  if (kind === "AEXPR_DISTINCT" && isDraft(rexpr))
    return statusQualifier(lexpr);
  return undefined;
}

/** `journal` and its aliases in a statement; empty when it does not read the table. */
function journalNamesIn(statement: unknown, names = new Set<string>()) {
  if (Array.isArray(statement)) {
    for (const item of statement) journalNamesIn(item, names);
    return names;
  }
  if (statement === null || typeof statement !== "object") return names;
  const table: { relname?: unknown; schemaname?: unknown; alias?: unknown } =
    statement;
  if (
    table.relname === "journal" &&
    (table.schemaname === undefined || table.schemaname === "public")
  ) {
    names.add("journal");
    const alias: { aliasname?: unknown } = table.alias ?? {};
    if (typeof alias.aliasname === "string") {
      names.add(alias.aliasname.toLowerCase());
    }
  }
  for (const value of Object.values(statement)) journalNamesIn(value, names);
  return names;
}

/**
 * A migration, read as parsed SQL. A statement is one the parser returns: a
 * top-level one, or one inside a function body or DO block.
 */
function scanSql(file: string, contents: string): Violation[] {
  const flagged = new Set<number>();
  const violations: Violation[] = [];
  for (const fragment of sqlFragments(contents)) {
    for (const statement of fragment.statements) {
      const names = journalNamesIn(statement.node);
      if (names.size === 0) continue;
      for (const { node, location } of nodesIn(statement.node)) {
        const qualifier = notDraftStatus(node);
        if (qualifier === undefined) continue;
        if (qualifier !== "" && !names.has(qualifier)) continue;
        const line = fragment.lineAt(location);
        if (flagged.has(line)) continue;
        flagged.add(line);
        violations.push({
          file,
          line,
          snippet: `${qualifier === "" ? "" : `${qualifier}.`}status is not 'Draft'`,
          message: MESSAGE
        });
      }
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

export const journalStatusFilter: ConformanceCheck & Check = {
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
      return scanSql(file, contents);
    }
    return scanStatements(file, contents, blankComments(contents), TS_JOURNAL, [
      ...TS_NOT_DRAFT,
      ...SQL_NOT_DRAFT
    ]);
  },
  find: (repo) => [
    ...eachFile(repo.read(migrations), journalStatusFilter.scan),
    ...eachFile(repo.read(typescript), journalStatusFilter.scan)
  ]
};

/** The accounting checks, in the order they are written above. */
export const checks: Check[] = [
  accountFkRestrict,
  accountFkClassifiedCheck,
  journalStatusFilter
];
