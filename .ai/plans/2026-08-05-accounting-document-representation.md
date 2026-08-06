# Plan: Accounting Document Representation — Journal-Replay Bills, Item-Referenced Invoices, Non-Tracked Items

> Spec: [.ai/specs/2026-08-05-accounting-document-representation.md](../specs/2026-08-05-accounting-document-representation.md)
> Date: 2026-08-05
> Status: not started (2026-08-05 review amendments folded in — see the spec changelog)

## Goal

Make every AR/AP **document** Carbon pushes to a provider post to exactly the accounts Carbon's
posting journal for that document computed. Concretely: **AP bills = account-costed replay of
the Purchase Invoice journal (to GR-IR), item as a label**; **AR invoices = item-referenced to
the item's revenue account**; **provider items = Non-Inventory/non-tracked**. Rillet already
does both halves — generalize its bill costing into a shared core and bring QBO + Xero in line.

**No schema change.** Reuses the posted journal (`journal`/`journalLine`/`journalLineDimension`,
`documentLineReference`), `accountDefault.payablesAccount`, the account + item
`externalIntegrationMapping`, and the existing item syncers.

## Design invariants (from the spec — do not drift)

1. A provider document reproduces its Carbon posting journal → document GL ≡ Carbon journal.
2. **AP bills** post to the journal's accounts (GR-IR/PPV/tax), never the item's account. Item
   is a description label (+ Xero `ItemCode` only when the item is non-tracked).
3. **AR invoices** post to the item's revenue account (item-referenced). COGS stays with the
   pushed `Sales Shipment` journal.
4. **Provider items are non-tracked** so the provider never posts inventory (bills) or COGS
   (invoices).
5. **Non-posting docs (PO, SO, Quote) are unchanged** — item-referenced, no GL constraint.
6. Rillet is the reference; QBO/Xero copy it. Rillet AR/AP GL must be **unchanged** after the
   refactor for base-currency bills (parity test); FX bills change deliberately (bug fix, see
   invariant 7).
7. **FX bills replay in transaction currency** (base ÷ `exchangeRate`, 2dp, residue balanced
   into the largest-|amount| line) with the provider rate pinned (Xero `CurrencyRate`, QBO
   `ExchangeRate` + `CurrencyRef`, Rillet `exchange_rate`). Base-currency bills byte-identical.
8. **Replay lines are tax-neutral** (Xero `TaxType: "NONE"`, QBO no `TxnTaxDetail`, Rillet no
   `tax_rate`) — Carbon's purchase posting folds tax into cost; no tax journal line exists.
9. **Bills sync only when posted** — every bill syncer gets a `shouldSync` mirroring the
   invoice syncers' `SYNCABLE_STATUSES` (Draft excluded).

## Reference implementation

`providers/rillet/entities/bill.ts` — `mapBillToRilletBill` (account-costed items from the
journal), `fetchPostingJournalLines` (reads the posted `Purchase Invoice` journal), and
`filterBillCostingLines` (drops the AP control line). This is the model to extract.

`providers/quickbooks-online/entities/item.ts` — the Non-Inventory precedent (`Type: Service |
NonInventory`, never Inventory) that Xero items must match.

---

## Phase 0 — Shared bill-costing core

### Task 0.1 — Extract `core/document-costing.ts`
- **New file** `packages/ee/src/accounting/core/document-costing.ts`.
- Move Rillet's journal read + AP-control filter here:
  `loadBillCostingLines(db, { companyId, billId, payablesAccountId }) → { lines: CostingLine[], currencyCode, exchangeRate }`,
  where `CostingLine = { id, accountId, amount /*base-currency, debit-signed*/, description, sourceItem?: { id, code, name }, dimensions? }`.
- **Item-label enrichment (join RESOLVED by review — do not re-derive):**
  `journalLine.documentLineReference` holds the **prefixed string**
  `purchase-invoice:<purchaseOrderLineId>` (stamped by `post-purchase-invoice` via
  `journalReference.to.purchaseInvoice` in `functions/lib/utils.ts`) and is **NULL for direct
  no-PO invoice lines**. Join: strip the `purchase-invoice:` prefix → `purchaseOrderLine.id`
  → `purchaseOrderLine.itemId` → `item.readableId`/name. Direct no-PO lines and
  variance/rounding lines resolve to `sourceItem: undefined` (description falls back to the
  journal line description).
