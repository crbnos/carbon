// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type SourceFile, type Violation } from "../../check";
import {
  loadScheduledConstantSources,
  SCHEDULED_WORK_CHECKS
} from "../../sources/cross-file";
import { migrations } from "../../sources/inputs";
import { nameParts, sqlNodes } from "../../sources/sql";

// pg_cron wakes a scheduled function only when its `util.*_has_work()` says a
// run would do something, and that SQL repeats the function's constants. The
// pairs compared are `SCHEDULED_WORK_CHECKS` in `src/sources/cross-file.ts`.
export const scheduledSqlConstants = defineCheck({
  id: "scheduled-sql-constants",
  description:
    "pg_cron wakes a scheduled function only when its `util.*_has_work()` says a run would do something, and that SQL repeats the function's constants.",
  // Migrations first: the runner groups a check by its first input, so this
  // check runs on the worker that has already parsed their SQL.
  reads: { migrations, constants: loadScheduledConstantSources },
  rule() {
    /** `export const NAME = 5` and `export const NAME = ["a", "b"] as const`. */
    function constantsOf(contents: string): Map<string, string> {
      const out = new Map<string, string>();
      for (const m of contents.matchAll(
        /export const (\w+)\s*=\s*(-?\d+(?:\.\d+)?|\[[^\]]*\])/g
      )) {
        const value = m[2] ?? "";
        out.set(
          m[1] ?? "",
          value.startsWith("[")
            ? [...value.matchAll(/"([^"]*)"/g)]
                .map((s) => `'${s[1]}'`)
                .join(", ")
            : value
        );
      }
      return out;
    }

    /** The newest `CREATE FUNCTION <fn>` in migration order, as it is written. */
    function newestDefinition(fn: string, migrations: SourceFile[]) {
      for (const { file, contents } of [...migrations].reverse()) {
        const definitions = [...sqlNodes(contents)].filter(
          ({ node }) =>
            "CreateFunctionStmt" in node &&
            nameParts(node.CreateFunctionStmt.funcname).join(".") === fn
        );
        const newest = definitions.at(-1);
        if (newest) return { file, body: newest.statement.text };
      }
      return null;
    }

    return ({ migrations, constants: sources }) => {
      const out: Violation[] = [];
      for (const { fn, constants, expected } of SCHEDULED_WORK_CHECKS) {
        const source = sources.find((s) => s.file === constants);
        const definition = newestDefinition(fn, migrations);
        if (!source || !definition) {
          out.push({
            file: source ? constants : "packages/database/supabase/migrations",
            line: 0,
            snippet: fn,
            message: source
              ? `No migration defines ${fn}`
              : `${constants} not found; update SCHEDULED_WORK_CHECKS`
          });
          continue;
        }
        const values = constantsOf(source.contents);
        for (const template of expected) {
          const missing = [...template.matchAll(/\{(\w+)\}/g)]
            .map((m) => m[1] ?? "")
            .filter((name) => !values.has(name));
          const text = template.replace(
            /\{(\w+)\}/g,
            (_, name: string) => values.get(name) ?? ""
          );
          if (missing.length === 0 && definition.body.includes(text)) continue;
          out.push({
            file: definition.file,
            line: 0,
            snippet: `${fn}: ${template}`,
            message: missing.length
              ? `${missing.join(", ")} not exported from ${constants}`
              : `${fn} must contain ${text} to match ${constants}; redefine it in a new migration`
          });
        }
      }
      return out;
    };
  }
});
