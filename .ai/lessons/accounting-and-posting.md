# Accounting and posting lessons

Journals, postings, the GL, periods, the cutover, accounting sync providers, revenue recognition, lease accounting.

## A detector and the builder it feeds share one zero-value rule

```scope
id: a-detector-and-the-builder-it-feeds-share-one-zero-value-rul
paths: ["packages/database/src/legacy-documents.ts","apps/erp/app/modules/accounting/accounting.service.ts","apps/erp/test/database/activate-accounting/**"]
triggers: ["valueMovement","LEGACY_DOCUMENT_FAMILIES","legacySalesInvoices"]
```

**Context:** The accounting enable, and the "Write missing journals" repair, find legacy documents: posted on or after the cutover with no journal (`packages/database/src/legacy-documents.ts`). A builder then writes each document's journal (`apps/erp/app/modules/accounting/accounting.service.ts`). After that, the enable's re-cost (`activate-accounting/recost.ts`) adjusts the inventory journal pair of each outbound movement whose cost changed.

**Problem:** The detection and the builders used different zero rules, in both directions:

1. The detection found documents that the builders write no line for: a comment-only invoice, a receipt with no received line, a return received at no cost. Such a document got no journal, so every later run found it again.
2. The posting core wrote no journal for a zero-cost movement (`valueMovement` skipped the journal when `cost === 0`). When the re-cost gave that movement a cost, it found no pair to adjust and refused with a 409.

Commit b9f897608c removed zero-value documents from the detection. Commits b9f897608c and 188a710e24 made every outbound cost row write its pair, at zero too.

**Rule:** Write the zero rule once and apply it on both sides. If the builder writes no line for a document, the detection leaves the document out. If a later step adjusts a line, the builder writes that line even at zero. Pin the pair with a test that runs the detection, the builder, and the detection again: the second detection must find nothing (`apps/erp/test/database/activate-accounting/legacy/detection.test.ts`).

**Applies to:** `packages/database/src/legacy-documents.ts`; `apps/erp/app/modules/accounting/accounting.service.ts`; `apps/erp/app/modules/accounting/accounting.service.ts`; `valueMovement` in `apps/erp/app/modules/shared/shared.service.ts`; any detect-then-repair pair.

## A document-backed journal is found through its LINES' document link, never through the document's own journalId

```scope
id: a-document-backed-journal-is-found-through-its-lines-documen
paths: ["packages/jobs/src/inngest/functions/integrations/accounting-sync-operations.ts"]
triggers: ["loadChargePolicyInputs","DOC_BACKED"]
```

**Context:** Card charges as provider objects (2026-09-10). A `charge` books TWO journals over its life — the posting journal (`charge.journalId`) and, on void, a NEW Posted "VOID Charge" journal with no `reversalOfId`. Both carry `journalLine.documentType = 'Charge'` / `documentId = <card id>`.

**Problem:** The reconciler resolved the backing charge by `charge.journalId`, so only the posting journal was DOC_BACKED. The void journal looked like a plain journal, pushed to Rillet as a journal entry on top of the charge DELETE, and Rillet netted to minus one charge — invisible in unit tests, found only by voiding on the live sandbox and reading Rillet's GL.

**Rule:** When a journal's disposition depends on a backing document, resolve journal → document through the journal lines' `documentType`/`documentId` (one batch query), which every journal the document produces shares; treat the document's own `journalId` column as a fallback for unlinked rows. And any DOC_BACKED carve-out must be exercised across the document's full lifecycle (post → void) on a real provider before it is called done.

**Applies to:** `loadChargePolicyInputs`, every future DOC_BACKED source type, and the void/reversal audit still open in the always-on posting plan (Task 7).

## A value two layers must agree on lives once, in the client-safe pure module

```scope
id: a-value-two-layers-must-agree-on-lives-once-in-the-client-sa
paths: ["packages/database/src/accounting-cutover.ts","apps/erp/app/modules/accounting/ui/Activation/MigrationClearingTable.tsx","apps/erp/app/routes/x+/accounting+/activation.enable.tsx","apps/erp/app/modules/accounting/accounting.service.ts"]
triggers: ["MIGRATION_CLEARING_TOLERANCE","isMigrationClearingZero","ACTIVATION_CUTOVER_PARAM","accounting-cutover"]
```

**Context:** The accounting enable wizard (ERP) and `activateAccounting` (`accounting.service.ts`, ported from the `activate-accounting` server function) both decide whether Migration Clearing totals zero. The wizard uses the answer to offer "Enable accounting". The server function uses it to refuse the enable. The wizard steps also pass the cutover date to each other in a search param.

**Problem:** Until 2026-10-09 each layer kept its own copy. `MigrationClearingTable.tsx` defined `MIGRATION_CLEARING_TOLERANCE = 0.01` and `isMigrationClearingZero`. `activate-accounting/index.ts` defined a second `MIGRATION_CLEARING_TOLERANCE`. `accounting.server.ts` defined `ACTIVATION_CUTOVER_PARAM`. The copies matched, but nothing kept them matched. If one copy changes, the wizard offers an enable that the server refuses, or hides one that the server accepts. Typecheck cannot see a drift between two literals.