- **Currency helper:** `toTransactionCurrencyLines(lines, exchangeRate) → CostingLine[]` —
  divide by `exchangeRate`, round 2dp, add the rounding residue to the largest-|amount| line
  so the lines sum exactly to the invoice's transaction-currency total. `exchangeRate === 1`
  is a pass-through.
- Keep `toDebitSignedAmount` usage (from `core/posting.ts`) identical to Rillet's current sign
  handling.
- **Verify:** `pnpm exec turbo run typecheck --filter=@carbon/ee`; unit tests over a fixture
  journal → `CostingLine[]` (AP control excluded, PO-backed lines carry `sourceItem`,
  direct/variance lines don't) + `toTransactionCurrencyLines` (residue balancing, rate-1
  pass-through, negative lines preserved).

### Task 0.2 — Refactor Rillet bill onto the core (GL parity + FX bug fix)
- `providers/rillet/entities/bill.ts`: replace `fetchPostingJournalLines`/`filterBillCostingLines`
  with `loadBillCostingLines`; in `mapBillToRilletBill`, prepend the item code/name to each
  line's `description` when `sourceItem` is present.
- **FX fix (deliberate behavior change):** today the mapper pushes base-currency journal
  amounts labeled with the transaction currency and omits `exchange_rate`. Use
  `toTransactionCurrencyLines` and set `exchange_rate` on the bill payload
  (`Rillet.BillSchema` already allows it).
- **Posted-status gate:** add `shouldSync` (mirror the Rillet invoice syncer's
  `SYNCABLE_STATUSES`) so unposted bills are skipped instead of landing `UNMAPPED_ACCOUNTS`
  warnings.
- **Verify (gate for the plan):** behavior-parity test — a **base-currency** fixture bill
  produces the same Rillet `items[]` (`account_code`, `amount`, `fields`) as before, with only
  `description` enriched. An **FX** fixture asserts the new correct behavior:
  transaction-currency amounts + `exchange_rate`. Existing Rillet bill tests stay green.
  `pnpm --filter @carbon/ee test`.

---

## Phase 1 — QBO bills (account-costed; PO unchanged)

### Task 1.1 — QBO bill → account-based journal replay
- `providers/quickbooks-online/entities/bill.ts`: build lines from `loadBillCostingLines` as
  **`AccountBasedExpenseLineDetail`** — `{ DetailType: "AccountBasedExpenseLineDetail",
  Amount, Description: <item label ?? journal desc>, AccountBasedExpenseLineDetail: { AccountRef:
  { value: <mapped GR-IR/PPV account remote id> } } }`. Resolve the account remote id through
  the same account-mapping the QBO journal-entry syncer uses; unmapped → the existing structured
  Warning.
