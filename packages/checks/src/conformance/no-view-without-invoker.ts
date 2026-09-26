import type { ConformanceCheck, Violation } from "../check";

/**
 * Matches a `CREATE [OR REPLACE] VIEW` header up to `AS`, capturing an optional
 * `WITH (...)` option list. `CREATE MATERIALIZED VIEW` never matches, because
 * `MATERIALIZED` is not among the tokens allowed between `CREATE` and `VIEW`:
 * a materialized view cannot run as its caller at all, so the clause does not
 * apply to it (it must have SELECT revoked from anon and authenticated
 * instead).
 *
 * Every view in "public" is a PostgREST endpoint reachable with the anon key the
 * apps publish. Without `security_invoker` a view runs as its owner and the RLS
 * on the tables underneath never sees the caller — `openJobMaterialLines`
 * served every company's rows to anyone for months, after four migrations
 * recreated it from a copy that lacked the clause.
 *
 * Any mention of `security_invoker` in the option list passes, including
 * `security_invoker = false`: the rule is that a view states how it runs, so an
 * owner-rights view is a visible decision rather than an omission.
 */
const CREATE_VIEW =
  /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:RECURSIVE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?)\s*(?:\(\s*[^)]*\))?\s*(WITH\s*\([^)]*\))?\s*AS\b/gi;

/**
 * `ALTER VIEW … RESET (security_invoker)` puts a view back on the owner-rights
 * default just as silently as a recreation without the clause does.
 */
const RESET_INVOKER =
  /ALTER\s+VIEW\s+(?:IF\s+EXISTS\s+)?((?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?)\s+RESET\s*\([^)]*security_invoker[^)]*\)/gi;

/**
 * Blank out `--` and `/* … *\/` comments, keeping every newline so line numbers
 * stay right.
 */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

function lineOf(sql: string, index: number | undefined): number {
  return sql.slice(0, index).split("\n").length;
}

export const noViewWithoutInvoker: ConformanceCheck = {
  id: "no-view-without-invoker",
  description:
    "A view must state security_invoker, or it runs as its owner and bypasses RLS.",
  provenance: {
    deprecates: 'CREATE OR REPLACE VIEW "x" AS',
    replacedBy: 'CREATE OR REPLACE VIEW "x" WITH (security_invoker = true) AS',
    since: "20260926093417_open-job-material-lines-invoker.sql"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    const sql = stripComments(contents);
    for (const m of sql.matchAll(CREATE_VIEW)) {
      const options = m[2] ?? "";
      if (/security_invoker/i.test(options)) continue;
      violations.push({
        file,
        line: lineOf(sql, m.index),
        snippet: m[0].replace(/\s+/g, " "),
        message: `View ${m[1]} has no security_invoker, so it runs as its owner: the RLS on the tables underneath never applies, and PostgREST serves every company's rows to anyone holding the anon key. Add WITH (security_invoker = true).`
      });
    }
    for (const m of sql.matchAll(RESET_INVOKER)) {
      violations.push({
        file,
        line: lineOf(sql, m.index),
        snippet: m[0].replace(/\s+/g, " "),
        message: `RESET (security_invoker) puts view ${m[1]} back on owner rights, bypassing RLS for every PostgREST caller. Use SET (security_invoker = true), or state security_invoker = false if owner rights are intended.`
      });
    }
    return violations;
  }
};
