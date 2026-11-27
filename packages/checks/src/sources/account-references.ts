// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { read } from "./cross-file";
import { ancestorsOf, nameParts, relationName, sqlNodes } from "./sql";

// The foreign keys to `account` a migration writes, and the policy that
// classifies them for the chart of accounts import (REFERENCE_POLICY in
// `packages/database/src/account-import.ts`).

/** The migration that made every foreign key to `account` RESTRICT. Older ones are history. */
const SINCE = "20261013005642";

const ACCOUNT_REFERENCE_POLICY_FILE = "packages/database/src/account-import.ts";

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
  const unclassified: string[] = [];
  for (const [, ref] of exportedArray(
    source,
    "UNCLASSIFIED_ACCOUNT_REFERENCES"
  ).matchAll(/"([^"]+)"/g)) {
    if (ref !== undefined) unclassified.push(ref);
  }
  return { classified, unclassified };
}

export function loadAccountReferencePolicy(
  root: string
): AccountReferencePolicy {
  return parseReferencePolicy(
    read(root, ACCOUNT_REFERENCE_POLICY_FILE).contents
  );
}

export type AccountReference = {
  line: number;
  snippet: string;
  /** Whether the key is ON DELETE RESTRICT. */
  restricts: boolean;
  /** `table.column`; undefined when the statement names no column. */
  ref: string | undefined;
};

/**
 * Every foreign key to `account` a migration writes, in a table or a column.
 * Migrations before 20261013005642, which made every such key RESTRICT, are
 * history and give none.
 */
export function accountReferences(
  file: string,
  contents: string
): AccountReference[] {
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
