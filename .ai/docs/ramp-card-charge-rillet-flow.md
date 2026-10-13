# Ramp credit-card charge → Carbon → Rillet

How a Ramp credit-card charge flows through Carbon into Rillet when the Rillet accounting
integration is active, and exactly what ends up in Rillet. Grounded in
`packages/jobs/.../ramp-sync*.ts`, `packages/ee/src/ramp/**`, and `packages/ee/src/accounting/**`
(the `charge` entity, `providers/rillet/entities/charge.ts`, `core/posting.ts`).

---

## Q: If there is a credit card charge in Ramp, and the Rillet integration is active, how does it flow through Carbon to Rillet, and what is left in Rillet?

Here's the full path a Ramp credit-card charge takes, and exactly what ends up in Rillet.

### 1. Ramp → Carbon (inbound `ramp-sync`, `ramp-charges` step)

A cardholder codes the charge in Ramp (GL account + optionally a cost center) and marks it
ready. The hourly sweep/webhook fires `ramp-sync`, which pulls transactions with
`sync_status = SYNC_READY` and, per charge:

- reads the amount from `entity_amount.value` (signed integer minor units),
- resolves the Ramp merchant → a Carbon **supplier** (`resolveMerchantSupplier`: mapping by
  `merchant_id` → name → auto-create tagged "Card Merchant"),
- reads the coding off `line_items[].accounting_field_selections` (`codeSelections`): GL
  account (`account.id`) + cost center (`carbon-cost-center` option),
- atomically stages a **Draft `charge`** (type `Charge`) + coded lines + the Ramp
  mapping, then posts it via the `post-charge` edge function.

### 2. Carbon posts the GL journal

`post-charge` books: **debit each coded line's account, credit the card-liability
account** (the one configured on the Ramp integration), in base currency. The row becomes a
Posted `Charge` with a `supplierId` and a `journalId`.

### 3. Carbon → Rillet (as a native **charge**, not a journal entry)

Because it's a Posted `Charge` with a supplier and the `charge` entity is enabled, the
posting policy (`isDocBackedCharge` → `posting.ts:157`) marks the charge
journal **`DOC_BACKED`** — so the journal is **not** pushed as a journal entry. Instead
`RilletChargeSyncer` pushes Rillet's native object via `POST /charges`
(`providers/rillet/entities/charge.ts`), JIT-syncing the merchant as a Rillet vendor first.
The payload:

- `vendor_id` (the merchant vendor),
- `items[]` — one per coded line: `account_code` + amount + `fields[]` (the auto-provisioned
  Cost Center field/value),
- `charge_date` = transaction date, `impact_date` = posting date,
- `credit_card_account_code` = the card-liability account,
- `external_references` (back to the Carbon transaction).

Rillet derives the posting itself from that: **debit each item's account, credit the
credit-card account.**

### What is left in Rillet

Exactly **one charge object** — coded to the expense account(s) + cost-center field, against
the merchant vendor, dated, with the Carbon external reference, and (Rillet only) the
**receipt uploaded** best-effort. Its GL effect is debit expense / credit the credit-card
liability. **No separate journal entry** — the journal is DOC_BACKED-excluded, so the spend is
represented once, never as charge *and* journal (that double-count was a real bug, fixed
2026-09-10).

### Two preconditions that decide success (both surfaced, not guessed)

- Every account on the charge must be **mapped in Rillet** (Account Mapping → "Match by
  code"), else it parks as Warning `UNMAPPED_ACCOUNTS` naming the ids.
- The Carbon account you chose as Ramp's card liability must map to a Rillet account of
  **subtype "Credit Card"** — otherwise Rillet returns `400 "Account <code> is not a credit
  card account"` (recorded Failed; remap and Retry).

### Related flows (so the ledger closes)

- **Refund** (`Credit`) — Rillet is in `CHARGE_CREDIT_PROVIDERS`, so it posts as a charge with
  **negative items** (not a journal).
- **Statement payment / cashback / repayment** — these are card-liability↔bank movements with
  **no vendor**, so they stay **journal entries** (posting sync is always-on): the statement
  payment shows in Rillet as a JE that debits the credit-card account and credits the bank,
  paying down the liability the charge created.
- **Void** — voiding the Carbon charge issues `DELETE /charges/{id}` in Rillet
  (tombstoned only after Rillet confirms).

Net: in Rillet you get the coded credit-card **charge** (with vendor, cost center, receipt)
plus, later, a **journal entry** for the statement payment — and never a duplicate JE for the
charge itself.

---

## Q: Consider us paying for Ubers or buying lunch.

Take a cardholder grabbing an Uber and expensing lunch — two card charges. Here's how each
lands, and what's notable about this T&E case specifically.

### The flow (per charge)

1. **In Ramp:** the cardholder codes it — Uber → *Travel*, lunch → *Meals & Entertainment* —
   maybe tags a cost center (their team/project), attaches the receipt (Uber e-receipts
   auto-attach; lunch is a photo), and it goes `SYNC_READY`.
2. **Ramp → Carbon:** `ramp-sync` pulls it, resolves the **merchant → a Carbon supplier**
   ("Uber", "Sweetgreen" — auto-created, tagged *Card Merchant*), reads the coded expense
   account + cost center, and posts a `charge` (`Charge`): **debit Travel/Meals,
   credit the card-liability account**.
3. **Carbon → Rillet:** it's a Posted `Charge` with a supplier, so it pushes as a Rillet
   **charge** (not a journal): `vendor_id` = Uber/Sweetgreen, one `item` coded to the
   Travel/Meals `account_code` (+ the cost-center field), `charge_date`,
   `credit_card_account_code`, external ref, and the **receipt uploaded**.

### What's left in Rillet

For each: **one charge** — vendor Uber (or the restaurant), coded to Travel / Meals &
Entertainment (+ cost center), receipt attached, posting debit expense / credit the
credit-card account. No duplicate journal entry. At statement time, the payment is a separate
**journal entry** paying down the credit-card liability.

### What is different / worth knowing about T&E specifically

- **This is the clean, "expected" case** — unlike part receipts (which hit inventory/GR-IR
  asset/liability accounts), Uber/lunch code to real **expense** accounts, so they show up as
  normal, visible coding in both Ramp and Rillet.
- **It must be coded in Ramp.** Coding lives in Ramp, not Carbon. An Uber/lunch charge marked
  ready with **no account** can't build a valid Carbon `Charge` (lines must carry accounts
  summing to the total) → it fails as *uncoded* and won't sync until someone codes it. Same if
  it's coded to an account that doesn't exist / isn't synced in Carbon.
- **Merchant-as-vendor proliferation.** Every distinct merchant becomes a *Card Merchant*
  supplier in Carbon and a **vendor in Rillet**. Recurring "Uber" collapses to one vendor
  (matched by `merchant_id`), which is nice for spend-by-vendor. But lunch at 40 different
  restaurants → 40 one-off vendors in Rillet. That's inherent to representing charges as
  vendor-coded charges (it's how Ramp/Rillet model card spend), just something to expect on
  your vendor list.
- **No tax split.** The charge is the gross total coded to the one expense account (sales tax
  on lunch just rides into Meals); there's no tax line like a vendor bill has.
- **Refund** (Uber cancels a ride, restaurant reverses) → a `Credit`, which Rillet posts as a
  charge with a **negative item**. A **void** deletes the Rillet charge.

So: Uber and lunch each leave a single coded, receipt-bearing **charge** in Rillet against the
merchant vendor — and the monthly card payment shows as one journal entry, not per-charge.
