# Bank Reconciliation — Research Notes

> Date: 2026-07-02 · Feeds spec: `.ai/specs/2026-07-02-bank-reconciliation.md`

## Part 1 — Carbon codebase findings

### GL accounts & the bank-account gap

- `account` table (20230330024715_accounts.sql): `id` (xid), `number`, `name`, `class` (Asset/…), `incomeBalance`, `accountType` TEXT — bank accounts are `accountType = 'Bank'` (also `'Cash'`), scoped by `companyGroupId` (accounts are group-shared, not per-company).
- All modern FK references use `account.id`, never `account.number` (ar-ap-payments migration backfilled legacy number refs).
- **There is no bank-account master entity** — no bank name, masked account number, per-account currency, or feed linkage. `payment.bankAccount` (TEXT NOT NULL → `account.id`) points straight at the GL account.
- `accountDefault` (PK = companyId) has `bankCashAccount`, `bankLocalCurrencyAccount`, `bankForeignCurrencyAccount` defaults, plus (new in ar-ap-payments) `realizedExchangeGainAccount` / `realizedExchangeLossAccount`, `customerWriteOffAccount` / `supplierWriteOffAccount` — all → `account.id`.

### AR/AP payments (20260630093809_ar-ap-payments.sql — shipped 2 days ago)

- `payment`: `id` xid, `paymentId` readable (`PAY-%{yyyy}-%{mm}-`, size 6, via `getNextSequence(client, "payment", companyId)`), `paymentType` enum Receipt|Disbursement, `status` Draft|Posted|Voided, exactly-one customerId/supplierId (CHECK), `paymentDate`, `postingDate`, `currencyCode`, `exchangeRate`, `totalAmount >= 0`, `bankAccount` → account.id, `reference`, `memo`, `journalId`, posted/voided audit cols, `companyId`, `customFields`. RLS uses `invoicing_*` permissions.
- `memo`: credit/debit memos, same lifecycle shape.
- `invoiceSettlement`: funding source (paymentId XOR memoId) × target (salesInvoice/purchaseInvoice/memo), `appliedAmount`/`discountAmount`/`writeOffAmount`, `sourceExchangeRate`/`targetExchangeRate`, generated `fxGainLossAmount`, `appliedViaPaymentId`.
- **Posting is base-currency**: `post-payment` edge fn computes `paymentTotalBase = totalAmount * exchangeRate` and inserts `journalLine` rows in base currency (`build-payment-journal.ts`). Voiding posts mirror lines (`amount: -line.amount`) — never deletes.

### Journal structure

- `journal`: `id` = `id('je')`, `journalEntryId` readable (`JE-%{yyyy}-%{mm}-`), `description`, `postingDate`, `status` Draft|Posted|Reversed, `sourceType` enum (Manual, Purchase Receipt/Invoice, Sales Invoice/Shipment, Inventory Adjustment, Payment, Credit Memo, Debit Memo, …), `accountingPeriodId`, `reversalOfId`/`reversedById`, posted audit cols, `companyId`.
- `journalLine`: `id` xid, `journalId` (CASCADE), `accountId` → account.id, `description`, `amount` **class-signed natural balance** (Asset: positive = debit = cash inflow), `journalLineReference` (uuid), `companyId`, `companyGroupId`. No date on the line — join `journal.postingDate`.
- `journalLineDimension` for analytics tags.
- `postJournalEntry(client, id, userId)` validates Draft + balanced then flips to Posted. `reverseJournalEntry` creates a mirror entry.
- GL lines are stored **in base currency**; multi-currency documents carry `exchangeRate` and post translated amounts. `exchangeRateHistory` table exists ((currencyCode, effectiveDate, companyGroupId) unique).

### Accounting module layout

- One service file: `apps/erp/app/modules/accounting/accounting.service.ts` (~2.5k lines) — bank rec functions must go here (feedback memory: never scatter service/models files). Models → `accounting.models.ts`; heavy Kysely transactions → `accounting.server.ts` (precedent: `postDepreciationRun`).
- Routes: `apps/erp/app/routes/x+/accounting+/` — list pages (`journals.tsx`, `charts.tsx`, `fixed-assets.tsx`), drawer child routes (`charts.$accountId.tsx`, `journals.new.tsx`) per Drawer-overlay convention.
- Sidebar: `ui/useAccountingSubmodules.tsx` groups — Reports / General Ledger / Fixed Assets / Configure; gated by `accountingEnabled` setting + `accounting_view`.
- Periods: `accountingPeriod` with `closedAt`/`closedBy`; `getOrCreateAccountingPeriod(client, companyId, date)` is the posting gate. **Period-closing spec in flight** (2026-07-02) adds `closeStatus` Open|Locked|Closed + close-readiness checklist — bank rec should integrate (readiness warning + reconciliation vs locked periods).

### Integration framework (Xero = precedent)

