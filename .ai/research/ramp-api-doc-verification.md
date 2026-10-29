# Ramp API field-shape verification (Task 1) — resolved from the OpenAPI spec

**Date:** 2026-08-28
**Source of truth:** `https://docs.ramp.com/openapi/developer-api.json` (downloaded, 2.2 MB,
parsed directly — NOT a single-pass doc read). Every claim below is grounded in a named
schema in that file.
**Why now:** originally the live sandbox was blocked (no scopes); the OpenAPI contract resolved
the shapes. **UPDATE 2026-08-28: Brad granted the scopes and everything below was then RE-CONFIRMED
LIVE** — see the LIVE-VERIFIED section immediately below.

## ★ LIVE-VERIFIED (2026-08-28, scopes granted) ★
Re-confirmed against the live sandbox (demo-api.ramp.com), not just the spec:
- **Amount**: real txn `amount: 431.68` (deprecated dollar float) vs `entity_amount:{value:43168}`
  (cents). The `entity_amount` fix is correct — the old code posted 1/100th.
- **Coding**: `line_items[].accounting_field_selections[].category_info.type == "GL_ACCOUNT"` with
  `external_id` = the Carbon account.id. The `category_info.type` fix is correct. The coding is on
  `line_items[]` (mirrored in `accounting_categories`), NOT top-level `accounting_field_selections`
  ([]). The list endpoint DOES return `line_items`.
- **Install/converge live**: connection "linked" (remote_provider_name "Carbon"), 79-account CoA
  pushed with correct `classification` (CREDCARD/EXPENSE/…), cost-center field created.
- **Pull live**: 5 transfers → Payment cardTransactions; a coded USD charge → Charge cardTransaction
  ($350 → Advertising), posted + balanced + Ramp-mapped.
- **3 MORE real bugs** found via live testing (all fixed + PROVEN):
  1. `pushChartOfAccounts` (service.ts) — SAME `.eq("companyId")`-on-`account` bug → 0 accounts
     pushed. Fixed via companyGroupId (79 pushed after fix).
  2. `ramp-sync.ts buildTransactionLines` account verification — SAME bug → every coded charge
     failed. Fixed via companyGroupId.
  3. `getJobDatabaseClient` (jobs/db.ts) POOL POISONING: the accounting sweeps `pool.end()` the
     shared cached size-5 pool; the client cache kept a Kysely over the dead pool → every later
     ramp-sync threw "Cannot use a pool after calling end on the pool". Fixed to rebuild on `ending`.
- **Foreign-currency charge edge case** (documented, NOT fixed): a txn whose merchant currency ≠
  settlement currency has its single `line_item.amount` in MERCHANT currency while the header uses
  settlement `entity_amount` → the post-card-transaction line-sum check rejects it. USD-only posts
  fine.

## Credential / scope provisioning (was the standing blocker — RESOLVED)
- Sandbox host `demo-api.ramp.com` is correct. Token mint works and returns a 10-day token; the
  token endpoint does not validate scope grants at mint — the resource call is the real gate (403
  `DEVELOPER_7100` when a scope is ungranted). Scopes are a Ramp-side dashboard config; **Brad
  granted them 2026-08-28**, which unblocked everything above. `demo.ramp.com` (the product demo UI)
  does not expose developer-API/scope management — that is a separate developer surface.

## FIXED in this pass (inbound path — applied to the working tree, uncommitted)

