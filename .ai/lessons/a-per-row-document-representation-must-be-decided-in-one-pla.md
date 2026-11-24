---
paths: ["packages/ee/src/accounting/core/posting.ts", "packages/ee/src/accounting/core/charge-syncer.ts"]
triggers: ["isDocBackedCharge", "CHARGE_CREDIT_PROVIDERS", "DOC_BACKED", "shouldSync"]
promoted: null
---
# A per-row document representation must be decided in ONE place the policy and the syncer both read

**Context:** Card charges became provider objects, but only some rows of the same journal source type qualify (a `Charge` with a supplier; a `Credit` only where the provider has a refund object; never a statement `Payment`/`Cashback`/`Repayment`). The journal policy decides DOC_BACKED per journal; the charge syncer decides `shouldSync` per document.

**Problem:** If the two rules drift — the policy excludes the journal but the syncer skips the charge (no supplier, unsupported Credit), or the reverse — the spend reaches the provider as both a journal entry and a charge, or as neither. Neither failure is loud: DOC_BACKED is a terminal "handled" disposition and a syncer skip is a benign reason string.

**Rule:** Put the eligibility rule in one pure function (`isDocBackedCharge(row, docSync)`) with explicit inputs (`type`, `hasSupplier`, provider capability set `CHARGE_CREDIT_PROVIDERS`), have the executor/planner resolve those inputs with one query per batch, and make every adapter's `shouldSync` restate the same conditions with the same constants. Pin both sides in tests (`posting-policy.test.ts`, the adapter's mapper tests, `reconcile-golden`).

**Applies to:** any future "document instead of journal" family whose eligibility depends on the row rather than the source type (returns, memos, per-provider capabilities).
