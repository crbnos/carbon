---
paths: []
triggers: ["journalLineDocumentType", "itemLedgerDocumentType", "bookAdjustment", "valueMovement"]
promoted: null
---
# journalLineDocumentType and itemLedgerDocumentType are different enums with near-identical value sets

**Context:** Adding GL posting for inventory adjustments: journal lines needed a `documentType` of `'Inventory Adjustment'`, and the plan also stamped the same value onto `itemLedger`/`costLedger` rows.

**Problem:** `journalLine.documentType` uses the `journalLineDocumentType` enum while `itemLedger.documentType` AND `costLedger.documentType` share the `itemLedgerDocumentType` enum. The two lists overlap heavily ('Inventory Count' exists in both) but are not identical — `'Inventory Adjustment'` existed in neither and was added only to `journalLineDocumentType`. Writing a journal-only value into a ledger column fails at runtime with an invalid-enum error, and stamping a new documentType onto manual-adjustment `itemLedger` rows would also have broken the "byte-identical ledger writes when accounting is disabled" guarantee (they are NULL today).

**Rule:** Before using a `documentType` string, check WHICH enum the target column uses (`\dT+` or grep the migration) — never assume the journal and ledger enums share values. When adding GL posting to an existing subledger flow, keep the subledger rows' shape unchanged (documentType stays whatever it was, usually NULL) and put the new linkage value on the journal lines only.

**Applies to:** `packages/database/supabase/migrations/` enum additions; `bookAdjustment` / `valueMovement` (`apps/erp/app/modules/shared/shared.service.ts`); any `post-*` function writing both `itemLedger`/`costLedger` and `journalLine`.
