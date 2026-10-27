// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";

export const SCHEDULED_SQL_CONSTANTS = "scheduled-sql-constants";

const SCHEDULED = "packages/jobs/src/inngest/functions/scheduled";

/**
 * pg_cron wakes a scheduled function only when its `util.*_has_work()` says a
 * run would do something, and that SQL repeats the function's constants. A
 * constant changed on one side only either wakes the function for nothing or
 * leaves work undone. `{NAME}` is the constant's value; a string array is
 * written as SQL literals, `'a', 'b'`.
 */
export const SCHEDULED_WORK_CHECKS = [
  {
    fn: "util.notification_digest_has_work",
    constants: `${SCHEDULED}/notification-digest.ts`,
    expected: [
      "c.total >= {DIGEST_THRESHOLD}",
      "interval '{DIGEST_MIN_AGE_MIN} minutes'"
    ]
  },
  {
    fn: "util.workflow_run_retention_has_work",
    constants: `${SCHEDULED}/workflow-run-retention.ts`,
    expected: [
      "interval '{STALE_RUN_HOURS} hours'",
      "interval '{FULL_DETAIL_DAYS} days'",
      "interval '{COMPACT_DETAIL_DAYS} days'",
      "interval '{RUN_HEADER_DAYS} days'",
      "IN ({TERMINAL})"
    ]
  }
];

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
        ? [...value.matchAll(/"([^"]*)"/g)].map((s) => `'${s[1]}'`).join(", ")
        : value
    );
  }
  return out;
}

/** The newest `CREATE OR REPLACE FUNCTION <fn>(` body in migration order. */
function newestDefinition(fn: string, migrations: SourceFile[]) {
  const marker = `CREATE OR REPLACE FUNCTION ${fn}(`;
  for (const { file, contents } of [...migrations].reverse()) {
    const start = contents.lastIndexOf(marker);
    if (start === -1) continue;
    const end = contents.indexOf("$$;", start);
    return { file, body: contents.slice(start, end === -1 ? undefined : end) };
  }
  return null;
}

export function findScheduledSqlDrift(
  migrations: SourceFile[],
  sources: SourceFile[]
): Violation[] {
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
        .map((m) => m[1] as string)
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
}