- Registry: `packages/ee/src/index.ts` `integrations` array; per-integration `packages/ee/src/{id}/config.tsx` (+ `hooks.server.ts` registered in `packages/ee/src/hooks.server.ts` — onInstall/onUninstall/onHealthcheck).
- `companyIntegration` table: PK (`id`, `companyId`), `metadata` JSON (stores OAuth tokens **plaintext JSONB** — Xero access/refresh tokens live here), `active`. One row per integration per company.
- `externalIntegrationMapping`: (`entityType`, `entityId`, `integration`, `externalId`, `companyId`) with unique constraints — used for idempotent CSV + Xero sync.
- OAuth flow: `apps/erp/app/routes/api+/integrations.xero.install.ts` (redirect out) + `integrations.xero.oauth.ts` (callback, token exchange, upsert metadata, onInstall hook).
- Webhooks: `apps/erp/app/routes/api+/webhook.xero.ts` — HMAC verify against raw body, map tenant → company, fire Inngest event. Env secrets in `packages/env/src/index.ts` via `getEnv(...)`.
- Inngest: `packages/jobs/src/inngest/functions/integrations/…`; event names `carbon/<task-id>`; app code calls `trigger("task-id", payload)` mapped in `packages/lib/src/trigger.ts` + typed in `packages/lib/src/events.ts`.

### CSV import pipeline (precedent for statement upload)

- Client: `apps/erp/app/components/ImportCSVModal/` — react-dropzone + PapaParse preview → upload to `private` bucket at `${companyId}/imports/${nanoid()}.csv` → FieldMappings UI (column → field, enum mappings) → POST `x+/shared+/import.$tableId.tsx`.
- Mappings/permissions/schemas: `apps/erp/app/modules/shared/imports.models.ts` (`fieldMappings`, `importPermissions`, `importSchemas`).
- Edge fn `import-csv`: downloads from bucket, parses (Deno std csv), classifies rows insert/update/skip, transaction-wrapped writes, idempotency via `externalIntegrationMapping` (`integration = "csv"`).
- Storage: `private` bucket, path convention `${companyId}/…`.

### Plaid status

- Zero Plaid references in repo; no fintech SDKs in any package.json. `PLAID_CLIENT_ID`/`PLAID_SECRET` would follow the `packages/env` `getEnv` pattern (optional → integration hides itself when unset, like Xero).

## Part 2 — Industry research (SAP, NetSuite, Xero/QBO, Plaid, audit practice)

Method: deep-research workflow (fan-out search → fetch → 3-vote adversarial verification). 16 claims survived verification before the session usage limit killed the Xero/Plaid verification passes and synthesis; the "verified" subsection below cites sources, the "model knowledge" subsection is unverified-but-stable public-documentation knowledge, labeled as such.

### Verified claims (adversarially checked, cited)

