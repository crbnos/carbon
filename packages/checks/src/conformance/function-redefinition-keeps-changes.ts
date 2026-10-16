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
  const definitions = new Map<string, { file: string; lines: Set<string> }[]>();
  for (const { file, contents } of [...migrations].sort((a, b) =>
    a.file.localeCompare(b.file)
  )) {
    for (const { name, lines } of functionBodies(contents)) {
      const list = definitions.get(name) ?? [];
      list.push({ file, lines });
      definitions.set(name, list);
    }
  }

  const out: Violation[] = [];
  for (const [name, list] of definitions) {
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
        snippet: `${name} drops ${previous.file}`,
        message: `${current.file} redefines ${name} without ${dropped.length} lines that ${previous.file} added (e.g. "${dropped[0]}"). Start the CREATE OR REPLACE from the newest definition. If the change is removed on purpose, say so in the migration header and baseline this finding.`
      });
    }
  }
  return out;
}

/** Each `CREATE [OR REPLACE] FUNCTION`'s name and body lines, comments and blanks left out. */
function functionBodies(sql: string): { name: string; lines: Set<string> }[] {
  const out: { name: string; lines: Set<string> }[] = [];
  const header =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?([A-Za-z_]\w*)"?\s*\(/gi;
  for (const match of sql.matchAll(header)) {
    const rest = sql.slice(match.index);
    const tag = /\$[A-Za-z_]*\$/.exec(rest);
    if (!tag) continue;
    const start = match.index + tag.index + tag[0].length;
    const end = sql.indexOf(tag[0], start);
    if (end < 0) continue;
    const lines = new Set(
      sql
        .slice(start, end)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 12 && !line.startsWith("--"))
    );
    out.push({ name: match[1]!, lines });
  }
  return out;
}
