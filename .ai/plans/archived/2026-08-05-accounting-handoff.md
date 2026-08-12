# Handoff: Accounting Sync — Phase F Review Fixes + Document Representation

> For: an implementation agent. Follow this file literally. Do not redesign, do not
> re-litigate decisions — every open question is already resolved in the specs.
> Branch: `feat/rillet` (workspace `maseru`). Target branch for diffing: `origin/main`.
> Sources of truth (already amended 2026-08-05 — read them, they agree with this file):
> - `.ai/specs/implemented/2026-07-09-accounting-sync-engine.md` §Phase F
> - `.ai/plans/archived/2026-08-05-accounting-bill-payment-sync.md` (Task 4.4 = Part A here)
> - `.ai/specs/implemented/2026-08-05-accounting-document-representation.md`
> - `.ai/plans/archived/2026-08-05-accounting-document-representation.md` (Part B executes this)
>
> If this file conflicts with those, THIS FILE WINS (it is the newest distillation).
> If this file conflicts with the CODE (a cited function/shape doesn't exist), STOP that
> task and record the mismatch in your run log — do not improvise a workaround.

## Ground rules — read before any edit

1. **The working tree has large uncommitted work that is not yours** (the whole Phase F
   payment sync-back). NEVER run `git stash`, `git checkout .`, `git reset`, `git clean`.
   **NEVER commit or push.** Leave all committing to Brad.
2. `pnpm` only, never `npm`. Never run a whole-repo `tsc` (it OOMs). Scoped gates only:
   - `pnpm exec turbo run typecheck --filter=@carbon/ee`
   - `pnpm --filter @carbon/ee test`
   - `pnpm exec turbo run typecheck --filter=erp` (only when you touch `apps/erp`)
3. Baseline before you start: run both `@carbon/ee` gates and record the counts
   (last known green: 456 tests). If the baseline is red, STOP and report — it is not
   your job to fix pre-existing failures.
4. Tests use `noUncheckedIndexedAccess`: write `arr[0]?.prop`, and run the typecheck
   gate after editing tests, not just the test run.
5. Never use JS `Date` for parsing/formatting/arithmetic — `@internationalized/date` +
   `formatDate` from `@carbon/utils` (see `.claude/rules/date-handling.md`).
6. Steps marked **ENV-GATED** need a provider sandbox or a running stack. SKIP them,
   mark them "skipped (env-gated)" in the run log. Never fake or infer their results.
7. Work one task at a time, in the order given. After each task run its **Verify** and
   paste the command output summary into your run log.
8. Keep a run log at `.ai/runs/2026-08-05-accounting-handoff-run.md`: one section per
   task with status (done / skipped / blocked), gate output, and any mismatch notes.

## Pre-verified facts — do NOT re-derive these (they were audited against code 2026-08-05)

- **`post-payment` edge fn** (`packages/database/supabase/functions/post-payment/index.ts`)
  accepts only `{ type: 'post'|'void', paymentId, userId, companyId }`. It does **NOT**
  write `salesInvoice`/`purchaseInvoice` status — document status is **view-derived**
  from settlements of `Posted` payments. Void inserts a mirror reversing journal, sets
  the payment `Voided`, and **keeps** `invoiceSettlement` rows (the views reopen the
  document). Tests must assert settlements retained on void, never deleted.
- **Payment composite ids** (all three providers): AR = `<docRemoteId>:<paymentRemoteId>`,
  AP = `bill:<docRemoteId>:<paymentRemoteId>`.
- **`postAction`** from `upsertLocalPaymentDraft`
  (`packages/ee/src/accounting/core/payment-application.ts`): settled → `'post'`;
  settled + already Posted → `'none'`; failed/void on a Posted payment → `'void'`;
  else `'none'`. The base syncer (`core/payment-syncer.ts`) invokes `post-payment`
  after the pull transaction commits, via
  `getCarbonServiceRole().functions.invoke("post-payment", ...)` (lazy import of
  `@carbon/auth/client.server` — a top-level import breaks tests).
- **Inbound payment gate**: `isPaymentSyncbackEnabled(metadata, family)` in
  `packages/ee/src/accounting/core/posting.ts` — true iff
  `families[family] === 'documents'`. There is no separate `paymentSyncback` flag.
- **`journalLine.documentLineReference`** holds the prefixed string
  `purchase-invoice:<purchaseOrderLineId>` (the **purchase-order** line id, stamped by
  `post-purchase-invoice` via `journalReference.to.purchaseInvoice` in
  `packages/database/supabase/functions/lib/utils.ts`), and is **NULL for direct no-PO
  invoice lines**. It never contains a `purchaseInvoiceLine` id.
- **Purchase Invoice journal lines are per invoice line** (one GR-IR line + one AP line
  per line), always **base currency** (`amount = base * invoiceExchangeRate` happens at
  posting). `toDebitSignedAmount` (`core/posting.ts`) negates Liability/Equity/Revenue.
- **The purchase-invoice journal has NO tax line** — tax is folded into line cost.
- **Rillet bill today** (`providers/rillet/entities/bill.ts`): `mapBillToRilletBill`,
  `filterBillCostingLines` (drops lines where `accountId === payablesAccountId`, keeps
  null-account lines), `fetchPostingJournalLines` (requires
  `journal.sourceType='Purchase Invoice'` AND `status='Posted'`). Known bug you will
  fix: it pushes **base-currency** amounts labeled with the **transaction** currency
  and omits `exchange_rate` (`Rillet.BillSchema` in `rillet/models.ts` allows it).
- **QBO bill today** uses the shared `buildQboExpenseLines`
  (`providers/quickbooks-online/entities/shared.ts`, item lines →
  `ItemBasedExpenseLineDetail`), which is ALSO used by `purchase-order.ts`.
  `Qbo.BillSchema` (`quickbooks-online/models.ts`) has no tax fields and no
  `CurrencyRef`/`ExchangeRate`.
- **Xero bill today** (`providers/xero/entities/bill.ts`): line `AccountCode =
  line.accountNumber ?? settings.defaultPurchaseAccountCode`; `TaxType:
  hasTax ? "INPUT" : "NONE"` + `TaxAmount`; bill sets `CurrencyCode` + `CurrencyRate`
  (when rate ≠ 1) and no `LineAmountTypes`. **Xero invoice today**: every line
  `AccountCode = settings.defaultSalesAccountCode`, `TaxType OUTPUT/NONE`,
  `LineAmountTypes: "Exclusive"`. **Xero item today** (`entities/item.ts`): pushes
  `IsTrackedAsInventory = (itemTrackingType !== "None")`.
- **Invoice syncers gate on** `SYNCABLE_STATUSES =
  ["Pending","Submitted","Partially Paid","Paid","Overdue"]` (each provider's
  `entities/invoice.ts`). **No bill syncer has any `shouldSync` today.**

---

## Part A — Phase F review fixes (patching existing, uncommitted code)

### Task A1 — Xero: make deleted payments visible to the sweep

- **File:** `packages/ee/src/accounting/providers/xero/provider.ts`, `listChanges`
  (search for `If-Modified-Since`; currently filters `where=Status=="AUTHORISED"`).
- **Why:** a payment deleted in Xero has `Status: "DELETED"` — the AUTHORISED-only
  filter never returns it, and the Invoice-update webhook can't surface it either
  (deleted payments are absent from the refetched `Payments[]`). So the void path in
  `providers/xero/entities/payment.ts` (`Status === "DELETED"` → `'void'`) is
  currently unreachable.
- **Change:** remove the `Status=="AUTHORISED"` where-clause so the poll returns both
  AUTHORISED and DELETED payments (Xero payments have only those two statuses). Keep
  `If-Modified-Since` and the pagination. Confirm the emitted `ProviderChange` for a
  DELETED payment still carries `dependsOnMapping` on the invoice/bill (it should —
  the mapping-dependency logic doesn't branch on status).
- **Verify:** unit test in the Xero provider tests — a fixture `/Payments` page with
  one AUTHORISED and one DELETED payment yields two `payment` changes; the DELETED
  one flows through `mapToNormalized` to `status: 'void'`. Existing Xero tests green.
  Run both `@carbon/ee` gates.

### Task A2 — QBO: hard-deleted payments become tombstone voids

- **Files (read all four before editing):**
  `packages/ee/src/accounting/providers/quickbooks-online/provider.ts` (`listChanges`,
  `buildPaymentChange`, `QBO_CDC_ENTITY_TYPES`),
  `packages/ee/src/accounting/providers/quickbooks-online/entities/payment.ts`,
  `packages/jobs/src/inngest/functions/integrations/accounting-pull-sweep.ts` (the
  deleted-stub skip), `packages/ee/src/accounting/core/payment-application.ts`
  (`postAction` logic).
- **Why:** a QBO CDC `Deleted` stub carries only the entity name + Id (no lines), the
  current payment path refetches the object (404 for a hard delete), and the sweep
  logs-and-skips `deleted` stubs — so a hard-deleted `Payment`/`BillPayment` never
  voids the Carbon payment. (Voided-but-existing payments already work via
  `TotalAmt === 0`.)
- **Design (implement as written; if a piece doesn't fit the actual base-class shape,
  STOP and report):**
  1. In QBO `listChanges`: when a CDC entity for `Payment`/`BillPayment` has
     `status === "Deleted"`, do NOT refetch. Emit a change flagged deleted carrying
     the bare QBO payment id + family (`Payment`→ar, `BillPayment`→ap).
  2. Add a helper in `packages/ee/src/accounting/core/` (so it is unit-testable):
     given `(companyId, integration, bare paymentRemoteId)`, find
     `externalIntegrationMapping` rows with `entityType='payment'` whose
     `externalId` ends with `:<paymentRemoteId>` (both composite forms end that way)
     and return the mapped composite externalIds.
  3. In the pull sweep's deleted-stub branch: for `entityType === 'payment'`, call
     the helper and enqueue one pull operation per matched composite (same enqueue
     call the sweep already uses). No match → skip as today (never synced / not ours).
  4. In `QboPaymentSyncer.fetchRemote`: catch the not-found error and return a
     tombstone marker; `mapToNormalized` maps the marker to a `NormalizedPayment`
     built purely from the parsed composite entityId (`family`, `documentRemoteId`,
     `paymentRemoteId`, `amount: 0`, `status: 'void'`). The void path only needs the
     existing payment mapping + `status: 'void'` — `postAction` becomes `'void'` and
     the base invokes `post-payment { type: 'void' }`.
- **Verify:** unit tests — (a) CDC fixture with a `Deleted` BillPayment stub →
  `listChanges` emits the deleted-flagged change without refetching; (b) the suffix
  helper resolves `bill:bill-9:bp-1` from bare `bp-1`; (c) syncer not-found →
  normalized `status:'void'` → mocked `functions.invoke` called with
  `{ type: 'void' }`. Existing `provider-payment-cdc` tests green. Both gates.

### Task A3 — Rillet: park FX payments instead of posting at rate 1

- **File:** `packages/ee/src/accounting/providers/rillet/entities/payment.ts`
  (`mapToNormalized` hardcodes `exchangeRate: 1` — a documented v1 same-currency
  simplification; `shouldSync` already has skip-with-reason patterns, e.g. the
  first-seen-FAILED skip).
- **Change:** in `shouldSync`, compare the remote payment's currency (the file already
  parses amount/currency from the wire) against the company base currency (grep
  `baseCurrencyCode` in `packages/ee` / the generated DB types to find the canonical
  read; the syncer has `this.database`). Mismatch → skip with reason
  `"FX payment (<cur> ≠ base <base>) — not supported v1"` using the existing
  skip-with-reason mechanism. Same currency (or missing currency) → proceed unchanged.
- **Verify:** unit tests — FX payment skipped with that reason; base-currency payment
  proceeds. Both gates.

### Task A4 — Force-enable the pull-only `payment` entity for QBO and Xero

- **Files:** `packages/ee/src/accounting/providers/quickbooks-online/index.ts`,
  `packages/ee/src/accounting/providers/xero/index.ts`; template:
  `RILLET_PULL_ONLY_ENTITIES` in `packages/ee/src/accounting/providers/rillet/index.ts`.
- **Why:** `DEFAULT_SYNC_CONFIG` ships `payment` as `enabled: false`, and both QBO's
  and Xero's `listChanges` gate on `getSyncConfig("payment").enabled`. Rillet
  force-enables its pull-only entities; if QBO/Xero don't, the whole feature is dark
  by default even though the `families` gate defaults to `documents` (on). The
  `families` mode is the intended user-facing switch.
- **Change:** check whether each registry already forces
  `{ enabled: true, direction: 'pull-from-accounting', owner: 'accounting' }` for
  `payment` the way Rillet does. If yes, just add the assertion test. If no, add the
  same forcing mechanism (copy Rillet's, do not invent a new one).
- **Verify:** unit test per provider asserting the resolved sync config for `payment`
  is force-enabled pull-only by default (mirror however the Rillet tests assert it —
  grep `PULL_ONLY` in the Rillet tests). Both gates.

### Task A5 (LOW priority, optional) — Settings copy for the families gate

- **File:** `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` (the posting-sync
  `families` setting; the route already uses `resolvePostingSyncSettings`).
- **Change:** add helper text on the AR/AP family mode field: `documents` mode also
  pulls provider-recorded payments back into Carbon (closes invoices/bills and posts
  a Carbon GL journal). Copy an existing helper-text pattern from the same route; no
  new components; no parenthesized numbers.
- **Verify:** `pnpm exec turbo run typecheck --filter=erp`.

---

## Part B — Document representation (execute the amended plan)

Execute `.ai/plans/archived/2026-08-05-accounting-document-representation.md` tasks **in this
order**: 0.1 → 0.2 → 1.1 → 1.2 → 2.1 → 2.2 → 2.3 → 2.4 → 3.1 → 3.2. That plan was
amended 2026-08-05 with every design decision resolved; the invariants at its top are
binding. Condensed per-task guidance (the plan has the full detail):

- **B-0.1 (`core/document-costing.ts`, NEW):** extract Rillet's journal read + AP
  filter into `loadBillCostingLines(db, { companyId, billId, payablesAccountId })`
  returning `{ lines, currencyCode, exchangeRate }` with base-currency debit-signed
  amounts. Item labels via the **pre-verified join** (strip `purchase-invoice:` prefix
  → `purchaseOrderLine.itemId` → item); direct no-PO / variance lines get
  `sourceItem: undefined`. Add `toTransactionCurrencyLines(lines, exchangeRate)`
  (÷ rate, 2dp, rounding residue into the largest-|amount| line; rate 1 = pass-through;
  negative amounts preserved).
- **B-0.2 (Rillet bill):** refactor onto the core; prepend item label to descriptions;
  **fix the FX bug** (transaction-currency amounts + `exchange_rate`); add a
  posted-status `shouldSync` (copy the Rillet invoice syncer's gate). Gate for all of
  Part B: base-currency fixture is byte-identical to before except descriptions; FX
  fixture asserts the new behavior.
- **B-1.1 (QBO bill):** new bill-only builder emitting `AccountBasedExpenseLineDetail`
  from costing lines (mapped account remote id; unmapped → the existing structured
  Warning). Add `CurrencyRef`/`ExchangeRate` to `Qbo.BillSchema` and set from the
  invoice (omit at rate 1). No tax fields. Add posted-status `shouldSync`.
  **Do NOT touch `buildQboExpenseLines` or `purchase-order.ts`** — the PO keeps item
  lines by design. Drop the bill's `ensureDependencySynced("item")` (labels come from
  Carbon, not the QBO item).
- **B-2.1 (Xero item — do before 2.2/2.3):** `IsTrackedAsInventory: false` on create;
  **omit the field on update**; if the remote item is still tracked, land a Warning
  telling the operator to untrack manually. `mapToLocal` keeps reading the remote flag.
- **B-2.2 (Xero bill):** replay lines with mapped `AccountCode`, `TaxType: "NONE"` on
  every line (drop the old INPUT/`TaxAmount` — replay amounts embed tax), transaction
  currency + pinned `CurrencyRate`, `ItemCode` only for known-non-tracked items. Add
  posted-status `shouldSync` + a pre-flight Warning (no line rewrite) when the local
  document is `Paid`/`Partially Paid` (Xero rejects edits to invoices with payments).
- **B-2.3 (Xero invoice):** `AccountCode` = the item's mapped **sales** account (the
  same resolution that feeds QBO `IncomeAccountRef` / Rillet product `account_code`) —
  NOT the journal line, NOT `defaultSalesAccountCode`. Tax handling unchanged.
- **B-3.1:** update `.claude/rules/accounting-sync-handlers.md` with the
  representation model (bills = tax-neutral journal replay to GR-IR in transaction
  currency; invoices = item-referenced to the item's revenue account; items =
  non-tracked; PO/SO untouched; `core/document-costing.ts`).
- **B-3.2:** full sweep — both `@carbon/ee` gates, `pnpm exec turbo run typecheck
  --filter=erp`, `pnpm run lint`, and `pnpm run generate:types` must produce **no
  diff** (this work has no schema change; a diff means you did something wrong).
- **ENV-GATED (skip + log):** the plan's VERIFY gates 2–5 (Xero tracked-flip rejection
  shape, Xero `AccountCode`+`NONE` GR-IR clearing, QBO clearing-account posting, QBO
  negative bill-line `Amount`) and all sandbox acceptance runs. For the negative-line
  gate specifically: keep negative lines flowing through the builders and note in the
  run log that the QBO sandbox check is pending; do NOT preemptively implement
  per-account netting.

## Final report (end of run)

In `.ai/runs/2026-08-05-accounting-handoff-run.md`, finish with: task-by-task status
table; final gate outputs (test counts vs the 456 baseline); the list of ENV-GATED
skips; any STOP-and-report mismatches. Do not commit anything.