**Rule:** Put a value that two layers must agree on in one place: the client-safe pure module that both layers already import. Export the predicate, not only the number, so every caller compares the same way. The accounting cutover keeps `MIGRATION_CLEARING_TOLERANCE`, `isMigrationClearingZero`, `MIGRATION_CLEARING_ACCOUNT_CLASS` and `ACTIVATION_CUTOVER_PARAM` in `@carbon/database/accounting-cutover` (commits 38602af774, b9f897608c, f1fe2b6c81). That module reads no database, so the browser can import it.

**Applies to:** `packages/database/src/accounting-cutover.ts`; `apps/erp/app/modules/accounting/ui/Activation/MigrationClearingTable.tsx`; `apps/erp/app/routes/x+/accounting+/activation.enable.tsx`; `apps/erp/app/modules/accounting/accounting.service.ts`; any check that a wizard previews and a posting enforces.

## An item left out at the accounting cutover must close in its own sub-ledger

```scope
id: an-item-left-out-at-the-accounting-cutover-must-close-in-its
paths: ["packages/database/src/accounting-cutover/**"]
triggers: ["settledFromCutoverIds"]
```

**Context:** Migration Clearing's Ignore (2026-10-13): an invoice another system already settled is left out of the opening journal.

**Problem:** Dropping an item from the opening journal alone leaves its document open. The AR/AP readers fall back to the invoice total when no control line exists, so the invoice stays in aging, the tie-out shows a permanent variance, and a later payment is refused ("Target is missing its original control account"). And an invoice Carbon itself settles on or after the cutover posts a payment journal that credits the control account, which then has no opening line to credit.

**Rule:** Leave an item out only when the sub-ledger can say it is closed: an invoice is marked Paid the day before the cutover by the enable. Refuse it when Carbon settles it on or after the cutover (`settledFromCutoverIds`). Any other item type (memo, payment, WIP, lease, inventory, fixed asset) has no such state and stays in the opening journal.

**Applies to:** `packages/database/src/accounting-cutover/trial-balance.ts`, `apps/erp/app/modules/accounting/accounting.service.ts`.

## Carbon journal amounts are natural-balance-signed, not debit-signed

```scope
id: carbon-journal-amounts-are-natural-balance-signed-not-debit
paths: ["packages/ee/src/accounting/**"]
triggers: ["toDebitSignedAmount","toPostingDateString"]
```

- **Context:** Wiring Rillet journal posting sync; first live push of a real
  `Purchase Receipt` journal failed UNBALANCED_JOURNAL (+300/+300).
- **Problem:** The accounting sync engine (preflight balance check, netting,
  consolidation, all provider journal mappers) assumed `journalLine.amount`
  is debit-signed (positive = debit, negative = credit, sum = 0). Carbon's
  post-* edge functions actually sign by the account's NATURAL balance
  (`credit("liability", x)` stores +x — packages/database/src/ledger.ts), so real
  journals balance as debits == credits, not signed-sum-zero. Also:
  Kysely/pg returns DATE columns as JS Date objects — `postingDate.slice`
  crashes; and disabled-config skip results without `localId` make the
  drain report the misleading "No sync result returned for entity".
- **Rule:** Convert to debit-signed at the fetch edge with
  `toDebitSignedAmount(account.class, amount)` (join account.class in the
  journal-line query), normalize dates with `toPostingDateString`, and
  always set `localId`/`remoteId` on every SyncResult, including early
  skips. Never trust the debit-signed assumption against live journal data
  without checking the edge functions' credit()/debit() helpers.
- **Applies to:** packages/ee/src/accounting (journal syncers, posting
  preflight, consolidation), any new accounting provider's journal mapper.

## Chart-of-accounts group headers have no number — resolve parents by name/key

```scope
id: chart-of-accounts-group-headers-have-no-number-resolve-paren
paths: ["packages/database/src/seed-data.ts"]
triggers: ["INSERT INTO \"account\"","parentKey"]
```

**Context:** `20260524143827_fixed-assets.sql` seeded a "Deferred Tax Expense" (7090) account for every existing company group, resolving its parent with `number = '7000' AND "isGroup" = true`.

**Problem:** Group header accounts in Carbon's chart carry `number = NULL` (they are identified by seed key/name, e.g. `other-expenses` / "Other Expenses") — only leaf posting accounts have numbers. The lookup silently returned NULL and the account was inserted with `parentId = NULL`, leaving it orphaned at the root of the chart for every pre-existing company. New companies were unaffected because `seed.data.ts` parents via `parentKey`. The bug is invisible in dev (fresh seeds go through `seed.data.ts`) and only shows on long-lived databases.

**Rule:** In migrations that insert `account` rows, resolve the parent group by `"isGroup" = TRUE AND name = '<Group Name>'` (optionally + class), never by number — and treat a NULL parent as an error or explicit fallback, never insert silently orphaned. `20260630093809_ar-ap-payments.sql` is the correct precedent. When a past migration did orphan accounts, ship a follow-up UPDATE re-parenting `parentId IS NULL` rows to the group `seed.data.ts` assigns (see `20260702192816`).

**Applies to:** `packages/database/supabase/migrations/` touching `account`; `packages/database/src/seed-data.ts`; anything walking the chart-of-accounts tree.

## Coding lines are positive magnitudes, not signed journal legs

