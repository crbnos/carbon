// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

/**
 * Migrations are history, so the check applies only to migrations newer than
 * the newest one that existed when it landed. Every older reference is
 * grandfathered by position rather than by a baseline list.
 */
const CUTOFF = "20261120052902";

const REFERENCES = /\bREFERENCES\s+[^\s(]+\s*\([^)]*\)/gi;

/** `--` comments removed; newlines kept so line numbers stay exact. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

export const noForeignKeyWithoutOnDelete: ConformanceCheck = {
  id: "no-foreign-key-without-on-delete",
  description:
    "A foreign key must state ON DELETE. The default (NO ACTION) is a decision nobody made.",
  provenance: {
    deprecates: "REFERENCES t(id) with no ON DELETE clause",
    replacedBy: "REFERENCES t(id) ON DELETE CASCADE | SET NULL | RESTRICT",
    incidents: ["c476c942de"]
  },
  scan(file, contents) {
    const base = file.split("/").pop() ?? file;
    if (base <= CUTOFF) return [];

    const sql = stripLineComments(contents);
    const violations: Violation[] = [];
    for (const m of sql.matchAll(REFERENCES)) {
      const start = m.index + m[0].length;
      // The clause runs to the next column, statement or table end.
      const rest = sql.slice(start);
      const end = rest.search(/[,;)]/);
      const clause = end === -1 ? rest : rest.slice(0, end);
      if (/\bON\s+DELETE\b/i.test(clause)) continue;

      violations.push({
        file,
        line: sql.slice(0, m.index).split("\n").length,
        snippet: m[0].replace(/\s+/g, " "),
        message:
          "State ON DELETE on this foreign key: CASCADE for regenerable children, SET NULL for optional links, RESTRICT to keep the parent. The default is a silent choice."
      });
    }
    return violations;
  }
};
