// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  REFERENCE_POLICY,
  UNCLASSIFIED_ACCOUNT_REFERENCES
} from "@carbon/database/account-import";
import { defineCheck, eachFile, type Violation } from "../../check";
import {
  ACCOUNT_DELETE_RESTRICT,
  accountReferences
} from "../../sources/account-references";
import { migrations } from "../../sources/inputs";

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
export const accountFkClassified = defineCheck({
  reads: {
    files: migrations,
    policy: (): {
      references: readonly { table: string; column: string }[];
      /** A table, or a `table.column`, no policy needs to classify. */
      unclassified: readonly string[];
    } => ({
      references: REFERENCE_POLICY,
      unclassified: UNCLASSIFIED_ACCOUNT_REFERENCES
    })
  },
  id: "account-fk-classified",
  description:
    "A column with a foreign key to account must be classified in REFERENCE_POLICY.",
  provenance: ACCOUNT_DELETE_RESTRICT,
  rule() {
    return ({ files, policy }) => {
      const classified = new Set(
        policy.references.map(({ table, column }) => `${table}.${column}`)
      );
      return eachFile(files, (file, contents) => {
        const violations: Violation[] = [];
        for (const { line, snippet, ref } of accountReferences(
          file,
          contents
        )) {
          if (
            !ref ||
            classified.has(ref) ||
            policy.unclassified.some(
              (u) => ref === u || ref.startsWith(`${u}.`)
            )
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
      });
    };
  }
});