### 1. Transaction `amount` is a DEPRECATED dollar float, not minor-unit cents — CRITICAL
- **Spec:** `Transaction.amount` = `type: number`, `deprecated: true`, desc "Deprecated. Use
  `entity_amount`." The replacement `entity_amount` is an `ApiSignedAmount = { currency,
  value:int }` whose `value` is "in the smallest denomination (e.g. cents for USD)" and signed.
- **Code assumed:** `RampTransactionSchema.amount: z.number()` read as minor units; the card
  family did `fromMinorUnits(tx.amount)` (÷100). A $150.00 charge → `fromMinorUnits(150)` =
  $1.50. **Every card transaction posted at 1/100th of its real value.**
- **Fix applied:** `models.ts` adds `RampSignedAmountSchema` + `entity_amount`/`merchant_amount`
  on `RampTransactionSchema`; `ramp-sync.ts` `toMinorUnits` now reads `.value` (ApiSignedAmount)
  and `.amount` (CurrencyAmount); the card family reads `toMinorUnits(tx.entity_amount)` first,
  falling back to the deprecated `amount` only when entity_amount is absent (no settlement
  currency). Currency now prefers `entity_amount.currency`.

### 2. `accounting_field_selections[].type` is at `.category_info.type` — CRITICAL
- **Spec:** `ApiTransactionAccountingFieldSelection` has NO top-level `type`. The type is
  `category_info.type` (`ApiTransactionAccountingCategoryInfo.type`, enum incl. `GL_ACCOUNT`,
  `COST_CENTER`). The selection's own `external_id` is the pushed Carbon option id (account.id).
- **Code assumed:** `codeSelections` read `selection.type` — always undefined → **no line ever
  resolved an account/cost-center; every line failed "uncoded"** in production.
- **Fix applied:** `models.ts` types `category_info` as `RampAccountingCategoryInfoSchema`;
  `codeSelections` reads `selection.category_info?.type ?? selection.type`.

### 3. (Separate, live-PROVEN bug) post-card-transaction account query over-scoped by companyId
- `post-card-transaction/index.ts` filtered `account` by `.eq("companyId", companyId)`, but
  `account` (chart of accounts) is companyGroup-scoped — no `companyId` column, PK is `id`
  alone. Every post/void 500'd "Failed to fetch card transaction accounts". Fixed to filter by
  `id` only (matches post-purchase-invoice / post-memo). **Proven end-to-end:** posted
  je_5ytNrRw89H6GvcjxCAXo1b (balanced), then voided.

## MATCHES confirmed (no change needed)
- `POST /accounting/accounts` body key `gl_accounts` — code sends `{ gl_accounts: batch }` ✓.
- `classification` enum = `ANY/ASSET/CREDCARD/EQUITY/EXPENSE/LIABILITY/REVENUE/UNKNOWN` —
  `rampClassificationForClass` + CREDCARD for the card-liability account ✓.
- `POST /accounting/syncs` body `{ sync_type, idempotency_key, successful_syncs, failed_syncs }`
  — `confirmSyncs` sends exactly these keys ✓.
- `GET /accounting/all-connections` path ✓. `POST /bills/drafts/{id}/submit` ✓.
  `POST /purchase-orders/{id}/archive` ✓ (`archivePurchaseOrder` correct).
- Error envelope `{ error_v2: { message, error_code, error_id, additional_info, notes } }` —
  client parses `error_v2.error_code`/`message` ✓.
- **`POST /bills/drafts` body — CORRECT.** `PartialApiCreateDraftBillParamsRequestBody` DOES
  accept top-level `remote_id`, plus `invoice_number`, `invoice_currency`, `issued_at`,
  `due_at`, `line_items`, `vendor_id`(required). The invoice→Ramp draft-bill push body is fine.
  (Only nit: `document_urls` is not a body field — PDF attaches go via
  `POST /bills/drafts/{id}/attachments`. Already flagged as a placeholder in code; harmless.)

## MISMATCHES to fix (OUTBOUND push — NOT applied; need product decisions + live verify)

### A. `POST /purchase-orders` body is broken (`pushPurchaseOrder`, service.ts ~820)
`ApiPurchaseOrderCreateParamsRequestBody`: required `[currency, entity_id, line_items,
three_way_match_enabled]`; matching id field is **`external_id`**, not `remote_id`.
- Code sends `remote_id: po.id` → ignored → **Ramp bill↔PO matching silently never works.**
  Change to `external_id: po.id`.
- Code OMITS required `currency` and `three_way_match_enabled` → **POST 400s.** Add both
  (`three_way_match_enabled` default is a product decision — likely `false`).
- `entity_id` is required but sent conditionally → 400 for single-entity companies. Decide a
  default entity.
- Line items: code sends `{ description, quantity, unit_price, remote_id }`; create params use
  `external_id` (not `remote_id`) and `unit_quantity` (not `quantity`) per the create schema.
=> The PO-push feature is currently non-functional end to end. Fix + sandbox-verify together.

### B. `archiveBill` targets a nonexistent endpoint (client.ts ~413, used service.ts ~939)
`POST /bills/{id}/archive` does NOT exist. Bills expose `DELETE /bills/{id}`, `POST /hold`,
`POST /release` (only purchase-orders have `/archive`). The archive-on-settlement step for a
pushed draft bill **404s**. Recommend `DELETE /developer/v1/bills/{id}` (withdraw the pending
bill). Confirm Ramp's intended "retract a submitted-but-unpaid bill" verb against sandbox.

## Other inbound shapes confirmed (schemas exist; values want a live pass)
- **Bills:** `GET /bills` has BOTH `sync_status` (enum: `BILL_AND_PAYMENT_SYNCED`, `BILL_SYNCED`,
  `NOT_SYNCED` — no `SYNC_READY`) and a `sync_ready` bool. Code filters on `sync_ready`/not-synced
  — align the not-synced check to `sync_status === "NOT_SYNCED"`.
- **Reimbursements:** `user` is FLAT (`user_id`, `user_email`, `user_full_name`, `employee_id`),
  not a nested object; `state` has 23 values incl. `REIMBURSED`, `MANUALLY_REIMBURSED`,
  `REIMBURSED_VIA_PUSH` (no plain `PAID`); query supports `sync_status`, `sync_ready`,
  `updated_after`, `direction`, `user_id`. Verify `resolveEmployeeSupplier` reads the flat fields.
- **Repayments:** `GET /repayments` schema `Repayment` = `{ id, entity_id, funding_method (free
  string), original_transaction_id, repaid_at, repayment_amount (CurrencyAmount), status, user_id,
  user_signature }`; `status` enum `AWAITING_MANUAL_REPAYMENT/AWAITING_PAYMENT/NONE/REPAID/
  REPAYMENT_FAILED/REQUESTED_BY_REVIEWER`; query `from_repaid_at`/`to_repaid_at`/`funding_methods`.
  Matches the cursor design.
- **Webhooks:** `POST /webhooks` returns `secret`; `POST /webhooks/{id}/verify` is a `{challenge}`
  echo. The `X-Ramp-Signature` header name + HMAC encoding (hex vs base64, what is signed) is
  **NOT in the OpenAPI spec** — remains the one genuinely sandbox-only unknown for the webhook route.
- Transfers/cashbacks amounts are `CurrencyAmount` objects (`{ amount:int cents, currency_code }`);
  the union schema + `toMinorUnits` already handle that shape.

## Bottom line
The two most damaging inbound bugs (100× amount understatement; no line coding) plus the live
account-scoping 500 are fixed and (for the last) proven end to end. The outbound PO-push +
bill-archive mismatches are real and spec-confirmed but need a product decision and a live
sandbox pass, so they are documented, not blind-patched. Webhook signature encoding is the only
field that the public docs cannot resolve.