- **Currency:** amounts via `toTransactionCurrencyLines`; add `CurrencyRef` + `ExchangeRate`
  to `Qbo.BillSchema` (`models.ts` — today the Bill payload has neither) and set them from the
  invoice (omit at rate 1, matching Xero's convention).
- **Tax:** none — no `TxnTaxDetail`, no per-line tax (replay amounts embed tax; invariant 8).
- **Posted-status gate:** add `shouldSync` mirroring the QBO invoice syncer's
  `SYNCABLE_STATUSES` (bills currently have none — a Draft bill has no journal to replay).
- **Do NOT change** the shared `buildQboExpenseLines` in `entities/shared.ts` — the **PurchaseOrder**
  keeps using it (PO is non-posting, stays item-referenced, §5). Add a new bill-specific builder
  (or a `costingLines`-based path) so only the bill changes.
- Drop `ensureDependencySynced("item")` on the bill if items are no longer referenced there
  (keep it only if the item label needs the item row — it doesn't; the label comes from Carbon).
- **Verify:** unit test — a mixed item + G/L-account bill → all account-based lines to the
  journal accounts, item name in `Description`, no `ItemBasedExpenseLineDetail`, no tax
  fields; an FX fixture carries `CurrencyRef`/`ExchangeRate` + transaction-currency amounts; a
  negative (credit-PPV) line survives the builder. Typecheck + tests.

### Task 1.2 — QBO acceptance note
- Confirm QBO PO test coverage still green (unchanged). Sandbox receive→bill (env-gated,
  recommended not required): GR-IR nets to zero, no COGS double-post.

---

## Phase 2 — Xero bills + invoices + non-tracked items

### Task 2.1 — Xero items non-tracked (do FIRST — makes 2.2/2.3 safe)
- `providers/xero/entities/item.ts`: on outbound **create**, set `IsTrackedAsInventory: false`
  (drop the `itemTrackingType !== "None"` derivation for the pushed value; the inbound
  `mapToLocal` can keep reading the remote flag).
- **Update fallback (resolved by review — Xero rejects untracking items with
  transactions/stock):** on **update**, omit `IsTrackedAsInventory`; if the remote item is
  still tracked, land a `Warning` instructing manual untracking (zero the stock, untrack in
  Xero, retry). Bill lines attach `ItemCode` only when the item is known non-tracked.
- **Verify:** unit tests — create maps `IsTrackedAsInventory: false`; update omits the field;
  tracked-remote → Warning. **VERIFY (sandbox):** confirm Xero's rejection shape for the
  tracked→non-tracked flip so the Warning text matches reality.

### Task 2.2 — Xero bill → account-costed
- `providers/xero/entities/bill.ts`: build `LineItem`s from `loadBillCostingLines` —
  `{ Description: <item label ?? desc>, LineAmount: <transaction-currency via
  toTransactionCurrencyLines>, AccountCode: <mapped account code>, TaxType: "NONE",
  ItemCode?: <item code, only when the item is known non-tracked> }`. Stop using
  `defaultPurchaseAccountCode` for item lines; source the account from the journal. Select the
  account mapping instead of the blunt default.
- **Tax (invariant 8):** replay lines are tax-neutral — do NOT carry the old
  `TaxType: "INPUT"` / `TaxAmount` (the provider tax engine would double-tax tax-inclusive
  replay amounts). Keep `CurrencyCode`; pin `CurrencyRate = exchangeRate` on FX bills.
- **Posted-status gate + paid-doc guard:** add `shouldSync` (Draft bills currently map to
  Xero `DRAFT` — they stop syncing entirely); if the local document is `Paid`/`Partially
  Paid`, land a `Warning` instead of pushing a line rewrite (Xero rejects edits to invoices
  with payments).
- **Verify:** unit test — bill lines carry the GR-IR/PPV account codes (not the default),
  `TaxType: "NONE"` on every line, item label present, `ItemCode` only for known-non-tracked
  items, FX fixture pins `CurrencyRate`, negative line passes through, Draft skipped, paid-doc
  Warning. Typecheck + tests.

### Task 2.3 — Xero invoice → item's revenue account
- `providers/xero/entities/invoice.ts`: set `AccountCode` = the item's mapped **revenue**
  account, not `defaultSalesAccountCode`; keep `ItemCode`. **Source DECIDED (review):** the
  item's mapped sales account (`accountDefault.salesAccount` / item's posting group) — the
  same resolution that feeds Rillet's product `account_code` and QBO's `IncomeAccountRef`;
  NOT the journal line (customer-group posting divergence is inherent to item-referenced AR
  and caught by tie-out). Tax handling unchanged (`OUTPUT` + `LineAmountTypes: "Exclusive"`).
- **Verify:** unit test — invoice line `AccountCode` = the item's revenue account; COGS not on
  the invoice; tax fields unchanged vs today. Typecheck + tests.

### Task 2.4 — Xero acceptance note
- Sandbox (recommended): receive→bill → GR-IR nets to zero; ship→invoice → Dr AR / Cr Revenue,
  COGS only from the shipment journal.

---

## Phase 3 — Docs + acceptance sweep

### Task 3.1 — Rule + spec sync
- Update `.claude/rules/accounting-sync-handlers.md`: document the representation model (bills =
  journal replay to GR-IR; invoices = item-referenced to revenue; items = non-tracked; POs/SOs
  item-referenced). Note `core/document-costing.ts`.
- If user-facing, add a docs note (provider items are non-inventory; per-SKU valuation is in
  Carbon).

### Task 3.2 — Full acceptance sweep
- `pnpm exec turbo run typecheck --filter=@carbon/ee`, `pnpm --filter @carbon/ee test`,
  `pnpm exec turbo run typecheck --filter=erp` (no ERP change expected), `pnpm run lint`.
- Confirm no migration/type diff (`pnpm run generate:types` → empty).
- Spec acceptance criteria across the three sandboxes (env-gated): GR-IR nets to zero per
  provider, no double-count, item visible, AR posts to revenue, Xero items non-tracked, v3
  tie-out clean on Inventory/GR-IR/COGS/AP/AR/Revenue.

---

## Task → file quick index

| Task | Primary files |
|---|---|
| 0.1 | `packages/ee/src/accounting/core/document-costing.ts` (NEW) |
| 0.2 | `providers/rillet/entities/bill.ts` |
| 1.1 | `providers/quickbooks-online/entities/bill.ts` (+ leave `entities/shared.ts` `buildQboExpenseLines` for PO) |
| 2.1 | `providers/xero/entities/item.ts` |
| 2.2 | `providers/xero/entities/bill.ts` |
| 2.3 | `providers/xero/entities/invoice.ts` |
| 3.1 | `.claude/rules/accounting-sync-handlers.md` |
| shared | `core/posting.ts` (`toDebitSignedAmount`, account mapping), the account/item `externalIntegrationMapping` |

## Open VERIFY gates (carry into implementation)

1. ~~`documentLineReference` link~~ **RESOLVED (2026-08-05 review):** the column carries the
   prefixed string `purchase-invoice:<purchaseOrderLineId>` and is NULL for direct no-PO
   lines — join via `purchaseOrderLine`; no label for direct lines (Task 0.1).
2. Xero's exact rejection behavior for flipping a tracked item with history (Task 2.1) —
   sandbox; the create-only / omit-on-update + Warning rule ships regardless.
3. Xero ACCPAY invoice honors `AccountCode` + `TaxType: "NONE"` on a line with `ItemCode` for
   non-tracked items → GR-IR clears, no tax added on top (Task 2.2) — sandbox.
4. QBO account-based bill line to a clearing account posts correctly and GR-IR nets to zero
   (Task 1.1) — sandbox.
5. **QBO accepts a negative `Amount` on an `AccountBasedExpenseLineDetail` bill line** (credit
   PPV lines) — sandbox; if rejected, net lines per account in the builder (Xero accepts
   negative `LineAmount`).

## Risks

| Risk | Mitigation |
|---|---|
| QBO/Xero bill GL change regresses live sync | Faithful replay of Carbon's own journal (correct by construction); parity test on Rillet; sandbox GR-IR-nets-to-zero acceptance |
| FX bills misstated (base amounts under a foreign currency code) | Invariant 7: transaction-currency conversion + pinned provider rate; FX fixtures per provider |
| Provider tax engine double-taxes replayed amounts | Invariant 8: tax-neutral lines (`NONE`); documented that provider tax reports exclude Carbon bills |
| Draft-bill sync becomes Warning noise under replay | Invariant 9: posted-status `shouldSync` on all bill syncers |
| Xero non-tracked flip rejected for items with history | Create-only + omit-on-update + Warning (Task 2.1); VERIFY gate 2 confirms the rejection shape |
| Negative (credit) costing lines rejected by QBO | VERIFY gate 5; fallback: net per account in the builder |
| Re-push to an already-paid Xero invoice rejected | Paid-doc pre-flight Warning (Task 2.2); forward-only, documented |
| Item-label mis-join on aggregated/variance journal lines | Only `documentLineReference`-linked lines get a label; others `sourceItem: undefined`; direct no-PO lines have no reference at all (v1 limit) |
| Shared `buildQboExpenseLines` change leaks into PO | Bill uses a new costing builder; PO keeps the existing shared function untouched |
| Provider GL behavior inferred, not observed | VERIFY gates 2–5 resolved on sandboxes before production reliance |
