// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Check,
  type ConformanceCheck,
  eachFile,
  fileCheck,
  type Violation
} from "../check";
import { read } from "../sources/cross-file";
import { migrations } from "../sources/inputs";
import { ancestorsOf, nameParts, relationName, sqlNodes } from "../sources/sql";

/** The migration that made every foreign key to `account` RESTRICT. Older ones are history. */
const SINCE = "20261013005642";

export const ACCOUNT_REFERENCE_POLICY_FILE =
  "packages/database/src/account-import.ts";

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
  const unclassified = [
    ...exportedArray(source, "UNCLASSIFIED_ACCOUNT_REFERENCES").matchAll(
      /"([^"]+)"/g
    )
  ].map(([, ref]) => ref as string);
  return { classified, unclassified };
}

export function loadAccountReferencePolicy(
  root: string
): AccountReferencePolicy {
  return parseReferencePolicy(
    read(root, ACCOUNT_REFERENCE_POLICY_FILE).contents
  );
}

type AccountReference = {
  line: number;
  snippet: string;
  /** Whether the key is ON DELETE RESTRICT. */
  restricts: boolean;
  /** `table.column`; undefined when the statement names no column. */
  ref: string | undefined;
};

/** Every foreign key to `account` a migration writes, in a table or a column. */
function accountReferences(file: string, contents: string): AccountReference[] {
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

const provenance = {
  deprecates: 'REFERENCES "account"("id") ON DELETE SET NULL',
  replacedBy: 'REFERENCES "account"("id") ON DELETE RESTRICT',
  since: "20261013005642_account-delete-restrict.sql"
};

/**
 * Fails a foreign key to `account` that is not `ON DELETE RESTRICT`: inline, a
 * table-level `FOREIGN KEY`, or `ALTER TABLE … ADD CONSTRAINT`. `SET NULL` let
 * a deleted account silently empty Draft and Provisional journal lines. `NO
 * ACTION` and no `ON DELETE` fail too, because the default is not a stated
 * decision.
 *
 * Only the table `account` matches, with or without `public.`.
 * `accountingPeriod`, `accountDefault`, a quoted `"Account"` and another
 * schema's `account` do not. Migrations before `SINCE` are history.
 *
 * The baselined keys (`project.costAccountId`, `projectElement.costAccountId`,
 * `purchaseOrderLineVersion.accountId`, all `ON DELETE SET NULL`) were reviewed
 * and wait for a decision. Each fix is a schema change, so the user decides. A
 * version snapshot may want `history` rather than `RESTRICT` semantics.
 */
export const accountFkRestrict = fileCheck(migrations, {
  id: "account-fk-restrict",
  description: "A foreign key to account must be ON DELETE RESTRICT.",
  provenance,
  scan(file, contents) {
    return accountReferences(file, contents)
      .filter(({ restricts }) => !restricts)
      .map(({ line, snippet }) => ({
        file,
        line,
        snippet,
        message:
          "A foreign key to account must be ON DELETE RESTRICT: SET NULL lets a deleted account silently empty Draft and Provisional lines, and no ON DELETE leaves the choice unstated. Add ON DELETE RESTRICT, and classify the column in REFERENCE_POLICY (packages/database/src/account-import.ts)."
      }));
  }
});

const ABOUT = {
  id: "account-fk-classified",
  description:
    "A column with a foreign key to account must be classified in REFERENCE_POLICY.",
  provenance
};

/**
 * The apply-account-import live test checks the catalog; this catches a
 * missing class without a database.
 *
 * Fails a column with a foreign key to `account` that `REFERENCE_POLICY` does
 * not list. `UNCLASSIFIED_ACCOUNT_REFERENCES` exempts `accountDefault`,
 * `fixedAssetClass` and `account.parentId`; the live test imports the same
 * list. The column is named from the enclosing `CREATE TABLE` or `ALTER TABLE`
 * and the `FOREIGN KEY (…)` list or the column definition. A key whose table or
 * column it cannot name, or one built by `EXECUTE format(...)`, is skipped; the
 * live test still covers it.
 */
export function accountFkClassified({
  classified,
  unclassified
}: AccountReferencePolicy): ConformanceCheck {
  return {
    ...ABOUT,
    scan(file, contents) {
      const violations: Violation[] = [];
      for (const { line, snippet, ref } of accountReferences(file, contents)) {
        if (
          !ref ||
          classified.has(ref) ||
          unclassified.some((u) => ref === u || ref.startsWith(`${u}.`))
        ) {
          continue;
        }
        violations.push({
          file,
          line,
          snippet,
          message: `${ref} names an account but is not in REFERENCE_POLICY (packages/database/src/account-import.ts), so the chart of accounts import cannot tell whether a merge may move it. Classify it: repoint, repoint-if-status, repoint-if-parent-status or history.`
        });
      }
      return violations;
    }
  };
}

export const accountFkClassifiedCheck: Check = {
  ...ABOUT,
  find: (repo) =>
    eachFile(
      repo.read(migrations),
      accountFkClassified(repo.read(loadAccountReferencePolicy)).scan
    )
};
