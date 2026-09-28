# Ramp outbound draft-bill push — enabled + live-verified

**Date:** 2026-09-11
**Branch:** feat/feat-ramp (worktree brisbane)
**Sandbox:** `demo-api.ramp.com`, client_credentials app `ramp_id_nzJ0…` (the local
`Carbon Development` company's stored Ramp connection; `metadata.credentials.environment
= "sandbox"`, secret resolved from Vault). Scopes were granted 2026-08-28, so the
`bills:write` / `vendors:read` / `accounting:read` calls below all succeed.

## What changed

Removed the `RAMP_DRAFT_BILL_CONTRACT_VERIFIED` release gate and shipped the outbound
Carbon→Ramp bill push as **draft-only** (per Brad's decision: "draft only, never submit
… get rid of [the gate] once we verify").

- `pushInvoiceDraftBill` (`packages/ee/src/ramp/lib/spend.ts`) creates a coded DRAFT bill
  and links `("bill", invoice.id, "ramp", <draft id>)`. It does **not** submit.
- **Accounts come from the POSTED journal, not the invoice line.** `pushInvoiceDraftBill`
  reads the invoice's posted "Purchase Invoice" journal via `loadBillCostingLines` +
  `toTransactionCurrencyLines` — the same authoritative path QBO/Xero/Rillet bill syncers
  use. `purchaseInvoiceLine.accountId` is null for item/part lines (posting resolves
  inventory / GR-IR / variance / tax accounts), so reading the line would leave item bills
  uncoded. The costing line's `accountId` IS the `account.id` pushed to Ramp — no
  translation. Cost center is the journal-line dimension whose `valueId` is a pushed
  `costCenter.id`.
- Per-line coding via `buildLineCodingSelections` (`lib/coding.ts`): GL account →
  `{ field_external_id: "Category", field_option_external_id: account.id }`; cost center →
  `{ field_external_id: "carbon-cost-center", field_option_external_id: costCenter.id }`.
  A line coded to an account/cost-center Carbon has NOT pushed degrades to uncoded
  (never 422s the whole bill). If the invoice has no posted journal (accounting was
  disabled at post time), `loadBillCostingLines` throws `UNMAPPED_ACCOUNTS` → that
  invoice's push fails and its cursor is retained for retry.
- `remote_id: invoice.id` is the echo guard AND bill-match key (the inbound `ramp-bills`
  step dedupes on it). **Do NOT send `enable_accounting_sync: false`** — Ramp 422s
  "enable_accounting_sync cannot be False if remote_id is provided" (caught by the live
  `/test` on 2026-09-11; unit tests mocking the client never would have). A draft isn't in
  Ramp's `/bills` feed, so it can't echo before submission anyway.
- The outbound job loads the pushed account/cost-center id sets from
  `externalIntegrationMapping` (entityType `account` / `costCenter`) and hands `ctx.db`
  (Kysely) to `pushInvoiceDraftBill`, which reads the posted journal itself. The old
  `loadRampPurchaseInvoiceLines` reader was removed (it read the wrong, item-null
  `purchaseInvoiceLine.accountId`).
- Removed archive-on-settlement for bills (drafts are undeletable — see below) and the
  now-dead `archiveRampBillForInvoice`. PO push + PO archive are untouched.

## Live sandbox verification (the contract)

Resolved from the OpenAPI spec (`docs.ramp.com/openapi/developer-api.json`) AND exercised
live:

1. **Create coded draft — 201.** `POST /bills/drafts` with
   `line_items[].accounting_field_selections: [{ field_external_id, field_option_external_id }]`.
   Read-back (`GET /bills/drafts/{id}`) confirmed the line coded to account
   `acct_7Dar1tc6okPYA4EahHMezh` → "Travel & Entertainment" (code 6090), and (2nd probe) a
   cost-center selection coded to `dag0l963i0gg2a8f2vog` → "G&A".
2. **GL field id = `"Category"`.** Ramp's native GL-account field is NOT returned by
   `GET /accounting/fields` (which lists only the custom `carbon-cost-center` field); its
   `field_external_id` is `"Category"`, discovered from a real coded transaction's
   `category_info` and confirmed by the draft read-back.
3. **Amount is decimal major-units.** Sent `amount: 12.34`; Ramp stored `1234` minor units
   (`minor_unit_conversion_rate: 100`). The job already sends document-currency decimals.
4. **PDF is not a body field.** `document_urls` in the create body is ignored; attachments
   go through a separate `POST /bills/drafts/{id}/attachments` (deferred follow-up).
5. **Submit is NOT used.** `POST /bills/drafts/{id}/submit` 400s `BILL_PAY_7145 — "bill due
   date, bill issued date, payment method, payee contact"`. Payment method + payee contact
   are per-vendor Ramp bill-pay config Carbon does not own, so Carbon hands off a draft and
   the customer completes/pays it in Ramp.
6. **Drafts are undeletable.** `DELETE /bills/drafts/{id}` → 405; `DELETE /bills/{id}` on a
   draft id → 404. So there is no archive-on-settlement for a pushed draft; once handed off,
   Ramp owns the bill lifecycle.

Sandbox residue: a few throwaway DRAFT provisional bills (`d373921f…`, `e1e7ae26…`,
`d1c7c5c8…`) created during verification could not be deleted (drafts have no delete
endpoint). They are DRAFTs, not bills, so they do not surface in `GET /bills` or the inbound
sync. Harmless. The last one (`d1c7c5c8…`, `remote_id = pi_TaGAKyVaYgmTT3d97LoEhL`,
invoice_number `AP000003-e2e2`) is the end-to-end proof: coded from a REAL posted Carbon
invoice's journal account (6090 Travel & Entertainment) and read back correctly coded.

## End-to-end verification (2026-09-11, `/test`)

The browser reliably created a purchase-invoice header for a non-Employee supplier
(AstroMill Machining), but the line-item + posting UI flow was too fragile to drive
headlessly (combobox commit + tab churn), so the push itself was proven against a REAL
posted invoice: `loadBillCostingLines` for `AP000003` (`pi_TaGAKyVaYgmTT3d97LoEhL`) returns
exactly one costing line — account `acct_7Dar1tc6okPYA4EahHMezh` (6090 Travel &
Entertainment, $863.57), AP control (2010) excluded — and that account is pushed to Ramp.
Pushing it to the sandbox (`remote_id` only) returned 201 and read back coded
`Category → Travel & Entertainment (6090)` at $863.57. This is the account-source rework
verified against live Ramp with real Carbon posted-journal data.

### Parts (item-line invoices) — verified

A part invoice line carries a NULL `accountId`; posting resolves the real account, which the
rework reads from the journal:
- AP000001 (no-PO part) posts the part to **1210 Raw Materials (Asset)**.
- AP000389 (PO-backed part) posts to **2125 GR/IR Clearing (Liability)**.

`codingAccountScope` was REMOVED and the default is now effectively "all". Key finding: that
scope only ever controlled a Ramp-side `visibility` flag — **every account is pushed to Ramp
regardless** (all 81 here), and Ramp **accepts coding a bill to a HIDDEN account**. Verified
live: a draft coded to 1210 Raw Materials (which the old "expense" scope hid) returned 201 and
read back `Raw Materials (1210)`. So parts code correctly under any scope; making all accounts
VISIBLE (the new default) just means the human reviewing the draft in Ramp sees the coded
account as a normal picker option instead of a hidden one.

### Candidate-query fixes (#2, so posted part bills actually push)

The real job exposed two candidate-selection bugs, now fixed and unit-tested (a live job run
to observe them needs the Inngest worker to reload the new code):
- **Overdue** view status added to `INVOICE_PUSH_STATUSES` (a posted-unpaid invoice past its
  due date reports `Overdue`, and was silently excluded).
- The invoice push now pages on **`createdAt`** (not `updatedAt`): `purchaseInvoice.updatedAt`
  is null until an app-level edit (posting never sets it), so the updatedAt keyset made every
  posted invoice invisible; and the first-run cursor no longer floors at the integration's own
  `updatedAt` (which excluded all pre-existing open payables). The push is create-once
  (mapping-guarded), so `createdAt` is a sufficient page key.

## Validation

- `pnpm --filter @carbon/ee test` — 1163 passed (incl. new `coding` + `draft-bill-push`).
- `pnpm --filter @carbon/jobs test` (ramp-sync-outbound) — 694 passed.
- `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs` — clean.
- Biome — clean (pre-existing `console.error` warnings only).