```scope
id: coding-lines-are-positive-magnitudes-not-signed-journal-legs
paths: []
triggers: ["buildChargeJournal","buildLegacyChargeJournals","codingLine"]
```

**Context:** Card Charge, Credit, and Repayment documents translate positive coding allocations into debit or credit journal legs according to the transaction type.

**Problem:** Zero, negative, or non-finite line amounts could pass a header-sum check and invert or erase an individual accounting leg even though the overall entry still balanced.

**Rule:** Validate every document coding amount as finite and strictly positive before applying debit/credit semantics. A balanced journal is necessary but does not prove the document's line-level meaning is valid.

**Applies to:** Charge coding lines and other financial document builders that assign journal direction separately from stored line magnitude.

## Consolidation eliminations must allocate per transaction, not per company pair

```scope
id: consolidation-eliminations-must-allocate-per-transaction-not
paths: ["packages/database/supabase/tests/intercompany-elimination.test.sql"]
triggers: ["generateEliminationEntries","targetJournalLineId"]
```

**Context:** `generateEliminationEntries` looped over company PAIRS (LEAST/GREATEST of the two companies), summed all intragroup revenue/COGS across the pair into one margin, and split the unrealized-profit writedown across the buyer capitalization lines proportional to captured value. A deterministic SQL test harness seeded two trades between the same pair with different margins capitalizing to different accounts (Machinery margin 40, another asset margin 10) and asserted each asset landed at its own group cost — it did not (both drifted to a proportional 75).

**Problem:** Pair-level aggregation preserves the TOTAL (net income and total assets stay correct) but mis-allocates the writedown ACROSS accounts when trades in the pair have different margins. Two companies trade repeatedly in a real ERP, so this is a normal case, not a corner. It was invisible in single-trade tests and only surfaced when regenerate re-matched a second trade into the same pair.

**Rule:** Eliminate/allocate at the grain of the TRANSACTION (the matched seller↔buyer document), not the company pair. Matching links the two sides via `targetJournalLineId` = the other side's `sourceJournalLineId`; use that to pull each trade's own revenue/COGS (seller side) and capitalization (buyer side) and write each asset down by ITS margin. Any consolidation adjustment that aggregates then re-splits proportionally is suspect — prove per-item allocation with a multi-trade, mixed-margin, mixed-account test. The harness (`packages/database/supabase/tests/intercompany-elimination.test.sql`) pins this.

**Applies to:** `generateEliminationEntries`; any margin/cost allocation that groups by counterparty rather than by document.

## journalLineDocumentType and itemLedgerDocumentType are different enums with near-identical value sets

```scope
id: journallinedocumenttype-and-itemledgerdocumenttype-are-diffe
paths: []
triggers: ["journalLineDocumentType","itemLedgerDocumentType","bookAdjustment","valueMovement"]
```

**Context:** Adding GL posting for inventory adjustments: journal lines needed a `documentType` of `'Inventory Adjustment'`, and the plan also stamped the same value onto `itemLedger`/`costLedger` rows.

**Problem:** `journalLine.documentType` uses the `journalLineDocumentType` enum while `itemLedger.documentType` AND `costLedger.documentType` share the `itemLedgerDocumentType` enum. The two lists overlap heavily ('Inventory Count' exists in both) but are not identical — `'Inventory Adjustment'` existed in neither and was added only to `journalLineDocumentType`. Writing a journal-only value into a ledger column fails at runtime with an invalid-enum error, and stamping a new documentType onto manual-adjustment `itemLedger` rows would also have broken the "byte-identical ledger writes when accounting is disabled" guarantee (they are NULL today).

**Rule:** Before using a `documentType` string, check WHICH enum the target column uses (`\dT+` or grep the migration) — never assume the journal and ledger enums share values. When adding GL posting to an existing subledger flow, keep the subledger rows' shape unchanged (documentType stays whatever it was, usually NULL) and put the new linkage value on the journal lines only.

**Applies to:** `packages/database/supabase/migrations/` enum additions; `bookAdjustment` / `valueMovement` (`apps/erp/app/modules/shared/shared.service.ts`); any `post-*` function writing both `itemLedger`/`costLedger` and `journalLine`.

## Resolve adoption assumptions before designing accounting migration machinery

```scope
id: resolve-adoption-assumptions-before-designing-accounting-mig
paths: [".ai/specs/2026-09-07-accounting-posting-corrections.md"]
triggers: []
```

**Context:** The accounting posting-corrections spec raised legacy open-balance migration concerns; the user clarified that accounting can be assumed unused.

**Problem:** Designing calculation versions, correction journals, and cutover tooling before resolving adoption added unnecessary scope to a correctness fix.

**Rule:** Use the user's explicit adoption premise to size compatibility work. For this spec, correct the monetary contract directly; do not add legacy-accounting machinery. An unused accounting module does not imply permission to delete operational records or reset a database.

**Applies to:** `.ai/specs/2026-09-07-accounting-posting-corrections.md` and its implementation; other modules require their own adoption evidence.

## A job's WIP is not only the lines documented against the job

```scope
id: a-job-s-wip-is-not-only-the-lines-documented-against-the-job
paths: ["packages/database/src/accounting-cutover/open-items.ts"]
triggers: ["job_wip_balance","job_receipt_line_references","complete_job_to_inventory","closeJob","attachJob","getWorkInProgressItems"]
```

