// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Node } from "libpg-query";
import { defineCheck, eachFile, type Violation } from "../../check";
import { blankComments } from "../../sources/comments";
import { migrations, typescript } from "../../sources/inputs";
import { nameParts, nodesIn, sqlFragments } from "../../sources/sql";
import { lineOf } from "../../sources/text";

// A journal reader that filters `status <> 'Draft'` counts every non-Draft
// status, so the Provisional and Superseded journals of the accounting cutover
// land in the balances. Journal readers pick one of the named status lists
// instead: GL (Posted, Reversed), document, or open item.
//
// The check works per STATEMENT, not per file: a not-Draft filter is flagged
// only when the statement that holds it reads the journal table (or the
// `journalLines` view, which carries each line's journal status). In a
// migration, a statement is one the SQL parser returns (see `scanSql`). In
// TypeScript, a statement is the text between two semicolons, comments
// blanked: one query chain, or one raw SQL text in a sql`` template or a
// `client.query(...)` string. A chain built across several variables
// (`let q = …; q = q.where(…)`) is split at its first `;` and escapes the
// check.
export const journalStatusFilter = defineCheck({
  id: "journal-status-filter",
  description:
    "Journal readers filter status with a named status list, not `status <> 'Draft'`",
  provenance: {
    deprecates: "journal status filters written as status <> 'Draft'",
    replacedBy:
      "GL_JOURNAL_STATUSES, DOCUMENT_JOURNAL_STATUSES or OPEN_ITEM_JOURNAL_STATUSES from @carbon/database/accounting-posting",
    since: "20261009005144",
    incidents: ["c0cf421500"]
  },
  // Migrations first: the runner groups a check by its first input, so this
  // check runs on the worker that has already parsed their SQL.
  reads: { migrations, typescript },
  rule() {
    // Migrations older than the one that changed the GL readers hold the old
    // `status <> 'Draft'` readers, which later migrations replace. They are
    // history, so the SQL side starts there. Migration filenames start with a
    // 14-digit timestamp, so string order is chronological.
    const sinceMigration = "20261009005144";

    // `status`, quoted or not, qualified or not. The qualifier is captured as
    // `q`: a qualified status counts only when `q` is the journal table or one
    // of its aliases in the statement, so `i."status" NOT IN ('Draft', …)` in a
    // query that also joins journal is the invoice's filter, not the journal's.
    const status = String.raw`(?:"?(?<q>\w+)"?\s*\.\s*)?"?status"?`;
    // A `status` key in a TS call: `"status"`, `"j.status"`, `"journal.status"`.
    const statusKey = String.raw`["'\x60](?:(?<q>\w+)\.)?status["'\x60]`;
    const draftKey = String.raw`["'\x60]Draft["'\x60]`;

    // Not-Draft filters written in SQL — a migration, or raw SQL inside TS.
    const sqlNotDraft = [
      new RegExp(String.raw`\b${status}\s*(?:<>|!=)\s*'Draft'`, "gi"),
      new RegExp(
        String.raw`'Draft'(?:::"?\w+"?)?\s*(?:<>|!=)\s*${status}`,
        "gi"
      ),
      new RegExp(String.raw`\b${status}\s+NOT\s+IN\s*\([^)]*'Draft'`, "gi"),
      new RegExp(String.raw`\b${status}\s+IS\s+DISTINCT\s+FROM\s+'Draft'`, "gi")
    ];

    // Not-Draft filters written with the Supabase or Kysely builders.
    const tsNotDraft = [
      // .neq("status", "Draft")
      new RegExp(String.raw`\.neq\(\s*${statusKey}\s*,\s*${draftKey}`, "g"),
      // .where("j.status", "<>", "Draft"), eb("status", "!=", "Draft"),
      // .filter("status", "neq", "Draft")
      new RegExp(
        String.raw`${statusKey}\s*,\s*["'\x60](?:<>|!=|neq)["'\x60]\s*,\s*${draftKey}`,
        "g"
      ),
      // .where("status", "not in", ["Draft", …])
      new RegExp(
        String.raw`${statusKey}\s*,\s*["'\x60]not in["'\x60]\s*,\s*\[[^\]]*${draftKey}`,
        "gi"
      ),
      // .not("status", "eq", "Draft"), .not("status", "in", '("Draft")')
      new RegExp(
        String.raw`\.not\(\s*${statusKey}\s*,\s*["'\x60](?:eq|in)["'\x60]\s*,[^)]*Draft`,
        "g"
      )
    ];

    // The statement reads the journal table, or the `journalLines` view, which
    // carries the journal's status on each line: quoted or not, aliased or not.
    const tsJournal = [
      /\b(?:FROM|JOIN|UPDATE)\s+(?:"?public"?\s*\.\s*)?"?journal(?:Lines)?"?(?![\w"])/i,
      /\bjournal(?:Lines)?"?\s*\.\s*"?status\b/i,
      // .from("journal"), selectFrom("journal as j"), innerJoin("journal as j", …)
      /\b(?:from|selectFrom|innerJoin|leftJoin|rightJoin|fullJoin|updateTable|deleteFrom)\(\s*["'`]journal(?:Lines)?(?:\s+as\s+\w+)?["'`]/,
      // a Supabase embed: select("…, journal!inner(status)")
      /\bjournal(?:!\w+)?\s*\(/
    ];

    // `FROM journal j`, `JOIN "journal" AS j`, `"journal as j"` — the alias.
    const journalAlias = [
      /\b(?:FROM|JOIN)\s+(?:"?public"?\s*\.\s*)?"?journal(?:Lines)?"?\s+(?:AS\s+)?"?(\w+)"?/gi,
      /["'`]journal(?:Lines)?\s+as\s+(\w+)["'`]/g
    ];
    const notAnAlias = new Set([
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

    // The relation names that read the journal: the table, and the
    // `journalLines` view, which carries the journal's status on each line.
    // The parser lower-cases an unquoted name (`journallines`); a quoted one
    // keeps its case.
    const journalRelations = new Set([
      "journal",
      "journalLines",
      "journallines"
    ]);

    const message =
      "Filter journal status with GL_JOURNAL_STATUSES, DOCUMENT_JOURNAL_STATUSES or OPEN_ITEM_JOURNAL_STATUSES (@carbon/database/accounting-posting).";

    // The names a status may be qualified with to mean the journal's status.
    const journalNames = (statement: string): Set<string> => {
      const names = new Set(["journal", "journallines"]);
      for (const pattern of journalAlias) {
        for (const m of statement.matchAll(pattern)) {
          const alias = m[1]?.toLowerCase();
          if (alias && !notAnAlias.has(alias)) names.add(alias);
        }
      }
      return names;
    };

    // The [start, end) offsets of the text between consecutive semicolons.
    const statements = (text: string): Array<[number, number]> => {
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
    };

    // A TypeScript file, one semicolon-separated statement at a time.
    const scanStatements = (file: string, contents: string): Violation[] => {
      const text = blankComments(contents);
      const notDraft = [...tsNotDraft, ...sqlNotDraft];
      const lines = contents.split("\n");
      const flagged = new Set<number>();
      const violations: Violation[] = [];
      for (const [start, end] of statements(text)) {
        const statement = text.slice(start, end);
        if (!statement.includes("Draft")) continue;
        if (!tsJournal.some((pattern) => pattern.test(statement))) continue;
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
              message
            });
          }
        }
      }
      return violations.sort((a, b) => a.line - b.line);
    };

    // `'Draft'`, with or without a cast to the status type.
    const isDraft = (node: Node | undefined): boolean => {
      if (!node) return false;
      if ("TypeCast" in node) return isDraft(node.TypeCast.arg);
      return "A_Const" in node && node.A_Const.sval?.sval === "Draft";
    };

    // The qualifier of a `status` column (`j` in `j.status`, "" for none),
    // else undefined.
    const statusQualifier = (node: Node | undefined): string | undefined => {
      if (!node || !("ColumnRef" in node)) return undefined;
      const fields = nameParts(node.ColumnRef.fields);
      if (fields.at(-1) !== "status") return undefined;
      return fields.at(-2)?.toLowerCase() ?? "";
    };

    // The qualifier of the status a not-Draft filter tests: `status <> 'Draft'`
    // (either way round; the parser reads `!=` as `<>`),
    // `status NOT IN ('Draft', …)` or `status IS DISTINCT FROM 'Draft'`.
    const notDraftStatus = (node: Node): string | undefined => {
      if (!("A_Expr" in node)) return undefined;
      const { kind, name, lexpr, rexpr } = node.A_Expr;
      const operator = nameParts(name)[0];
      if (kind === "AEXPR_OP" && operator === "<>") {
        if (isDraft(rexpr)) return statusQualifier(lexpr);
        if (isDraft(lexpr)) return statusQualifier(rexpr);
      }
      if (
        kind === "AEXPR_IN" &&
        operator === "<>" &&
        rexpr &&
        "List" in rexpr
      ) {
        if (rexpr.List.items?.some(isDraft)) return statusQualifier(lexpr);
      }
      if (kind === "AEXPR_DISTINCT" && isDraft(rexpr))
        return statusQualifier(lexpr);
      return undefined;
    };

    // The journal (or `journalLines`) and its aliases in a statement,
    // lower-cased as a status qualifier is; empty when it reads neither.
    const journalNamesIn = (
      statement: unknown,
      names = new Set<string>()
    ): Set<string> => {
      if (Array.isArray(statement)) {
        for (const item of statement) journalNamesIn(item, names);
        return names;
      }
      if (statement === null || typeof statement !== "object") return names;
      const table: {
        relname?: unknown;
        schemaname?: unknown;
        alias?: unknown;
      } = statement;
      if (
        typeof table.relname === "string" &&
        journalRelations.has(table.relname) &&
        (table.schemaname === undefined || table.schemaname === "public")
      ) {
        names.add(table.relname.toLowerCase());
        const alias: { aliasname?: unknown } = table.alias ?? {};
        if (typeof alias.aliasname === "string") {
          names.add(alias.aliasname.toLowerCase());
        }
      }
      for (const value of Object.values(statement)) {
        journalNamesIn(value, names);
      }
      return names;
    };

    // A migration, read as parsed SQL. A statement is one the parser returns:
    // a top-level one, or one inside a function body or DO block.
    const scanSql = (file: string, contents: string): Violation[] => {
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
              message
            });
          }
        }
      }
      return violations.sort((a, b) => a.line - b.line);
    };

    return ({ migrations, typescript }) =>
      eachFile([...migrations, ...typescript], (file, contents) => {
        if (!contents.includes("Draft") || !/journal/i.test(contents)) {
          return [];
        }
        if (file.endsWith(".sql")) {
          const basename = file.slice(file.lastIndexOf("/") + 1);
          if (basename < sinceMigration) return [];
          return scanSql(file, contents);
        }
        return scanStatements(file, contents);
      });
  }
});
