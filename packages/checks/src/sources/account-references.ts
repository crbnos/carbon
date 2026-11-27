// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ancestorsOf, nameParts, relationName, sqlNodes } from "./sql";

/** The change that made every foreign key to `account` RESTRICT. Older migrations are history. */
export const ACCOUNT_DELETE_RESTRICT = {
  deprecates: 'REFERENCES "account"("id") ON DELETE SET NULL',
  replacedBy: 'REFERENCES "account"("id") ON DELETE RESTRICT',
  since: "20261013005642_account-delete-restrict.sql"
};

type AccountReference = {
  line: number;
  snippet: string;
  restricts: boolean;
  /** `table.column`; undefined when the statement names no column. */
  ref: string | undefined;
};

/**
 * Every foreign key to `account` a migration writes, in a table or a column.
 * A migration before `ACCOUNT_DELETE_RESTRICT` gives none.
 */
export function accountReferences(
  file: string,
  contents: string
): AccountReference[] {
  if (file < ACCOUNT_DELETE_RESTRICT.since.slice(0, 14)) return [];
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