- **Context:** Finished goods from a job with an outside processing operation came out without the supplier's cost.
- **Problem:** The receipt of an outside processing purchase order debits WIP with `documentId` = the receipt and the purchase order line in `documentLineReference`. The job completion, `closeJob` and `attachJob` each summed WIP `WHERE documentId = <job>`, so the supplier's cost was never moved to finished goods and never written off. And when the receipt finished the job's last operation, `postReceipt` set the operation Done before it wrote its journal, so the completion that update triggers ran before the debit existed.
- **Rule:** Read a job's WIP with SQL `job_wip_balance`, never with a `documentId` filter of your own. A reader that cannot call it per job (a set-based read of every job, such as the accounting cutover's per-job WIP items) attributes lines through SQL `job_receipt_line_references`, the rule `job_wip_balance` uses. A posting that can trigger a job completion (any write that sets a `jobOperation` Done) writes its own journal first.
- **Applies to:** `complete_job_to_inventory`, `closeJob`, `attachJob`, `postReceipt`, `getWorkInProgressItems` (`accounting-cutover/open-items.ts`), and any new reader of a job's cost or writer of a job operation's status.

## A per-row document representation must be decided in ONE place the policy and the syncer both read

```scope
id: a-per-row-document-representation-must-be-decided-in-one-pla
paths: ["packages/ee/src/accounting/core/posting.ts","packages/ee/src/accounting/core/charge-syncer.ts"]
triggers: ["isDocBackedCharge","CHARGE_CREDIT_PROVIDERS","DOC_BACKED","shouldSync"]
```

**Context:** Card charges became provider objects, but only some rows of the same journal source type qualify (a `Charge` with a supplier; a `Credit` only where the provider has a refund object; never a statement `Payment`/`Cashback`/`Repayment`). The journal policy decides DOC_BACKED per journal; the charge syncer decides `shouldSync` per document.

**Problem:** If the two rules drift — the policy excludes the journal but the syncer skips the charge (no supplier, unsupported Credit), or the reverse — the spend reaches the provider as both a journal entry and a charge, or as neither. Neither failure is loud: DOC_BACKED is a terminal "handled" disposition and a syncer skip is a benign reason string.

**Rule:** Put the eligibility rule in one pure function (`isDocBackedCharge(row, docSync)`) with explicit inputs (`type`, `hasSupplier`, provider capability set `CHARGE_CREDIT_PROVIDERS`), have the executor/planner resolve those inputs with one query per batch, and make every adapter's `shouldSync` restate the same conditions with the same constants. Pin both sides in tests (`posting-policy.test.ts`, the adapter's mapper tests, `reconcile-golden`).

**Applies to:** any future "document instead of journal" family whose eligibility depends on the row rather than the source type (returns, memos, per-provider capabilities).

## A posted document's void and anything that adds lines to its journal take one lock

```scope
id: a-posted-document-s-void-and-anything-that-adds-lines-to-its
paths: []
triggers: ["changeInvoiceLineAccount","postSalesInvoice","postPurchaseInvoice","FOR UPDATE","forUpdate()"]
```

- **Context:** Change GL Account adds two journal lines to a posted sales or purchase invoice; the invoice void reverses every journal line of the document.
- **Problem:** The change locked the invoice `FOR UPDATE`, but both voids read the lines they reverse before their transaction and never locked the invoice. A change that committed between the void's read and its write survived on a Voided invoice: its amount stayed on the new account with nothing left to reverse it.
- **Rule:** Anything that adds journal lines to a posted document must be serialized with the void's read under the same lock. Lock the document row `FOR UPDATE` inside the void's transaction, then read and build the reversal from that locked state, taking the lock at the same point in the order as the writer (after the posting-status read, before the period) so neither deadlocks.
- **Applies to:** `postSalesInvoice` / `postPurchaseInvoice` void, `changeInvoiceLineAccount`, and any future correction that posts onto an existing document's journal (memos, payments, receipts, shipments).

## A posting's refusal only reaches the dialog when it is thrown as a 4xx

```scope
id: a-posting-s-refusal-only-reaches-the-dialog-when-it-is-throw
paths: ["apps/erp/app/modules/inventory/inventory.server.ts"]
triggers: ["invokePosting","serverFnFailure"]
```

**Context:** A refused receipt void showed "Failed to void receipt" with no reason. The guards inside the `post-receipt` posting said exactly why ("stock received on this receipt was moved, picked or shipped since it was received").

