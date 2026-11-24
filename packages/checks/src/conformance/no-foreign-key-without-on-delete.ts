// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";
import {
  relationName,
  type SqlStatement,
  sqlNodes,
  tokensFrom
} from "../sources/sql";

/**
 * Migrations are history, so the check applies only to migrations newer than
 * the newest one that existed when it landed. Every older reference is
 * grandfathered by position rather than by a baseline list.
 */
const CUTOFF = "20261120052902";

/**
 * Whether the reference that starts at `location` writes `ON DELETE`. The
 * parse tree cannot say: it holds NO ACTION for a missing clause and for a
 * written `ON DELETE NO ACTION` alike. The clause, if any, sits before the
 * `,` or `)` that ends the constraint.
 */
function writesOnDelete(statement: SqlStatement, location: number): boolean {
  let depth = 0;
  let previous = "";
  for (const token of tokensFrom(statement, location)) {
    const word = token.text.toUpperCase();
    if (word === "(") depth++;
    if (word === ")") depth--;
    if (depth < 0 || (depth === 0 && (word === "," || word === ";"))) break;
    if (previous === "ON" && word === "DELETE") return true;
    previous = word;
  }
  return false;
}

export const noForeignKeyWithoutOnDelete: ConformanceCheck = {
  id: "no-foreign-key-without-on-delete",
  description:
    "A foreign key must state ON DELETE. The default (NO ACTION) is a decision nobody made.",
  provenance: {
    deprecates: "REFERENCES t(id) with no ON DELETE clause",
    replacedBy: "REFERENCES t(id) ON DELETE CASCADE | SET NULL | RESTRICT"
  },
  scan(file, contents) {
    const base = file.split("/").pop() ?? file;
    if (base <= CUTOFF) return [];

    const violations: Violation[] = [];
    for (const { node, fragment, statement } of sqlNodes(contents)) {
      if (!("Constraint" in node)) continue;
      const { contype, pktable, fk_del_action } = node.Constraint;
      if (contype !== "CONSTR_FOREIGN" || !pktable) continue;
      // Any action but NO ACTION can only have been written.
      if (fk_del_action !== "a") continue;
      if (writesOnDelete(statement, pktable.location ?? 0)) continue;
      violations.push({
        file,
        line: fragment.lineAt(pktable.location),
        snippet: `REFERENCES "${relationName(pktable)}"`,
        message:
          "State ON DELETE on this foreign key: CASCADE for regenerable children, SET NULL for optional links, RESTRICT to keep the parent. The default is a silent choice."
      });
    }
    return violations;
  }
};
