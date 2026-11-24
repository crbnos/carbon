// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fileCheck, type Violation } from "../check";
import { migrations } from "../sources/inputs";
import { nameParts, relationName, sqlNodes } from "../sources/sql";

// Only `ALTER TABLE … ADD COLUMN` is checked. A `NOT NULL` column in a
// `CREATE TABLE` is not a backup-compatibility problem: the table is simply
// absent from older manifests, which `reportBackupCompatibility` already
// handles as a separate finding.
//
// A column with a value of its own passes: a DEFAULT, a GENERATED expression
// or an identity (a backup can never supply those, and
// `reportBackupCompatibility` excludes them for the same reason), and a serial
// type, whose default is its sequence.
const SUPPLIES_A_VALUE = new Set([
  "CONSTR_DEFAULT",
  "CONSTR_GENERATED",
  "CONSTR_IDENTITY"
]);
const SERIAL_TYPES = new Set(["smallserial", "serial", "bigserial"]);

export const noRequiredColumnWithoutDefault = fileCheck(migrations, {
  id: "no-required-column-without-default",
  description:
    "A new NOT NULL column must ship a DEFAULT, so existing backups stay restorable.",
  provenance: {
    deprecates: 'ADD COLUMN "x" TEXT NOT NULL',
    replacedBy: "ADD COLUMN \"x\" TEXT NOT NULL DEFAULT ''"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    for (const { node, fragment } of sqlNodes(contents)) {
      if (!("AlterTableStmt" in node)) continue;
      const { relation, cmds } = node.AlterTableStmt;
      for (const cmd of cmds ?? []) {
        if (!("AlterTableCmd" in cmd)) continue;
        const { subtype, def } = cmd.AlterTableCmd;
        if (subtype !== "AT_AddColumn" || !def || !("ColumnDef" in def)) {
          continue;
        }
        const { colname, constraints, typeName, location } = def.ColumnDef;
        const kinds = (constraints ?? []).flatMap((constraint) =>
          "Constraint" in constraint ? [constraint.Constraint.contype] : []
        );
        if (!kinds.includes("CONSTR_NOTNULL")) continue;
        if (kinds.some((kind) => kind && SUPPLIES_A_VALUE.has(kind))) continue;
        if (SERIAL_TYPES.has(nameParts(typeName?.names).at(-1) ?? "")) continue;
        violations.push({
          file,
          line: fragment.lineAt(location),
          snippet: `ADD COLUMN "${relationName(relation ?? {})}"."${colname}" NOT NULL`,
          message:
            "A NOT NULL column with no DEFAULT makes every existing backup unrestorable — the backup has no value to supply for it, so the compatibility gate refuses the whole restore. Add a DEFAULT, or make the column nullable and backfill."
        });
      }
    }
    return violations;
  }
});
