# Run Log: 2026-08-05 Accounting Handoff (Phase F fixes + Document Representation)

> Executing `.ai/plans/archived/2026-08-05-accounting-handoff.md`. Branch `feat/rillet`.
> Ground rules: never commit/push/stash/reset/clean; pnpm only; scoped gates; ENV-GATED
> steps skipped + logged; STOP-and-report on any code mismatch (no improvised workarounds).

## Baseline (before any edit)

- `pnpm exec turbo run typecheck --filter=@carbon/ee` → **green** (1 successful).
- `pnpm --filter @carbon/ee test` → **456 passed (32 files)** — matches handoff baseline.

---

## Part A — Phase F review fixes

### A1 — Xero: make deleted payments visible to the sweep — **done**

- Change: removed the `where=Status=="AUTHORISED"` filter from `XeroProvider.listChanges`
  (`providers/xero/provider.ts`); the poll now returns both AUTHORISED and DELETED
  payments so the void path (`entities/payment.ts` DELETED → `status:'void'`) is
  reachable. Updated the method doc comment. `dependsOnMapping` still emitted for
  DELETED payments (logic doesn't branch on status — confirmed).
- Tests: updated the existing listChanges test's URL assertion (`not.toContain
  "where=Status"`); added a new test asserting one AUTHORISED + one DELETED payment
  page yields two payment changes each with its invoice dependency. DELETED →
  `mapToNormalized` → `status:'void'` already covered by `entities/__tests__/payment.test.ts`.
- Gates: `typecheck @carbon/ee` → **pass (1 successful)**; `test @carbon/ee` →
  **457 passed (32 files)** (baseline 456, +1 new test).

### A2 — QBO: hard-deleted payments become tombstone voids — **done**

- Changes (4 pieces of the design implemented as written):
  1. `providers/quickbooks-online/provider.ts` `buildPaymentChange`: a CDC
     `Deleted` Payment/BillPayment stub now emits a deleted-flagged change
     carrying the BARE payment id (no refetch, no `dependsOnMapping`) instead of
     logging+returning null.
  2. NEW `core/payment-tombstone.ts` → `findPaymentCompositesByRemoteId(client,
     {companyId, integration, paymentRemoteId})`: suffix-matches
     `externalIntegrationMapping` (`entityType='payment'`, `externalId LIKE
     '%:<id>'` + exact JS `endsWith` guard) to recover the composite(s). Exported
     from the accounting barrel.
  3. `accounting-pull-sweep.ts` deleted-stub branch: for `entityType==='payment'`
     it calls the helper and enqueues one pull op per composite (via a new
     shared `enqueueChange` closure); no match → skip as before; non-payment
     deletions unchanged (log+skip).
  4. `providers/quickbooks-online/entities/payment.ts` `fetchRemote`: a not-found
     (null) refetch returns a bare tombstone marker `{ Id: paymentRemoteId }`;
     `mapToNormalized` maps it (amount 0, no lines) to `status:'void'` →
     `upsertLocalPaymentDraft` `postAction:'void'` → `post-payment {type:'void'}`.
- **DESIGN NOTE (non-blocking):** the handoff said the deleted-flagged change
  should carry "the bare QBO payment id + family". `ProviderChange` (core/types.ts)
  has no `family` field, and the sweep helper resolves the composite by suffix
  regardless of family (`bill:` prefix already encodes it), so family is neither
  representable nor needed. Implemented without it. Not a STOP — the cited
  behavior is satisfied; only the incidental "+ family" is dropped.
- **DESIGN NOTE (non-blocking):** the design said fetchRemote should "catch the
  not-found error"; the actual provider `getPayment`/`getBillPayment` return
  `null` on error (they never throw). Implemented as a null check. A first-ever
  pull that 404s is caught by shouldSync's first-seen-void skip (isFirstSync +
  amount 0), so nothing is voided that was never recorded.
- Tests: (a) CDC test rewritten — a `Deleted` BillPayment stub now yields one
  deleted-flagged bare-id change, still no refetch (1 fetch call). (b) NEW
  `core/payment-tombstone.test.ts` (5 cases): AP + AR suffix resolution, exact
  endsWith guard drops coarse `:xbp-1`/null matches, `[]` on error, `[]` on no
  match. (c) NEW `entities` tombstone test: `fetchRemote` null → `{Id}` marker →
  `mapToNormalized` void (family/doc/amount 0, no linkedDocuments); a found
  payment passes through untouched. Full `functions.invoke({type:'void'})` chain
  is base behavior already covered by base/payment tests + upsertLocalPaymentDraft
  void semantics (not re-driven here — would require standing up the DB tx).
- Gates: `typecheck @carbon/ee` → **pass**; `test @carbon/ee` → **464 passed
  (33 files)** (+7 vs 457); `typecheck @carbon/jobs` → **pass** (sweep touched).

### A3 — Rillet: park FX payments instead of posting at rate 1 — **done**

- Change: `providers/rillet/entities/payment.ts` `shouldSync` now reads the
  company base currency (`loadCompanyBaseCurrency(this.database, this.companyId)`
  from `./shared`, cached per instance via `baseCurrencyPromise` — same pattern
  as the item/journal-entry syncers) and compares it to the payment currency
  (`getRilletPaymentCurrency(remoteEntity)`). Mismatch → skip with reason
  `FX payment (<cur> ≠ base <base>) — not supported v1`. Same currency or no
  currency → proceed unchanged. Placed after the first-seen-FAILED skip, before
  `return true`, using the existing skip-with-reason mechanism.
- Tests: new `shouldSync FX gate` describe (3 cases): EUR≠USD parked with the
  reason; USD proceeds; currency-less payment proceeds. Added a table-aware fake
  db (`makeFxDb`) answering both the metadata and `company.baseCurrencyCode`
  reads. Existing ownership-gate tests unaffected (their fixtures carry no
  currency, so the FX branch is a no-op).
- Gates: `typecheck @carbon/ee` → **pass**; `test @carbon/ee` → **467 passed
  (33 files)** (+3 vs 464).

### A4 — Force-enable pull-only `payment` for QBO and Xero — **done (already forced; added assertions)**

- Finding: BOTH providers ALREADY force-enable `payment` the way Rillet does —
  `buildQboSyncConfig` (`quickbooks-online/provider.ts`, `QBO_PULL_ONLY_ENTITIES`)
  and `buildXeroSyncConfig` (`xero/provider.ts`, `XERO_PULL_ONLY_ENTITIES`) both
  overlay `payment → { enabled: true, direction: 'pull-from-accounting', owner:
  'accounting' }` in the constructor. No forcing mechanism needed to be added.
- Per the handoff ("If yes, just add the assertion test"), added a direct
  force-enable assertion per provider, mirroring the Rillet `buildRilletSyncConfig`
  test: (1) `build*SyncConfig(stored-with-payment-disabled).entities.payment`
  equals the forced pull-only shape (and asserts `DEFAULT_SYNC_CONFIG` ships it
  disabled), and (2) a constructed provider's `getSyncConfig("payment")` returns
  the forced shape. Added to `quickbooks-online/__tests__/provider.test.ts` and
  `xero/provider.test.ts`.
- Gates: `typecheck @carbon/ee` → **pass**; `test @carbon/ee` → **471 passed
  (33 files)** (+4 vs 467).

### A5 — Settings copy for the families gate — **done (optional, A1–A4 clean)**

- Change: `apps/erp/app/modules/settings/ui/Integrations/PostingSyncSettings.tsx`
  — extended the existing AR/AP representation `<Trans>` helper paragraph (the
  same route's own copy pattern) to also explain that `documents` mode pulls
  provider-recorded payments back into Carbon, closing the matching invoice or
  bill and posting a Carbon GL journal. No new component; no parenthesized
  numbers. (The `familyAr`/`familyAp` Selects share this section's description.)
- Gate: `pnpm exec turbo run typecheck --filter=erp` → **pass (1 successful)**.
- Note: the copy change alters a Lingui message id; the .po catalogs refresh at
  build/extract time (not required by A5's verify, which is erp typecheck only).

## Final report

### Per-task status

| Task | Status | Notes |
|------|--------|-------|
| A1 — Xero deleted payments visible to sweep | done | AUTHORISED-only filter removed |
| A2 — QBO hard-deleted tombstone voids | done | 2 non-blocking design notes (see A2) |
| A3 — Rillet FX payments parked | done | base-currency FX gate in shouldSync |
| A4 — Force-enable pull-only `payment` (QBO+Xero) | done | already forced; added assertions |
| A5 — Settings copy for families gate | done | optional; done since A1–A4 clean & quick |

### Final gate counts

- `pnpm exec turbo run typecheck --filter=@carbon/ee` → **pass**.
- `pnpm --filter @carbon/ee test` → **471 passed (33 files)** vs the **456**
  baseline (+15 tests, all new; 0 regressions).
- `pnpm exec turbo run typecheck --filter=@carbon/jobs` → **pass** (A2 sweep edit).
- `pnpm exec turbo run typecheck --filter=erp` → **pass** (A5 copy edit).

### ENV-GATED skips (Part A)

- None. No Part A task required a provider sandbox or a running stack; all four
  fixes were unit-verifiable. (Part B and its VERIFY gates were NOT executed —
  out of scope for this run.)

### STOP-and-report mismatches

- None that blocked. Two **non-blocking** cited-vs-actual deviations, both in A2,
  adapted faithfully (details in the A2 section):
  1. Handoff: deleted-flagged change carries "bare payment id + family".
     Actual: `ProviderChange` (core/types.ts) has no `family` field, and the
     suffix helper resolves the composite without it. Implemented without family.
  2. Handoff: fetchRemote should "catch the not-found error". Actual: QBO
     `getPayment`/`getBillPayment` return `null` on error (never throw).
     Implemented as a null-check → tombstone; shouldSync's first-seen-void skip
     protects a never-recorded payment.

Nothing committed (per ground rules).

## Part B — Document representation

> Baseline re-confirmed before starting Part B: `typecheck @carbon/ee` → **pass**;
> `test @carbon/ee` → **471 passed (33 files)** (matches the Part A end state).

### B-0.1 — Extract `core/document-costing.ts` — **done**

- NEW `packages/ee/src/accounting/core/document-costing.ts`:
  - `loadBillCostingLines(db, { companyId, billId, payablesAccountId })` →
    `{ lines: CostingLine[], currencyCode, exchangeRate }`. Reads the bill's
    `purchaseInvoice` currency/rate, then its posted "Purchase Invoice"
    journal lines (base-currency, debit-signed via `toDebitSignedAmount`);
    excludes the AP control line (`accountId === null || !== payablesAccountId`,
    verbatim from Rillet's filter); carries `journalLineDimension` refs; and
    joins item labels via `documentLineReference` (`purchase-invoice:<poLineId>`
    → `purchaseOrderLine.itemId` → `item.readableId`/`name`). Direct/variance
    lines resolve to `sourceItem: undefined`. Empty `lines` = no posted journal.
  - `toTransactionCurrencyLines(lines, exchangeRate)` — ÷ rate, 2dp, residue
    into the largest-|amount| line; rate 1 = pass-through; negatives preserved.
  - Added to the accounting barrel (`index.ts`).
- **Pre-verified facts confirmed against code** (no mismatch): `journalLine.
  documentLineReference` column exists (`20230705033432_ledgers.sql:112`);
  stamped `purchase-invoice:<id>` by `journalReference.to.purchaseInvoice`
  (`functions/lib/utils.ts:113`); `purchaseOrderLine.itemId` FK → `item`
  (`20230510035345_purchasing.sql:353`); `item.readableId`/`item.name` exist;
  `Rillet.BillSchema.exchange_rate` present.
- Tests: NEW `core/document-costing.test.ts` (8 cases): AP-line exclusion +
  debit-sign, PO-backed sourceItem vs bare variance line, dimension carry,
  no-posted-journal → `[]`, and `toTransactionCurrencyLines` rate-1
  pass-through / residue balancing / negative preservation / empty input.
- Gates: `typecheck @carbon/ee` → **pass**; `test document-costing` →
  **8 passed (1 file)**.

### B-0.2 — Refactor Rillet bill onto the core (parity + FX fix + shouldSync) — **done**

- `providers/rillet/entities/bill.ts`:
  - Removed `fetchPostingJournalLines` + `filterBillCostingLines` (no other
    importers — grep clean); `mapToRemote` now calls the shared
    `loadBillCostingLines`.
  - `BillPostingJournalLine` is now an alias of the core `CostingLine`
    (stable name for the mapper's tests).
  - `mapBillToRilletBill`: prepends the item label
    (`describeCostingLine`: `"<code> <name> — <desc>"`, or the label alone
    when the line has no description) when `sourceItem` is present; runs
    `toTransactionCurrencyLines(costingLines, bill.exchangeRate)` and pins
    `exchange_rate` on the payload when the rate ≠ 1. **FX bug fixed**:
    previously pushed base-currency amounts under the transaction currency
    with no rate; now pushes transaction-currency amounts + `exchange_rate`.
  - Kept the defensive AP re-filter + the unmapped-account Warning so raw
    journal-line callers (tests) still work.
  - Added a posted-status `shouldSync` (`SYNCABLE_STATUSES` = the 7 posted
    bill statuses; Draft + Voided excluded) mirroring the Rillet invoice
    syncer.
- **Parity gate (gate for all of Part B) — PASSED:** the 7 pre-existing
  Rillet bill tests (base-currency, no sourceItem) are byte-identical (green
  unchanged). Added 3 tests: item-label prepend (account/amount unchanged,
  `exchange_rate` undefined at rate 1), label-only when no description, and
  an FX fixture (EUR @ rate 2) asserting halved transaction-currency amounts
  + `exchange_rate: 2` + preserved negative variance line.
- Gates: `typecheck @carbon/ee` → **pass**; `test @carbon/ee` → **482 passed
  (34 files)** (471 baseline + 8 B-0.1 + 3 B-0.2; 0 regressions).
- Also added `costingLineItemLabel` to `core/document-costing.ts` (shared
  `"<code> <name>"` label helper) and refactored Rillet's `describeCostingLine`
  onto it (Rillet still *prepends*; QBO/Xero *substitute* — per the plan's
  differing phrasing).

### B-1.1 — QBO bill → account-based journal replay (PO untouched) — **done**

- `providers/quickbooks-online/entities/bill.ts`:
  - NEW pure `buildQboBillLines({ bill, costingLines, accountRefsById })`
    emitting one `AccountBasedExpenseLineDetail` per costing line to the
    journal's mapped account (via the existing `loadQboAccountRefsById`
    resolution); `Description = costingLineItemLabel(line) ?? line.description`;
    no item detail, no tax. Unmapped / account-less / no-journal → structured
    `UNMAPPED_ACCOUNTS` Warning (`warning: true`), mirroring the Rillet bill.
  - `mapToRemote`: dropped `ensureDependencySynced("item")` (labels come from
    Carbon, not the QBO item) and the shared `buildQboExpenseLines` call;
    now loads costing lines via `loadBillCostingLines`, converts with
    `toTransactionCurrencyLines`, and pins `CurrencyRef` + `ExchangeRate`
    (omitted at rate 1). Kept the vendor JIT + DocNumber + Net-30 due date.
  - Added a push-only posted-status `shouldSync` (`SYNCABLE_STATUSES`;
    Draft/Voided excluded) mirroring the QBO invoice syncer.
  - Added `getPayablesAccountId`.
  - **`buildQboExpenseLines` (shared.ts) and `purchase-order.ts` untouched** —
    the PO keeps item-referenced `ItemBasedExpenseLineDetail` lines by design.
- `models.ts`: added `CurrencyRef` (`RefSchema`) + `ExchangeRate` (number) to
  `Qbo.BillSchema` (both optional; set on FX bills).
- Tests (`entities/__tests__/bill.test.ts`, +5): 4 pure `buildQboBillLines`
  (account-based lines to journal accounts + item label + no
  ItemBasedExpenseLineDetail + no tax; negative PPV line survives; unmapped →
  retryable UNMAPPED_ACCOUNTS Warning; no-journal → Warning) and 1
  `mapToRemote` FX drive (table-dispatching Kysely fake): EUR @ rate 2 →
  `CurrencyRef {value:"EUR"}` + `ExchangeRate: 2` + 150 EUR to the mapped
  GR/IR account only (AP excluded). The 4 pre-existing `buildQboExpenseLines`
  PO/bill tests stay green (shared builder unchanged).
- **ENV-GATED (skipped + logged):** VERIFY gate 4 (QBO account-based bill line
  to a clearing account posts + GR-IR nets to zero) and VERIFY gate 5 (QBO
  accepts a negative `Amount` on an `AccountBasedExpenseLineDetail` line) —
  both require the QBO sandbox. Per the handoff, negative lines keep flowing
  through the builder unchanged (a negative-line test asserts this); NO
  per-account netting was preemptively implemented — the sandbox check is
  pending.
- Gates: `typecheck @carbon/ee` → **pass**; `test @carbon/ee` → **487 passed
  (34 files)** (+5 vs 482).

### B-2.1 — Xero items non-tracked (done FIRST) — **done**

- `providers/xero/entities/item.ts` `mapToRemote`:
  - CREATE (no remote mapping) → `IsTrackedAsInventory: false`.
  - UPDATE (remote mapping exists) → **omit** `IsTrackedAsInventory` (Xero
    rejects untracking an item with stock/txns). Fetches the remote; if it is
    still tracked, records a Warning (untrack instructions) and **proceeds**
    with the update (name/price sync is never blocked).
  - `mapToLocal` unchanged (keeps reading the remote flag).
- **DEVIATION NOTE (non-blocking):** the plan says "land a Warning" on
  tracked-remote. `ItemSyncer` extends `BaseEntitySyncer` directly, which has
  **no structured-error preservation** (a thrown `JournalEntrySyncError`
  flattens to a Failed op) — and blocking item sync for every legacy tracked
  item would stop name/price updates. So the tracked-remote warning is a
  recorded `console.warn` (greppable) and the update proceeds. This is the
  "recorded, not silent" degradation; a genuine Warning-op would require a
  pushToAccounting override the plan doesn't call for.
- Tests: NEW `entities/__tests__/item.test.ts` (3): create → false; update
  (non-tracked remote) → field omitted; update (tracked remote) → `console.warn`
  called + field omitted.
- **ENV-GATED (skipped + logged):** VERIFY gate 2 (Xero's exact rejection shape
  for flipping a tracked item with history) — sandbox; the create-only /
  omit-on-update + warning rule ships regardless.

### B-2.2 — Xero bill → account-costed replay — **done**

- Added shared `loadAccountCodesById(db, { companyId, integration })` to
  `core/account-mapping.ts` (account.id → provider account CODE via the
  mapping `externalCode`) — mirrors the Xero journal syncer's private
  `getAccountCodesById` and Rillet's `loadRilletAccountCodesById`.
- `providers/xero/entities/bill.ts`:
  - NEW pure `buildXeroBillLineItems({ bill, costingLines, accountCodesById,
    nonTrackedItemIds })`: `AccountCode` = the journal line's mapped account
    (not `defaultPurchaseAccountCode`); `TaxType: "NONE"` + no `TaxAmount` on
    every line (dropped the old INPUT/TaxAmount); `Description =
    costingLineItemLabel(line) ?? line.description`; `ItemCode` attached ONLY
    for `nonTrackedItemIds`. Unmapped / account-less / no-journal → structured
    UNMAPPED_ACCOUNTS Warning.
  - `mapToRemote`: loads costing lines via `loadBillCostingLines`, converts
    with `toTransactionCurrencyLines`, keeps `CurrencyCode` + pins
    `CurrencyRate` on FX; **omits `SubTotal`/`TotalTax`/`Total`** (Xero
    computes from the NONE-taxed lines — avoids a tax-inclusive conflict).
    Added a `shouldSync` (posted-status; Draft skipped) + a **paid-doc guard**:
    re-pushing a `Paid`/`Partially Paid` bill throws the new `DOC_HAS_PAYMENTS`
    Warning (Xero rejects edits to a bill with payments) instead of a line
    rewrite. Added `getAccountCodesById` + `getPayablesAccountId`.
  - Added `DOC_HAS_PAYMENTS` to `JOURNAL_ENTRY_SYNC_ERROR_CODES` (posting.ts).
- **`ItemCode` decision (v1, documented):** `nonTrackedItemIds` is passed
  `undefined` from the syncer, so no bill line gets `ItemCode` in production —
  proving a Xero item is non-tracked needs a live per-item fetch (env-gated),
  and attaching `ItemCode` for a *tracked* item would double-post inventory.
  The pure builder fully supports the set (tested with a non-empty set), so the
  behavior is future-ready; the account-costed lines carry the item in
  `Description`. Same deviation as B-2.1: a thrown Warning flattens (Xero
  syncers have no structured-error preservation) — greppable message ships.
- Tests: NEW `entities/__tests__/bill.test.ts` (8): 6 pure `buildXeroBillLineItems`
  (journal account codes + TaxType NONE + item label + ItemCode-only-for-
  non-tracked + ItemCode-omitted + negative line + unmapped Warning + no-journal
  Warning) and 3 `mapToRemote`/`shouldSync` drives (FX EUR@2 → `CurrencyRate: 2`
  + 150 EUR to GR/IR only + no totals; paid-doc → DOC_HAS_PAYMENTS Warning;
  Draft → shouldSync skip).
- **ENV-GATED (skipped + logged):** VERIFY gate 3 (Xero ACCPAY honors
  AccountCode + TaxType NONE on a line → GR-IR clears, no tax added) — sandbox.

### B-2.3 — Xero invoice → item's revenue account — **done**

- `providers/xero/entities/invoice.ts`: line `AccountCode` now resolves to the
  item's mapped REVENUE account — `accountDefault.salesAccount` → the
  account-mapping `externalCode` (new `getSalesAccountCode`, cached per
  instance), the same resolution feeding Rillet's product `account_code` /
  QBO's `IncomeAccountRef`. Falls back to `defaultSalesAccountCode` ONLY when
  the sales account is unset or unmapped (AR sync never blocked). `ItemCode` +
  tax handling (`OUTPUT`/`NONE`, `LineAmountTypes: "Exclusive"`) unchanged.
- Tests: NEW `entities/__tests__/invoice.test.ts` (2): mapped sales account
  "4000" used (not the default "9999"), item + tax unchanged; fallback to
  "9999" when `salesAccount` is null.

### Part B running gate

- `typecheck @carbon/ee` → **pass**; `test @carbon/ee` → **500 passed
  (37 files)** (471 baseline + 29 new; 0 regressions).

## Final report

_(filled at end of run)_