**Problem:** `invokePosting` reads a plain `Error` as status 500 (the posting's default), and the operation passed every failure to `serverFnFailure` with a fixed message. So every refusal, and every new guard, was reported with the same generic text.

**Rule:** Throw an authored refusal from a posting as `InvalidInputError` (or another `ServerFnError` below 500), never a plain `Error`. In the operation, below 500 return the error's own message (`error.message || <fallback>`); keep the generic message for 500, whose detail `toError` already withholds.

**Applies to:** every operation that calls `invokePosting` and every posting body (`voidReceipt` / `postReceipt` in `inventory.server.ts`, `adjustInventory` follows the same shape).

## A reversing journal must carry the dimensions of the lines it negates

```scope
id: a-reversing-journal-must-carry-the-dimensions-of-the-lines-i
paths: []
triggers: ["journalLineDimension","copyJournalLineDimensions","allocateJournalLineIds"]
```

**Context:** Journal verification, 2026-11. Sales and purchase invoice VOIDs inserted negated lines, and memo, payment and shipment voids also copied each line's `journalLineDimension` rows.

**Problem:** The invoice voids did not copy them. The totals reversed, so every balance check passed, while every report by customer, location or project kept the voided amount.

**Rule:** A reversal copies dimensions with `copyJournalLineDimensions` (`shared.service.ts`). Allocate the reversing line ids first (`allocateJournalLineIds`) so each pair is known without relying on `RETURNING` order. When checking a void, assert the balance per dimension, not only per account.

**Applies to:** Any new void or reversal path that writes `journalLine` rows.

## Accounting review: carrying balances and source principal

```scope
id: accounting-review-carrying-balances-and-source-principal
paths: ["apps/erp/app/modules/invoicing/invoicing.service.ts"]
triggers: ["carryingBase","controlAmount","openBalance"]
```

- **Context:** Mixed positive and negative invoice lines, high FX rates, and changes to account defaults during settlement and provider replay.
- **Problem:** Summing control magnitudes invented FX; recovering document units from rounded base lost valid minor-unit balances; current defaults rewrote original account provenance.
- **Rule:** Sum signed original control amounts, preserve exact document principal independently of carrying base, and identify original journal roles through the shared exhaustive vocabulary (including intercompany roles). Reject unknown effective principal rather than infer it; retain Draft reservation policy separately from Posted effectiveness.
- **Applies to:** Invoice/payment/memo posting, open-balance readers, and accounting provider replay.

## Apportion a document total, never concentrate its rounding residual

```scope
id: apportion-a-document-total-never-concentrate-its-rounding-re
paths: ["packages/ee/src/accounting/core/sales-document-components.ts","packages/database/src/sales-posting-amounts.ts","packages/ee/src/accounting/core/document-costing.ts"]
triggers: ["distributeRoundingResidual","residual"]
```

**Context:** Sales invoices push to QuickBooks/Xero/Rillet as components (merchandise, add-ons, line shipping, header shipping), each rounded at the document currency's precision, and the sum must equal the authoritative document total.

**Problem:** Rounding N components independently leaves a residual of up to N/2 minor units. Assigning that whole residual to one component broke that component's own percent/amount pair — a 20 x $1.99 @ 8.25% invoice gave one line $0.24 tax on $1.99 net (12.06% against a stated 8.25%). QuickBooks re-derives `round(net x percent)` within one minor unit and refused the invoice with `UNMAPPED_TAX_CODES`, a message blaming the customer's QuickBooks configuration, which they cannot act on. A randomised sweep put this at 1.6% of invoices; some cases produced a negative tax on positive revenue, which Xero accepts and posts.

**Rule:** Use `distributeRoundingResidual` (`@carbon/utils`) whenever a total is apportioned across parts — largest remainder, at most one minor unit moved per part. Never hand-roll "assign the difference to the biggest line". Order the parts by a stable business key (component id) before distributing, because the distributor's own tie-break is positional and the same invoice must allocate identically whatever order its lines arrive in. Where a derived value must reproduce the reconciled amount (a unit price times its quantity), derive it and then VERIFY — refuse when no representable value works, rather than emitting an inconsistent one.

**Applies to:** `packages/ee/src/accounting/core/sales-document-components.ts`, `packages/database/src/sales-posting-amounts.ts`, `packages/ee/src/accounting/core/document-costing.ts`, Ramp card/repayment allocation, and any future provider document mapper.

## Dating a synthetic-entity journal with company_today() drops it out of the "as of" report window

```scope
id: dating-a-synthetic-entity-journal-with-company-today-drops-i
paths: []
triggers: ["generateEliminationEntries","isEliminationEntity","company_today("]
```

**Context:** Intercompany elimination journals post to a synthetic "elimination entity" company (no user membership, no location). `generateEliminationEntries` dated them `company_today(elimination_entity)`. Because the elimination entity has no location, `company_today` fell back to UTC — and on an evening-Pacific boundary UTC had already rolled to the next day. The eliminations posted on Aug 18 while the invoices they eliminate posted Aug 17. The consolidated balance sheet ("Aug 2026 to date", cutoff = today = Aug 17) then showed Inter-Company Payables/Receivables = 100 (un-eliminated), while the account drill-down ("all time") correctly netted to 0 — a confusing split where the row and its own drill-down disagree.

**Problem:** A consolidation adjustment must fall in the SAME reporting period/date window as the transactions it adjusts. Deriving its date from a synthetic entity's own timezone (UTC fallback) is unmoored from the operating companies' business calendar and drifts a day — or a MONTH at a month-end boundary, which would misfile the whole adjustment.

**Rule:** Date a derived/adjusting journal (elimination, allocation, reversal) to the business date of the source transactions it references — e.g. `MAX(sourceJournal.postingDate)` — not to `company_today()` of a synthetic or parent entity that may resolve to a different day. Date a reversal to its original journal's `postingDate` so the two net in one window. When a balance-sheet ROW and its drill-down "Closing" disagree, suspect an out-of-window posting date, not a summing/RLS bug. Fixed in `20260817122328_intercompany-revenue-cogs-elimination.sql`.

**Applies to:** `generateEliminationEntries` and any DB function posting to `isEliminationEntity` companies; any consolidation/allocation/reversal journal; `company_today()` callers where the company may lack a location.

## Header-only financial documents must reject persisted detail

```scope
id: header-only-financial-documents-must-reject-persisted-detail
paths: []
triggers: ["requireNoLines","\"Cashback\""]
```

**Context:** Card `Payment` and `Cashback` journals are derived entirely from the header amount, card account, and offset account.

**Problem:** If either document nevertheless carried coding lines, the journal builder silently ignored those rows and posted a GL entry that did not represent all persisted document detail.

**Rule:** When a financial document type is header-only, assert that its detail collection is empty before posting. Never silently discard stored financial rows merely because the current journal shape does not consume them.

**Applies to:** Card payments and cashback today, and any future header-derived posting path that accepts a shared document shape containing optional lines.

## Posting-group-style matrices are a rejected pattern

```scope
id: posting-group-style-matrices-are-a-rejected-pattern
paths: [".ai/specs/*.md"]
triggers: ["postingGroup","PostingGroup","posting group"]
```

**Context:** Designing multi-jurisdiction tax determination; the spec anchored on the customerType × itemPostingGroup posting-group matrix as "Carbon precedent."

**Problem:** The posting-group matrix was deliberately REMOVED (`20260229000000_drop-posting-groups.sql`) because the indirection was confusing — but the 2023 creation migration still exists, so searches find it first and it masquerades as live precedent. Anchoring a new design on it resurrects a pattern the project already rejected.

**Rule:** Do not design N×M classification-matrix configuration (party-group × item-group → outcome). Prefer flat company defaults (`accountDefault`) plus direct per-entity assignment with per-child override (the Xero model). Before citing any schema "precedent," grep for a later `DROP`/rename migration.

**Applies to:** New config/settings design anywhere; accounting/tax/posting; `.ai/specs/`, `packages/database/supabase/migrations/`.

## Prove batching through the real workflow entry point

```scope
id: prove-batching-through-the-real-workflow-entry-point
paths: ["packages/ee/src/accounting/core/*.ts"]
triggers: ["pushBatchToAccounting","fetchLocalBatch"]
```

**Context:** The accounting charge supplier lookup was consolidated into one joined batch loader, but the new lifecycle's `pushBatchToAccounting` still called the single-item push for every charge.

**Problem:** A test of `fetchLocalBatch` alone passed while the real QBO batch made four card-source reads for two rows; re-entering the parent single-item workflow also fetched mapped rows again.

**Rule:** Assert query counts through the public multi-item entry point, not only its loader. Load source rows and tenant/provider-scoped mappings once, pass those snapshots into the shared per-item lifecycle, and persist each remote success before advancing. Cover mixed creates, updates, voids, missing rows, and failures to prove batching preserves durability and error isolation.

**Applies to:** accounting sync batches and any workflow refactor that combines per-item remote effects with batched local reads.

## Two halves of an intercompany trade must round at the same scale

```scope
id: two-halves-of-an-intercompany-trade-must-round-at-the-same-s
paths: ["packages/database/src/sales-posting-amounts.ts"]
triggers: ["calculateSalesIntercompanyAmount","generate_intercompany_matches","intercompanyTransaction"]
```

**Context:** `post-sales-invoice` and `post-purchase-invoice` each write an `intercompanyTransaction` row, and `generate_intercompany_matches` pairs them with `src."amount" = tgt."amount"` — exact NUMERIC equality, no tolerance.

**Problem:** The seller began rounding its half at the document currency's settlement precision (2dp) while the buyer kept internal `SCALE` (5dp). A trade of 3 x 100.005 stored 300.02 against 300.015, so the pair sat `Unmatched` forever and eliminations silently never ran — consolidated income kept the intragroup profit, with no error anywhere.

**Rule:** An amount used as a MATCHING KEY is not a settlement amount. Round both halves at internal `SCALE`. Before changing rounding anywhere, check whether the value is compared for equality by something else — a matcher, a tie-out, or a reconciliation — and change both sides together.

**Applies to:** `calculateSalesIntercompanyAmount`, `post-purchase-invoice`'s IC amount, `generate_intercompany_matches`.

## A period snapshot written at close races Locked-period postings unless the posting guard locks the period row

```scope
id: a-period-snapshot-written-at-close-races-locked-period-posti
paths: ["packages/database/supabase/migrations/20260713235930_*.sql"]
triggers: ["check_accounting_period_open","accountingPeriodBalance","snapshotAccountingPeriodBalances","closeAccountingPeriod"]
```

**Context:** `closeAccountingPeriod` writes the `accountingPeriodBalance` snapshot inside its transaction, after flipping the period to `Closed`. `check_accounting_period_open` only *rejects* postings when a period is already `Closed`; a `Locked` period still accepts them (Locked is a soft freeze for adjustments). A period only becomes Closed on COMMIT.

**Problem:** In the window between the close txn's snapshot `SELECT` and its COMMIT, a concurrent posting reads the period as still-Locked (the flip is uncommitted under READ COMMITTED), is allowed, and commits a line with `postingDate <= endDate` that the snapshot never captured. The read path's delta only adds `postingDate > endDate`, so that line is silently dropped from the optimized balance until reopen+reclose — a wrong financial figure with no error.

**Rule:** When a cache/snapshot is written inside a state-flip transaction and a concurrent writer keys off the *committed* state, make the writer take a lock that conflicts with the flip. Here: the posting guard reads the target `accountingPeriod` row `FOR SHARE` (migration `20260713235930`), which blocks behind the close's row lock — postings before the flip commit first (and land in the snapshot); postings after block, then see `Closed` and are rejected. `FOR SHARE` is shared, so normal concurrent postings don't block each other; only an in-flight close serializes them. Verify with two psql sessions + `lock_timeout`.

**Applies to:** `check_accounting_period_open`; `snapshotAccountingPeriodBalances` / `accountingPeriodBalance`; any close/snapshot-on-commit pattern.

## A project account replacing a line's account must not lose that account's meaning

```scope
id: a-project-account-replacing-a-line-s-account-must-not-lose-t
paths: ["apps/erp/app/modules/projects/project-posting.ts","apps/erp/app/modules/invoicing/project-charges.ts"]
triggers: ["resolveProjectLineCharges","loadInvoiceProjectCharges","isUnallowableCharge","projectLedger"]
```

**Context:** A card charge, reimbursement or G/L Account invoice line charged to a project debits the project account in place of its own.

**Problem:** `isUnallowableCharge` read the account the row posts to, Project WIP, so a line on an Expressly Unallowable account (Entertainment) posted `unallowable = false` and would have billed the customer. A scenario test on the journal alone passed: the debit was right, only the ledger flag was wrong.

**Rule:** Read the facts of the line's own account before it is replaced. Check the `projectLedger` row as well as the journal when verifying a project posting.

**Applies to:** `resolveProjectLineCharges`, `loadInvoiceProjectCharges`, any new entry point that charges a project from a coded line.

## A rule on a posting belongs in the posting, not in the operation that wraps it

```scope
id: a-rule-on-a-posting-belongs-in-the-posting-not-in-the-operat
paths: ["apps/erp/app/modules/postings.server.ts"]
triggers: ["@carbon/api/postings.server","registerPosting","posting("]
```

**Context:** The purchase order funds gate was first placed in the `postPurchaseInvoice` operation (`invoicing.server.ts`), ahead of the `post-purchase-invoice` posting.
**Problem:** The Ramp bill sync and `@carbon/jobs` call the posting through `posting()` from `@carbon/api/postings.server`, never the operation. They posted invoices against unapproved orders, and the PR had to list it as a known gap.
**Rule:** A check that must hold for every caller of a posting goes in the posting body (`<module>.service.ts`), thrown as a `ServerFnError` with a status whose category fits (422 for a rule). The operation adds only what is specific to the route's caller.
**Applies to:** every posting registered in `apps/erp/app/modules/postings.server.ts`.

## A VERIFY-flagged provider endpoint in a cron loop is an outage, not a TODO

```scope
id: a-verify-flagged-provider-endpoint-in-a-cron-loop-is-an-outa
paths: ["packages/ee/src/accounting/providers/**"]
triggers: ["listChanges","SupportsIncrementalPull","VERIFY"]
```

**Context:** The Rillet AP payment pull assumed an org-wide `GET /bill-payments` feed mirroring `/invoice-payments`. The method carried a VERIFY comment ("assumed to mirror… not confirmed") and even named its own fallback, but shipped unguarded inside `listChanges`. The endpoint does not exist (404).

**Problem:** Every `accounting-pull-sweep` run threw at the AP step, killing the whole Rillet pull — including the AR invoice-payment changes collected earlier in the same call — every 30 minutes, silently. Payments recorded in Rillet never flowed back to Carbon, so a bill paid remotely stayed open locally, got paid a second time in Carbon, and the outbound push then failed forever on Rillet's over-pay guard. One unverified assumption at the bottom of a sweep became a permanent, compounding data gap that surfaced two layers away from its cause.

**Rule:** An API call that only runs inside a cron/sweep is exercised for the first time in production — verify VERIFY-flagged endpoints against the live sandbox *before* wiring them into a loop (one curl answers it), and never let one entity family's listing failure discard another family's already-collected changes. When an assumed endpoint is missing, compose from verified ones instead: Rillet AP payments = `GET /bills?updated.gt` (payment activity bumps the bill's `updated_at`) + `GET /bills/{id}/payments` per changed bill.

**Applies to:** `packages/ee/src/accounting/providers/rillet/provider.ts` (`listChanges`, `listBillPaymentsUpdatedSince`), any `SupportsIncrementalPull.listChanges` implementation, VERIFY-flagged calls anywhere under `packages/ee/src/accounting/providers/**`.

## Journal debit/credit is derived from account class + amount sign, not the raw sign

```scope
id: journal-debit-credit-is-derived-from-account-class-amount-si
paths: []
triggers: ["journalEntries","totalDebits","tb-balanced","journal_posted_immutable","journalLine"]
```

**Context:** Seeding a Cash sale as a journal via SQL, I used Cash (Asset) `amount = +1000` and Sales (Revenue) `amount = -1000`, assuming `+ = debit, - = credit` (which the `journal` AGENTS.md states for the *stored* value). The `journalEntries` view then reported the entry as `totalDebits = 2000, totalCredits = 0` — unbalanced — and the period-close "Trial balance in balance" auto-check (`tb-balanced`) refused the close.

**Problem:** `journalEntries.totalDebits`/`totalCredits` are computed from **account class AND amount sign**: Asset/Expense `amount>0` OR Liability/Equity/Revenue `amount<0` → debit; the mirror → credit. So a *positive* amount on a Revenue account is a **credit**, not a debit. A correctly-balanced sale is Cash (Asset) `+1000` and Sales (Revenue) `+1000` — both positive. The raw `SUM(amount)` the balance RPCs use is a separate, class-agnostic signed sum; don't conflate the two.

**Rule:** When hand-seeding `journalLine` rows, set the sign to move the account toward its natural balance: `+` increases an Asset/Expense (debit) and increases a Liability/Equity/Revenue (credit). Verify against the `journalEntries` view (`totalDebits == totalCredits` per `journalEntryId`) before relying on the data — an unbalanced entry silently blocks period close. Posted `journal`/`journalLine` rows are immutable (`journal_posted_immutable` / `journalLine_posted_immutable`); to correct seeded mistakes you must disable those triggers on the local DB (superuser), never in a migration.

**Applies to:** any SQL journal fixtures; the `journalEntries` view; the `tb-balanced` close check in `computePeriodReadiness` (`accounting.service.ts`).

## Never resolve a control account by number/name

```scope
id: never-resolve-a-control-account-by-number-name
paths: ["packages/database/src/seed-data.ts"]
triggers: [".eq(\"number\"","where(\"number\"","accountDefault"]
```

**Context:** Posting intercompany invoices/payments needed the "Inter-Company Receivables" control account. The edge functions (`post-sales-invoice`, `post-payment`) fetched it with `.eq("number", "1130")`.

**Problem:** Account `number` and `name` are user-editable at any time. Resolving a control account by a hardcoded number silently mis-posts the moment someone renumbers/renames the account — no error, wrong GL account. It also duplicates a magic constant across posting paths that can drift.

**Rule:** Resolve internal/control accounts by **id** via a column on `accountDefault` scoped to the `companyId` (the same pattern as `receivablesAccount`/`payablesAccount`). If no default column exists, add one to `accountDefault` (+ seed it in `seed.data.ts` and `seed-company`, + one-time backfill migration resolving the seeded number → id), then read `ad.<xxx>Account`. The only legitimate uses of `.where("number"/"eq("number")` on `account` are: building the chart at seed time, and mapping **external** codes in an integration (e.g. Xero AccountCodes) — never resolving an internal control account at posting time.

**Applies to:** the `post-*` postings (`apps/erp/app/modules/*/*.service.ts`), `close-job`, `issue`, anything posting to `journalLine`; `accountDefault` schema + `lib/seed.data.ts`.

## Prove provider accounting against its independent journal

```scope
id: prove-provider-accounting-against-its-independent-journal
paths: ["packages/ee/src/accounting/providers/rillet/**"]
triggers: ["Rillet","rillet"]
```

**Context:** The live Rillet E2E run accepted invoice payloads while ignoring their FX override and crediting deferred revenue.

**Problem:** Request shape and HTTP success did not prove economic parity. AR_ONLY used provider FX; the supported REVENUE_RECOGNITION_ONLY scope accepted fixed document-to-base rates and same-day recognition.

**Rule:** Verify returned account effects in the provider's independent GL, including recognition and voids. Treat Carbon's rate as document units per base unit, invert it for Rillet, and align recognition and FX dates with Carbon's posting date. Check voided mappings before create-idempotency shortcuts and retain durable deletion markers.

**Applies to:** Rillet invoice/bill/payment adapters, native-void reconciliation, and future provider acceptance tests.

## Resolve the accounting period BEFORE a transaction that writes for N records

```scope
id: resolve-the-accounting-period-before-a-transaction-that-writ
paths: []
triggers: ["getCurrentAccountingPeriod","getAccountingPeriodForDate","getNextSequence"]
```

**Context:** The batch material pick (`issue` case `trackedEntitiesToBatch`) runs one Kysely transaction and calls the per-member consumption writer once per batch member. Each member's write path reaches `createMaterialWipEntries` → `getCurrentAccountingPeriod`.

**Problem:** `getCurrentAccountingPeriod` READS the period over HTTP (supabase-js) but CREATES a missing one through the transaction handle. Inside one transaction, member 2's read cannot see member 1's uncommitted insert, so both try to create the same month and the `accountingPeriod_company_fy_period_idx` unique index aborts the whole pick. It only fires on the first posting of a month into a fresh database, so it passes every test run but the first — and the rollback makes it look like the pick silently did nothing (HTTP 200, empty body; the real error is only in the edge-runtime log).

**Rule:** Any lazily-created singleton that reads outside the transaction and writes inside it must be resolved BEFORE the transaction opens, once, when a flow writes for N records in one transaction. For the accounting period that is `await getCurrentAccountingPeriod(client, companyId, db, companyToday.toString())` ahead of `db.transaction()`, guarded on `accountingEnabled`.

**Applies to:** `getCurrentAccountingPeriod` / `getAccountingPeriodForDate` in any multi-record edge-function transaction; the same shape applies to `getNextSequence` and any other get-or-create helper straddling the transaction boundary.
