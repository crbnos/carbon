// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, eachFile, type Violation } from "../../check";
import {
  accountReferences,
  loadAccountReferencePolicy
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
  reads: { files: migrations, policy: loadAccountReferencePolicy },
  id: "account-fk-classified",
  description:
    "A column with a foreign key to account must be classified in REFERENCE_POLICY.",
  provenance: {
    deprecates: 'REFERENCES "account"("id") ON DELETE SET NULL',
    replacedBy: 'REFERENCES "account"("id") ON DELETE RESTRICT',
    since: "20261013005642_account-delete-restrict.sql"
  },
  rule() {
    return ({ files, policy: { classified, unclassified } }) =>
      eachFile(files, (file, contents) => {
        const violations: Violation[] = [];
        for (const { line, snippet, ref } of accountReferences(
          file,
          contents
        )) {
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
      });
  }
});
