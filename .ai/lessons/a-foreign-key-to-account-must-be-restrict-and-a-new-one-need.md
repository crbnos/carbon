---
paths: []
triggers: []
promoted: null
---
# A foreign key to `account` must be RESTRICT, and a new one needs a merge policy

**Context:** The chart of accounts import (2026-10-12) re-points references when it merges accounts and deletes an account nothing uses.

**Problem:** `journalLine.accountId` and the order, invoice and supplier quote line FKs were `ON DELETE SET NULL`. Deleting an account with Draft or Provisional lines succeeded and silently emptied the lines' account; Posted lines only refused by accident, through the immutability trigger. The import also has to know, for every column that names an account, whether a merge may move it.

**Rule:** Give a new foreign key to `account` `ON DELETE RESTRICT`, and classify it in `REFERENCE_POLICY` (`packages/database/src/account-import.ts`): `repoint`, `repoint-if-draft`, `repoint-if-unposted-journal` or `history`. The `apply-account-import` live-database test fails until it is listed. A soft reference (no FK) goes in `SOFT_REFERENCES` and the apply's `repointReferences`.

**Applies to:** migrations that add a column referencing `account`; `packages/database/src/account-import.ts`; `applyAccountImport` (`apps/erp/app/modules/accounting/accounting.service.ts`) and its live test `apps/erp/test/database/apply-account-import.test.ts`.