**SAP Electronic Bank Statement (EBS)** — [help.sap.com](https://help.sap.com/docs/SUPPORT_CONTENT/fiaccounting/3361881808.html)
- Supported statement formats: SWIFT MT940, MultiCash, BAI, XML; import requires a format code (M = MultiCash, S = MT940, X = XML).
- ISO 20022 camt mapping: camt.052 = intraday (MT942), **camt.053 = end-of-day statement (MT940 equivalent)**, camt.054 = debit/credit notification (MT900/910). Custom/bank-specific XML needs per-format XSL transformation or BAdI `FIEB_MAPPING_X`.
- FF.5 (RFEBKA00) imports a single file per run; multi-file needs FEB_FILE_HANDLING (app-server only).
- Posting configuration is a fixed chain: account symbols → assign G/L accounts → posting-rule keys → posting rules → transaction types → **assign external transaction codes (bank-provided) to posting rules** → assign bank accounts to transaction types. I.e., SAP's "rules engine" is code-driven: the bank's transaction-type code on each statement line selects the posting rule.

**NetSuite** — [docs.oracle.com NetSuite help](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1551275.html), [chapter_4842302228](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4842302228.html), [section_159010939426](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159010939426.html)
- Intelligent Transaction Matching auto-runs **at bank-data import time** (plus manual re-run); matches imported bank lines against account (GL) transactions; manual matching is for exceptions.
- Two rule tiers: immutable **System Rules** + ordered, user-editable **User Rules**, subdivided into Matching Rules and Auto-Create Rules.
- Auto-Create Rules (2020.2+) create-and-match transactions from unmatched bank lines — limited to deposits/charges for bank accounts (charges/refunds for credit-card accounts).
- **Ambiguity refusal**: if a rule finds ≥2 candidate matches for one bank line, NetSuite makes no match; user picks manually.
- Two-stage flow: **Match Bank Data** page (side-by-side grids; actions: match, mark cleared, exclude, review, submit) → **Reconcile Account Statement** page (operates only on submitted/cleared items; include/exclude → reconcile). Status progression: matched/user-cleared → submitted/cleared → reconciled.
- Bank feeds via aggregators (Salt Edge named for Europe; US/Canada partner unnamed in docs). File import supports **CAMT.053, MT940, BAI2, OFX/QFX**, manual or automated via SFTP.
- **Hard 1:1 currency constraint**: bank-feed import fails outright if the GL account currency ≠ connected bank account currency (no conversion).

**Xero** — [central.xero.com](https://central.xero.com/s/article/Bank-reconciliation-in-Xero)
- Reconciliation UX is a two-sided screen: imported bank statement lines on the left, Xero account transactions on the right; reconciling = pairing them.

### Model knowledge (NOT adversarially verified — usage limit killed these passes; from stable public docs)

**Xero / QuickBooks Online UX (usability benchmark)**
- Xero statement lines are first-class, immutable rows; per line the user can **Match** (to existing transactions, incl. Find & Match for one-to-many), **Create** (code directly to an account, optionally via bank rules), or **Transfer** (to another bank account). Minor difference between a match and the line can be booked inline as a bank-fee/minor adjustment.
- Xero bank rules: condition set (payee/description/amount contains-equals) → coding template (account, tax, contact); applied as suggestions on feed lines.
- QBO: "For Review / Categorized / Excluded" tabs; monthly Reconcile module requires statement ending date + ending balance and blocks completion until difference = $0; "undo reconciliation" restricted (accountant role).
- Both produce a reconciliation report: statement balance vs book balance, with outstanding (uncleared) payments and deposits listed — the artifact auditors request.

**Plaid** ([plaid.com/docs](https://plaid.com/docs/))
- Flow: server `POST /link/token/create` (products `["transactions"]`, webhook URL) → client opens Link widget → `onSuccess(public_token, metadata.accounts)` → server `POST /item/public_token/exchange` → `access_token` + `item_id`. One **Item** per institution login; an Item contains N accounts (`account_id`s).
- `/transactions/sync` is the modern cursor model (replaces `/transactions/get`): returns `added` / `modified` / `removed` arrays + `next_cursor` + `has_more`; loop until `has_more=false`; persist cursor per Item.
- Webhooks: `SYNC_UPDATES_AVAILABLE` (fire a sync), `INITIAL_UPDATE`/`HISTORICAL_UPDATE` (legacy-model progress signals), `TRANSACTIONS_REMOVED` (legacy removal). Item webhooks: `ERROR` with `ITEM_LOGIN_REQUIRED` → re-auth via Link **update mode** (link_token created with the access_token). Webhook authenticity via JWT in `Plaid-Verification` header (`/webhook_verification_key/get`).
- **Sign convention: Plaid `amount` is positive for money LEAVING the account** (outflow) — must invert for a positive-=-inflow model.
- Pending → posted: pending transactions arrive with `pending: true`; the posted version arrives as a new transaction carrying `pending_transaction_id`, and the pending one appears in `removed`.
- `transaction_id` is unique per Item — safe dedupe key. Sandbox: `user_good`/`pass_good`, `/sandbox/item/fire_webhook`. Pricing: subscription per connected Item/account per month for Transactions (order ~$0.30/connected account/mo at scale; production access requires Plaid approval).

**Accounting practice / audit**
- The audit artifact is the **statement-based reconciliation report**: statement ending balance + deposits in transit − outstanding checks = adjusted bank balance ≟ GL book balance; bank-only items (fees, interest, NSF) are posted as adjusting entries *before* completing.
- Continuous matching (feeds) and periodic statement tie-out are complementary: match continuously, close out per statement. Un-reconciliation should be restricted (latest-first) and audited. Reconciliation adjustments must respect period locks (post through the normal journal gates).
- Segregation of duties: ideally the reconciler is not the person who records cash transactions; at minimum the completed reconciliation records who completed it and when.

### Design takeaways for Carbon

1. Separate **bank account master** from the GL account (SAP house bank / NetSuite financial-institution connection), 1:1 with a GL account.
2. Statement lines are **immutable imported rows** with a provider-stable external ID for idempotent re-import (OFX FITID / Plaid transaction_id / content hash for CSV).
3. Match at the **GL (journal line) level**, not the document level — everything that touches the bank GL account is matchable regardless of source (SAP posting area 1, NetSuite "account transactions").
4. Auto-match must be conservative: exact amount + date window + **exactly one candidate** (NetSuite ambiguity refusal); suggestions for the rest.
5. Two-stage lifecycle: continuous matching + statement-based close-out with ending-balance tie-out (NetSuite Match → Reconcile; QBO difference-must-be-zero).
6. Mirror NetSuite's hard currency constraint in v1: bank account currency must equal company base currency (Carbon posts GL in base currency only; journalLine has no source-currency amount).
7. Plaid: store per-Item access tokens + sync cursors in `companyIntegration.metadata` (Xero precedent); webhook-triggered incremental sync + scheduled catch-up; invert amount sign at ingest; keep pending lines out of matching.
