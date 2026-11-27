// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import { accountReferences } from "../../sources/account-references";
import { migrations } from "../../sources/inputs";

/**
 * Fails a foreign key to `account` that is not `ON DELETE RESTRICT`: inline, a
 * table-level `FOREIGN KEY`, or `ALTER TABLE … ADD CONSTRAINT`. `SET NULL` let
 * a deleted account silently empty Draft and Provisional journal lines. `NO
 * ACTION` and no `ON DELETE` fail too, because the default is not a stated
 * decision.
 *
 * Only the table `account` matches, with or without `public.`.
 * `accountingPeriod`, `accountDefault`, a quoted `"Account"` and another
 * schema's `account` do not. Migrations before 20261013005642 are history
 * (`accountReferences`, `sources/account-references.ts`).
 *
 * The baselined keys (`project.costAccountId`, `projectElement.costAccountId`,
 * `purchaseOrderLineVersion.accountId`, all `ON DELETE SET NULL`) were reviewed
 * and wait for a decision. Each fix is a schema change, so the user decides. A
 * version snapshot may want `history` rather than `RESTRICT` semantics.
 */
export const accountFkRestrict = defineCheck({
  files: migrations,
  id: "account-fk-restrict",
  description: "A foreign key to account must be ON DELETE RESTRICT.",
  provenance: {
    deprecates: 'REFERENCES "account"("id") ON DELETE SET NULL',
    replacedBy: 'REFERENCES "account"("id") ON DELETE RESTRICT',
    since: "20261013005642_account-delete-restrict.sql"
  },
  rule() {
    return (file, contents) =>
      accountReferences(file, contents)
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
