# Ramp Integration — Transaction Sync (Cards, Bills, Payments, Reimbursements)

> Status: draft (delegated decisions pending user veto — see Open Questions)
> Author: Brad Barbin + Claude
> Date: 2026-08-20
> Research: `.ai/research/ramp-transaction-sync.md` (Ramp API v1, Ramp first-party ERP
> integrations, industry consensus, Carbon architecture — 2026-08-20)
> Related specs: `.ai/specs/2026-07-02-bank-reconciliation.md` (future `bankAccount` master —
> compose, don't duplicate), `.ai/specs/implemented/2026-08-05-accounting-document-representation.md`
> (journal-replay bills — Ramp postings flow onward through this), `.ai/specs/implemented/2026-08-15-integration-secret-encryption.md` (vault secrets)

## TLDR

Carbon becomes a Ramp **accounting provider** via Ramp's ERP-integration API: on install,
Carbon registers an accounting connection, pushes its chart of accounts and dimension values
into Ramp (coding happens in Ramp against real Carbon accounts), then runs the canonical
pull → post → confirm loop over Ramp's sync queues. Cleared, fully-coded card transactions
become a new **`cardTransaction`** document (NetSuite Credit Card Charge model) posting
Dr coded expense / Cr a mapped **Ramp Card liability account**; statement payments (Ramp
transfers) and cashbacks are the same document with different types, settling that liability
against a mapped bank GL account. Ramp Bill Pay bills become **`purchaseInvoice`** rows
(two-phase: bill, then bill-payment as `payment` + `invoiceSettlement`); reimbursements
become employee-as-supplier invoices + payments (Ramp's own first-party pattern). In the
outbound direction, Carbon pushes released POs into Ramp (so Ramp's OCR matches invoices to
them and bills come back pre-linked to Carbon PO lines) and open purchase invoices can be
sent to Ramp for payment via an explicit action, closing back through the payment pull.
Every posting is confirmed to Ramp with `POST /accounting/syncs` (idempotency-keyed;
failures render as actionable export errors in the customer's Ramp Accounting tab).
Transport is a Rillet-pattern HMAC webhook route plus an hourly Inngest sweep as the
correctness floor. Auth starts as client-credentials against the sandbox
(`demo-api.ramp.com`) with the credential schema shaped to add authorization-code OAuth
without migration.

## Problem Statement

Companies running Carbon and Ramp keep two disconnected books. Card spend coded in Ramp
never reaches Carbon's GL — controllers re-key card charges as manual journals or, worse,
as supplier invoices (a duplicate liability: the merchant was paid at swipe; the only
creditor is Ramp). Bills paid through Ramp Bill Pay stay open in Carbon's AP, get paid a
second time, and break aging and the AP tie-out. Statement payments show up as unexplained
bank activity. There is no Carbon document type for card spend at all today — the closest
things are a G/L Account line on a purchase invoice (wrong: AP) or a Manual journal
(never syncs onward, no document UX, no audit trail per charge).

The "big syncing problem" decomposes into known dedupe rules (research §Key Consensus
Patterns): one accounting home per card transaction; bills deduped on `remote_id` +
vendor/invoice-number; card-paid bills suppressed by Ramp itself; statement payments as
liability transfers, never P&L; only `CLEARED` + `SYNC_READY` objects post.

## Proposed Solution

### Architecture (fits existing patterns exactly)

| Concern | Pattern followed |
|---|---|
| Integration registration | Generic integration `ramp` in `packages/ee/src/ramp/` (`config.tsx`, `hooks.server.ts`, `lib/client.ts`, `lib/service.ts`), registered in `packages/ee/src/index.ts` + `hooks.server.ts`; seed migration adds the `integration` row |
| Secrets | `SECRET_KEYS.ramp` → Supabase Vault via `persistIntegrationSecrets` (clientSecret, accessToken/refreshToken, webhook signing secret) |
| Webhook ingress | `apps/erp/app/routes/api+/webhook.ramp.$companyId.ts` — Node runtime, raw body, HMAC-SHA256 `X-Ramp-Signature` verify (fail-closed), challenge handshake, thin-payload → `trigger("ramp-sync", …)`, fast ack |
| Polling floor | Inngest cron `ramp-sweep` (hourly) draining Ramp's sync queues per active integration — queue-draining, so no cursors needed for the primary loop |
| ID linking | `externalIntegrationMapping` (`integration: 'ramp'`) for every entity pair; no per-table externalId columns |
| GL posting | New `post-card-transaction` edge function (pattern: `post-payment`); bills/payments reuse `post-purchase-invoice` / `post-payment` |
| Downstream accounting sync | Ramp-created journals/invoices/payments flow onward to Xero/QBO/Rillet through the existing engine unchanged (new `journalEntrySourceType` participates in the journal push) |

Ramp is **not** a new accounting `ProviderID` — it is a spend source feeding Carbon, which
remains the books of record.

### The sync loop (Carbon as Ramp's accounting provider)

**Install (`onInstall` hook):**
1. Validate credentials (`GET /developer/v1/business` or token mint).
2. `POST /accounting/connection` (`remote_provider_name: "Carbon"`, `reactivate` if present).
3. Push CoA: every active leaf `account` → `POST /accounting/accounts` (batch ≤500), `id` =
   Carbon `account.id`, `classification` mapped from Carbon account class (the card liability
   account maps to `CREDCARD`).
4. Push dimensions (user decision: all except items, customers, suppliers): each Carbon
   dimension (cost centers + custom dimensions) → `POST /accounting/fields` +
   `/accounting/field-options` (`id` = Carbon row ids). No accounting-vendor upload in v1.
5. Register webhook: `POST /developer/v1/webhooks` (`endpoint_url` =
   `/api/webhook/ramp/{companyId}`; events: `transactions.ready_to_sync`, `transactions.cleared`,
   `bills.ready_to_sync`, `bills.updated`, `bills.paid`, `payments.updated`,
   `reimbursements.ready_to_sync`, `purchase_orders.updated`), store returned `secret` in
   vault, answer the challenge verification.
6. Fire an initial `ramp-sync` run.

`onUpdate` re-converges CoA/dimension pushes (upsert; deleted Carbon accounts → `PATCH
{visibility: "HIDDEN"}`, never DELETE — Ramp best practice). `onUninstall` deletes the
webhook and deactivates the connection. `onHealthcheck` = token mint + `GET
/accounting/all-connections` status check.

**Pull (webhook-triggered `ramp-sync` + hourly `ramp-sweep`, same code path):** for each
family, list ready objects, post them in Carbon, then confirm:

| Ramp queue | Filter | Carbon posting | Confirm `sync_type` |
|---|---|---|---|
| Card transactions | `sync_status=SYNC_READY` (implies CLEARED) | `cardTransaction` type Charge/Credit, posted | `TRANSACTION_SYNC` |
| Transfers (statement payments) | `sync_status=SYNC_READY` | `cardTransaction` type Payment | `TRANSFER_SYNC` |
| Cashbacks | `sync_status=SYNC_READY` | `cardTransaction` type Cashback | `STATEMENT_CREDIT_SYNC` |
| Bills | `sync_ready=true` + `sync_status=NOT_SYNCED` | `purchaseInvoice` posted (Open) | `BILL_SYNC` |
| Bill payments | `sync_ready=true` + `sync_status=BILL_SYNCED` (+ bill `status=PAID`) | `payment` + `invoiceSettlement` posted | `BILL_PAYMENT_SYNC` |
| Reimbursements | `sync_status=SYNC_READY` | employee-supplier `purchaseInvoice` (+ `payment` when Ramp-paid) | `REIMBURSEMENT_SYNC` |
| Repayments | `status=REPAID`, `repaid_at` cursor | `cardTransaction` type Repayment | none exposed — sandbox-verify (see Reimbursements section) |

Confirmation: `POST /accounting/syncs` with deterministic `idempotency_key` =
sha256(companyId · sync_type · sorted object ids) — Ramp dedupes on it; `reference_id` =
the Carbon document's readable id; `deep_link_url` = the Carbon document URL. Failures go
in `failed_syncs` with a user-actionable message (it renders in Ramp's Accounting tab) and
fire `NotificationEvent.IntegrationSync` to the installer. **On failure Carbon creates
nothing** — Ramp keeps the object queued; the customer fixes the cause and it re-drains.
Per-object idempotency: before posting, check `externalIntegrationMapping` for the Ramp id;
if present, re-confirm instead of re-posting (covers duplicate webhooks, crashed runs, and
out-of-order delivery).

Rate limits (200 req/10 s) are respected by page-size-100 listing and batched confirms.

### The `cardTransaction` document (user decision: NetSuite model)

One document family = the card register: charges, refunds, balance payments, cashbacks —
mirroring a card statement, one list UI, one posting function.

| Type | GL posting (natural-balance-signed, `credit()`/`debit()` helpers) |
|---|---|
| `Charge` | Dr line expense accounts (from Ramp coding, incl. splits) / Cr card liability |
| `Credit` (refund) | Dr card liability / Cr line accounts (reversal; Ramp sends negative amounts + `original_transaction_id`) |
| `Payment` (Ramp transfer) | Dr card liability / Cr mapped bank GL account — **delegated decision: modeled as a `cardTransaction` type, not a `payment` row** (Carbon `payment` requires a customer/supplier party and posts to an AP/AR control account; a statement payment has neither — QBO models this as a special transaction type on the card account, which is exactly this) |
| `Cashback` | Dr card liability / Cr mapped cashback income account (statement-credit form; Brex pattern) |
| `Repayment` (employee pays the company back for personal spend) | Dr bank (bank/ACH funding) **or** Dr card liability (statement-credit funding) / Cr the ORIGINAL transaction's expense lines, scaled by repayment amount — copied from the posted Carbon `cardTransaction` found via `original_transaction_id` mapping (first-party pattern: QBO Deposit / NetSuite reversal JE). If the original was never synced to Carbon, fail the item with an actionable message |

- Coding resolution: Ramp `accounting_field_selections` carry Carbon ids as `external_id`
  (because Carbon pushed them) — resolution is an id lookup, never name matching. A
  selection whose id no longer exists → failed sync with message naming the field.
- Line-level dimensions land on `journalLineDimension` via the posting function.
- `accounting_date` from Ramp is the posting date; if it falls in a closed period, shift to
  the first day of the next open period (Ramp's own first-party behavior) and record the
  shift in the document.
- Amounts: Ramp `CurrencyAmount` integer minor units ÷ `minor_unit_conversion_rate` →
  decimal via `round(…)` at settlement scale (`currency.decimalPlaces`) per
  `.claude/rules/numeric-precision.md`.
- Receipts: Ramp receipt URLs fetched and stored as `document` rows in the private bucket,
  attached to the card transaction (path `${companyId}/card-transaction/${id}/…`).
- Posted card transactions are immutable in Ramp — Carbon documents post immediately on
  sync (`status: Posted`); `Voided` exists for corrections (reversing journal), mirroring
  `payment`.

### Bills → `purchaseInvoice`

- **BILL_SYNC**: resolve supplier: (1) `externalIntegrationMapping` (`vendor` ↔ Ramp
  `vendor_id`), (2) case-insensitive name match, (3) auto-create (Ramp's own behavior),
  recording the mapping. Build invoice: `invoiceId` from sequence, `supplierReference` =
  Ramp `invoice_number`, lines = G/L Account lines from Ramp line-item coding; post via
  `post-purchase-invoice` (Dr coded accounts / Cr `accountDefault.payablesAccount`).
  Dedupe: mapping table first, then supplier + `invoice_number` against
  `supplierReference` (skip + confirm as synced with the existing invoice's reference).
- **PO-linked bills**: when a bill's `purchase_order_id` maps to a Carbon PO (pushed
  outbound, below), the invoice is created through the existing PO→invoice path
  (`convert` edge function) so `quantityInvoiced` and PO lifecycle advance; line amounts
  reconciled to the bill's `purchase_order_line_item_id` matches. Bills referencing
  Ramp-native POs (no Carbon mapping) post as standalone GL invoices with the Ramp PO
  number in the reference.
- **BILL_PAYMENT_SYNC**: `payment` (Disbursement, `bankAccount` = mapped Ramp funding
  account) + `invoiceSettlement` against the invoice, posted via `post-payment`.
  Payment-method `CARD`/`ONE_TIME_CARD` bills never reach this phase (Ramp routes them
  through card accounting) — assert and skip-confirm if one appears.
- **Carbon-born invoice already exists** (pushed outbound or imported): BILL_SYNC
  short-circuits to a mapping + confirm; only the payment posts.

### Reimbursements (user decision: in v1; mechanism delegated)

**Delegated decision: employee-as-supplier**, exactly Ramp's first-party shape — one
`purchaseInvoice` per reimbursement with the employee as supplier (auto-created on first
use: name "First Last (email)", dedicated `supplierType` "Employee", mapped via
`externalIntegrationMapping` `vendor` ↔ Ramp `user_id`). Rationale over direct-GL posting:
"Manual Pay" reimbursements sync as **open** bills needing a real AP document to pay later,
and Ramp-paid ones reuse `payment`/`invoiceSettlement` wholesale — zero new posting code.
Supplier-master pollution is contained by the filterable type.

**Repayments (employee → business) are IN scope v1 (user decision):** pulled from
`GET /developer/v1/repayments` filtered to `status=REPAID` with a `repaid_at` high-water
cursor in integration metadata (the one pull that needs a cursor — the repayment object
has no `sync_status` queue), deduped via `externalIntegrationMapping`, and posted as
`cardTransaction` type `Repayment` (posting table above). ⚠️ Sandbox-verify: the public
`/accounting/syncs` `sync_type` enum has **no `REPAYMENT_SYNC`** value — confirm on the
sandbox whether repayments surface for confirmation under another type (e.g.
`TRANSFER_SYNC`/`STATEMENT_CREDIT_SYNC`) or simply aren't confirmable via the API; if not
confirmable, Carbon posts without a Ramp-side confirm and the mapping table alone
guarantees idempotency (lesson: verify before it lands in the sweep).

### Outbound (user decision: both directions)

- **POs → Ramp**: on PO release (status leaves Draft/Needs Approval), push `POST
  /purchase-orders` (`remote_id` = Carbon PO id, line `remote_id` = line id, amounts,
  vendor by Ramp-vendor mapping — created via `POST /vendors` if missing). Updates re-push
  (`PATCH`); closed/completed POs archive. Wired as an event-system subscription on
  `purchaseOrder` (install-hook-created, `ramp-sync` subscription name) draining through
  `ramp-sync`. Ramp then OCR-matches supplier invoices to these POs.
- **Purchase invoices → Ramp for payment** (user decision 2026-08-20: **automatic, as
  submitted drafts — Ramp's approval workflow decides**): when a Carbon purchase invoice
  becomes posted + Open (and is unmapped and unpaid), push it as a **draft bill**
  (`POST /bills/drafts` + `POST /bills/drafts/{id}/submit`) with the Carbon invoice id as
  the external reference, coded line items, and the invoice PDF attached when present.
  Submitting the draft hands it to **Ramp's own approval workflow** — auto-approve rules
  or approver chains, per the customer's Ramp configuration — so no money can move without
  Ramp-side approval, and Carbon never bypasses the approval chain (`POST /bills` creates
  auto-approved bills and is deliberately NOT used). Payment method/schedule are chosen in
  Ramp at approval time. Gated by a `sync.pushInvoices` toggle (default on). Wired like
  the PO push: event-system subscription on `purchaseInvoice`, drained by `ramp-sync`.
  **Reverse lifecycle:** an invoice settled or voided in Carbon before Ramp pays it →
  archive the Ramp draft/bill (`POST /bills/{id}/archive`); if Ramp already paid, the
  normal BILL_PAYMENT_SYNC pull applies. When the pushed bill is approved and paid in
  Ramp, BILL_SYNC short-circuits on the mapping and only the payment posts.
  Sandbox-verify: whether drafts accept `remote_id` (else the mapping table alone links
  them), and the draft→submit→Pending-approval transition (lesson: VERIFY-flagged
  endpoints in a loop are outages).

  **Transport amendment (2026-08-20, plan phase):** outbound PO/invoice push runs on
  Carbon-side `updatedAt` high-water cursors inside the Ramp sweep, NOT event-system
  subscriptions — the SYNC handler (`events/sync.ts`) zod-rejects any provider outside the
  accounting `ProviderID` enum, and a new handlerType is out of scope. Push latency is
  bounded by the sweep interval, which is fine (POs just need to be in Ramp before the
  supplier's invoice arrives).

### Auth (user decision: OAuth destination, client-credentials for development)

Credential schema is a discriminated union from day one:
`{ type: "client_credentials", clientId, clientSecret, environment: production|sandbox }` |
`{ type: "oauth2", accessToken, refreshToken, expiresAt, environment }`.
v1 implements client-credentials: the client mints 10-day tokens on demand from the stored
id/secret (both flows use the same Ramp app registration, so migrating to authorization-code
later adds a callback route `api+/integrations.ramp.oauth.ts` — Xero pattern — without a
metadata migration). Sandbox = `demo-api.ramp.com`; scopes requested:
`accounting:read accounting:write transactions:read bills:read bills:write vendors:read
vendors:write reimbursements:read purchase_orders:read purchase_orders:write transfers:read
statements:read cashbacks:read receipts:read entities:read business:read`.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration shape | Generic integration, not an accounting `ProviderID` | Ramp is a spend source; Carbon stays books of record; SyncFactory is for GL destinations |
| Card transaction document | New `cardTransaction` + `cardTransactionLine` tables, own posting edge fn | **User decision** (NetSuite CCT model); consensus: native document, never merchant AP |
| Statement payments | `cardTransaction` type `Payment` | **Delegated**: `payment` needs a party + posts AP/AR control; QBO's "Pay down credit card" is a card-register transaction — one register UI, one posting fn |
| Reimbursements | Employee-as-supplier `purchaseInvoice` (+`payment`), `supplierType` "Employee" | **Delegated**: matches Ramp first-party; Manual-Pay needs an open AP doc; reuses settlement machinery |
| Cashbacks | In scope, `cardTransaction` type `Cashback` (statement credit) | Same queue mechanics, ~free; Brex posts identically |
| Repayments | In scope v1: `cardTransaction` type `Repayment`, expense-line reversal scaled from the original document | **User decision**; `repaid_at` cursor pull; Ramp-side confirm mechanism unverified (no `REPAYMENT_SYNC` sync_type — sandbox-verify) |
| Coding fields pushed | CoA + all dimensions EXCEPT items, customers, suppliers | **User decision**; consequence: supplier resolution happens Carbon-side (map → name → auto-create) |
| Invoice→Ramp trigger | Automatic push of posted Open invoices as SUBMITTED DRAFT bills; Ramp's approval workflow decides approval | **User decision**: the human gate is Ramp's own configured approval chain; Carbon never creates auto-approved bills; `sync.pushInvoices` toggle (default on); archive-on-Carbon-settlement covers the reverse path |
| Sync failure surface | Ramp Accounting tab (via `failed_syncs`) + `IntegrationSync` notification; no new Carbon sync-ledger table in v1 | Ramp's queue IS the retry state; `accountingSyncOperation` is provider-engine-specific; revisit if support burden demands |
| Multi-entity Ramp businesses | Optional `entityId` filter in settings; default: all entities into the company | Single-entity is the common case; filter is one query param everywhere |
| Sync cadence | Webhooks + hourly cron sweep | Ramp guidance (poll 1–4 h + `ready_to_sync` webhooks); queue-draining makes the sweep idempotent |
| Module home | `invoicing` module, `invoicing_*` permissions | Lesson: no new permission family; `payment`/`memo` (the closest siblings) live there |
| Account references | By `account.id` in integration metadata mappings | Lesson: never resolve control accounts by number |
| Journal linkage | New `journalEntrySourceType` 'Card Transaction' + `journalLineDocumentType` 'Card Transaction' | Lesson: journal and itemLedger enums are distinct; itemLedger untouched (no inventory movement) |
| Bank-rec composition | Card liability is a plain GL account in v1; when `bankAccount` (type Credit Card) ships, it links 1:1 to this same GL account and `cardTransaction` journals become its match targets | The bank-rec spec matches at the journal-line level, so no rework |
| Multi-tenancy (heuristic 1) | Both new tables: `companyId`, composite PK `("id","companyId")`, `id('…')` defaults, audit columns | Convention |
| Service shape (heuristic 2) | `getCardTransactions`/`getCardTransaction`/`upsert…`/`post…` in `invoicing.service.ts`, client-first, `{data,error}` | Convention; Ramp API client lives in `packages/ee/src/ramp/lib/` |
| RLS (heuristic 3) | `invoicing_view/…` policies on both tables, same as `payment` | Convention |
| Permissions (heuristic 4) | Routes `requirePermissions({ view/create/update: "invoicing" })`; webhook route verifies HMAC not JWT | Convention |
| Forms (heuristic 5) | Settings drawer = existing generic integration form + account-mapping fields; card-transaction detail is read-mostly (Drawer overlay per house rule) | Convention |
| Module layout (heuristic 6) | No new service/models files — extend `invoicing.models.ts` / `invoicing.service.ts`; Ramp-specific code in `@carbon/ee` | Feedback memory |
| Backward compat (heuristic 7) | No frozen surface touched; two enum ADD VALUEs (additive); new tables only | Additive-only migration |

## Data Model Changes

One migration (timestamp randomized per convention; all DDL idempotent):

```sql
-- Integration registry row
INSERT INTO "integration" ("id", "jsonschema")
VALUES ('ramp', '{"type":"object","properties":{}}'::json)
ON CONFLICT ("id") DO NOTHING;

-- Journal linkage (additive enum values)
ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Card Transaction';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Card Transaction';

CREATE TYPE "cardTransactionType" AS ENUM ('Charge', 'Credit', 'Payment', 'Cashback', 'Repayment');
CREATE TYPE "cardTransactionStatus" AS ENUM ('Draft', 'Posted', 'Voided');

CREATE TABLE "cardTransaction" (
    "id" TEXT NOT NULL DEFAULT id('ctxn'),
    "cardTransactionId" TEXT NOT NULL,           -- readable, sequence 'CARD-…'
    "companyId" TEXT NOT NULL,
    "type" "cardTransactionType" NOT NULL DEFAULT 'Charge',
    "status" "cardTransactionStatus" NOT NULL DEFAULT 'Draft',
    "integration" TEXT NOT NULL DEFAULT 'ramp',
    "cardAccountId" TEXT NOT NULL,               -- card liability account.id
    "offsetAccountId" TEXT,                      -- Payment: bank GL; Cashback: income GL
    "merchantName" TEXT,
    "cardHolderName" TEXT,
    "cardLast4" TEXT,
    "memo" TEXT,
    "transactionDate" DATE NOT NULL,
    "postingDate" DATE,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
    "amount" NUMERIC NOT NULL,                   -- document total, positive
    "journalId" TEXT,
    "postedAt" TIMESTAMP WITH TIME ZONE,
    "postedBy" TEXT REFERENCES "user"("id"),
    "voidedAt" TIMESTAMP WITH TIME ZONE,
    "voidedBy" TEXT REFERENCES "user"("id"),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "cardTransaction_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "cardTransaction_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cardTransaction_cardAccountId_fkey" FOREIGN KEY ("cardAccountId")
      REFERENCES "account"("id"),
    CONSTRAINT "cardTransaction_offsetAccountId_fkey" FOREIGN KEY ("offsetAccountId")
      REFERENCES "account"("id"),
    CONSTRAINT "cardTransaction_journalId_fkey" FOREIGN KEY ("journalId")
      REFERENCES "journal"("id")
);
-- + UNIQUE ("cardTransactionId","companyId"); indexes on (companyId,status), (companyId,transactionDate)

CREATE TABLE "cardTransactionLine" (
    "id" TEXT NOT NULL DEFAULT id('ctxl'),
    "cardTransactionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,                   -- coded expense account.id
    "costCenterId" TEXT,
    "description" TEXT,
    "amount" NUMERIC NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "cardTransactionLine_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "cardTransactionLine_parent_fkey" FOREIGN KEY ("cardTransactionId","companyId")
      REFERENCES "cardTransaction"("id","companyId") ON DELETE CASCADE,
    CONSTRAINT "cardTransactionLine_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cardTransactionLine_accountId_fkey" FOREIGN KEY ("accountId")
      REFERENCES "account"("id")
);

-- RLS: invoicing_* policies on both tables (same shape as "payment");
-- readable-id sequence registration for 'cardTransaction';
-- posted-immutability triggers mirroring journal conventions (plan details).
-- supplierType seed: an "Employee" type is created lazily by the integration,
-- not by migration (it's per-company data, not schema).
```

Integration metadata (`companyIntegration.metadata`, non-secret parts):

```jsonc
{
  "credentials": { "type": "client_credentials", "clientId": "…", "environment": "sandbox" }, // secret paths vaulted
  "accounts": {
    "cardLiabilityAccountId": "…",     // required; pushed to Ramp as CREDCARD
    "statementBankAccountId": "…",     // required; transfers credit this
    "cashbackIncomeAccountId": "…",    // optional; default: skip cashbacks until set
    "reimbursementBankAccountId": "…"  // optional; defaults to statementBankAccountId
  },
  "entityId": null,                     // optional Ramp entity filter
  "sync": { "pullTransactions": true, "pullBills": true, "pullReimbursements": true,
             "pushPurchaseOrders": true, "pushInvoices": true },
  "connectionId": "…", "webhookId": "…"
}
```

`SECRET_KEYS.ramp = ["credentials.clientSecret", "credentials.accessToken",
"credentials.refreshToken", "webhookSecret"]`.

## API / Service Changes

- `packages/ee/src/ramp/` — `config.tsx` (settings schema incl. account-mapping fields +
  sync toggles), `hooks.server.ts` (install/update/uninstall/healthcheck as above),
  `lib/client.ts` (typed fetch client: token mint + cache, cursor pagination, rate-limit
  backoff, `CurrencyAmount` decoding), `lib/service.ts` (connection setup, CoA/dimension
  push, queue listing, `postAccountingSyncs`, vendor/PO/bill push), `lib/models.ts` (zod
  schemas for every consumed Ramp payload — parse, never trust).
- `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts` (event
  `carbon/ramp-sync`, concurrency-keyed per company) + `ramp-sweep.ts` (hourly cron over
  active `ramp` integrations firing `ramp-sync`); event registered in
  `packages/lib/src/trigger.ts` + `events.ts`. Outbound PO push drains through the same
  function via the `ramp-sync` event-system subscription on `purchaseOrder`.
- `packages/database/supabase/functions/post-card-transaction/` — `{type: "post"|"void",
  cardTransactionId, companyId, userId}`; Kysely transaction; journal per the type table
  (natural-balance-signed via `credit()`/`debit()`); gated on
  `companySettings.accountingEnabled` (disabled → document exists, no journal — consistent
  with other post-* functions); registered in `config.toml`.
- `apps/erp/app/modules/invoicing/` — extend `invoicing.models.ts` (validators/status
  types) + `invoicing.service.ts` (card-transaction reads, upsert, void, "Send to Ramp"
  invoice action calling `@carbon/ee/ramp`); barrel exports.
- Routes: `x+/invoicing+` additions — card-transactions list (+ detail Drawer via Outlet),
  `api+/webhook.ramp.$companyId.ts`. Invoice push is event-driven (no bespoke action
  route); the invoice detail shows a Ramp status badge/deep link when mapped.

## UI Changes

- **Integration drawer** (existing generic form): credential fields, environment select,
  account-mapping pickers (accounts filtered to sensible classes: liability for the card
  account, asset/bank for the bank account, income for cashback), sync toggles, entity
  filter. Health + uninstall come free.
- **Card Transactions list** (invoicing module nav, near Payments): table with type,
  status, date, merchant, cardholder, amount, posted-journal link; detail Drawer showing
  lines/coding, receipt attachments, Ramp deep link, void action (ERP `size="md"`,
  no `(n)` counts, existing Table components).
- **Purchase invoice**: a Ramp badge/deep link when the invoice is Ramp-linked (pushed
  draft, pending approval, scheduled, paid — from the pulled bill state); no manual push
  action (auto-push is setting-gated).
- **Supplier list**: "Employee" supplierType appears naturally in existing filters — no
  new UI.

## Acceptance Criteria

Sandbox-driven (demo-api.ramp.com; ⌘J demo actions for fixtures):

- [ ] Installing the Ramp integration with sandbox client credentials creates the Ramp
      accounting connection, pushes the CoA (spot-check: a Carbon expense account appears
      as a coding option in Ramp), registers the webhook (status `active` after challenge),
      and stores no secret material in `companyIntegration.metadata` (vault only).
- [ ] A sandbox card transaction coded to a Carbon expense account and marked ready syncs
      into a Posted `cardTransaction` (type Charge) whose journal debits that expense
      account and credits the mapped card liability account for the exact cleared amount;
      Ramp shows the transaction as Synced with a working deep link to Carbon.
- [ ] A transaction split across two categories produces two `cardTransactionLine` rows and
      two debit journal lines summing to the total.
- [ ] A refund (negative transaction) posts a type Credit document with the reversed journal.
- [ ] "Pay current bill" in the sandbox demo panel produces a transfer that syncs as a type
      Payment document: Dr card liability / Cr statement bank account; confirmed via
      `TRANSFER_SYNC`.
- [ ] A Ramp-created bill for a new vendor auto-creates the Carbon supplier, posts an Open
      `purchaseInvoice` with coded G/L lines, and confirms `BILL_SYNC`; paying it in Ramp
      then posts a `payment` + `invoiceSettlement` (invoice shows Paid) and confirms
      `BILL_PAYMENT_SYNC`. Re-delivering the webhook does not duplicate anything.
- [ ] A released Carbon PO appears in Ramp (`creation_source: DEVELOPER_API`,
      `remote_id` = Carbon id); a Ramp bill matched to it comes back linked so the Carbon
      invoice advances the PO's invoiced quantities.
- [ ] Posting a Carbon purchase invoice (with `pushInvoices` on) creates a SUBMITTED draft
      bill in Ramp that enters the Ramp approval flow (not auto-approved); approving and
      paying it in Ramp closes the Carbon invoice via payment pull — no duplicate invoice
      created. Settling the invoice in Carbon before Ramp approval archives the Ramp draft.
- [ ] A sandbox reimbursement syncs as a purchase invoice against an auto-created
      "Employee"-type supplier; a Ramp-paid one is Paid (payment + settlement), a
      Manual-Pay one stays Open.
- [ ] A repaid sandbox repayment posts a type Repayment document crediting the original
      transaction's expense accounts (scaled to the repaid amount) and debiting the bank
      or card-liability account per its funding method; re-running the sweep does not
      duplicate it (cursor + mapping idempotency).
- [ ] A card transaction coded to a since-deleted Carbon account fails its sync with an
      actionable message visible in Ramp's Accounting tab, creates nothing in Carbon, and
      succeeds after recoding.
- [ ] A transaction whose accounting date falls in a Closed period posts on the first day
      of the next open period.
- [ ] With accounting disabled (`accountingEnabled=false`), synced documents exist with no
      journals (byte-identical no-GL behavior of other post-* functions).
- [ ] `pnpm run generate:types` + scoped typecheck + lint green; migration applies cleanly
      twice (idempotent).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Ramp API claims unverified against sandbox (POST /bills idempotency; transfer semantics; exact webhook payloads) | High | Sandbox-verify every endpoint the sweep depends on BEFORE wiring (lesson: VERIFY-in-a-loop = outage); build the client against recorded sandbox responses |
| One-active-connection: installing Carbon disconnects a customer's Ramp↔QBO/Xero direct link | Med | Prominent install-time warning; document; healthcheck surfaces `connection` status |
| Double books if customer ALSO syncs Carbon→Xero while previously Ramp→Xero synced there | Med | Docs: history stays; new spend flows Ramp→Carbon→Xero; "Mark as synced" in Ramp for overlap window |
| Supplier auto-create produces duplicates (name variance) | Med | Mapping-first resolution; name match is exact-insensitive only; dedupe review is standard AP hygiene |
| Double-payment race: invoice paid in Carbon while Ramp approves/pays the pushed bill | Med | Archive-on-Carbon-settlement fires immediately via event subscription; Ramp bill visibility on the invoice; hold/release-hold endpoints available as a stronger guard if the race proves real in practice |
| Draft-bill API surface unverified (`remote_id` on drafts, submit→Pending-approval transition, draft line-item coding fidelity) | Med | Sandbox-verify before wiring into the sweep; fall back to mapping-table-only linking if `remote_id` unsupported |
| Enum ADD VALUE inside the same transaction as usage (Postgres restriction) | Med | Separate migration statements; ADD VALUE IF NOT EXISTS first, no same-txn use (plan verifies against deploy runner) |
| Currency: Ramp minor units vs Carbon decimals; multi-currency entities | Med | `minor_unit_conversion_rate` division + `round(…, currency.decimalPlaces)`; v1 posts in transaction currency with company exchange-rate lookup like purchase invoices |
| Webhook loss / out-of-order delivery | Low | Hourly sweep is the correctness floor; thin payloads always re-fetch state; mapping-table idempotency |
| Ramp rate limits during initial CoA push for large charts | Low | Batch 500, sequential pages, backoff on 429 |
| Period-close date shifts surprise controllers | Low | Shift recorded on the document + activity note (Ramp does the same) |

## Open Questions

> All resolved before writing (user answered the six research questions; sub-decisions were
> explicitly delegated and are marked for veto at the plan gate).

- [x] What document represents an unmatched card transaction? — **User:** NetSuite
      approach: new `cardTransaction` document with its own posting.
- [x] Statement-payment representation? — **Delegated:** `cardTransaction` type `Payment`
      (card-register model; `payment` requires a party and posts control accounts).
- [x] Reimbursements in v1? — **User:** yes. Mechanism — **Delegated:**
      employee-as-supplier invoices (+payments).
- [x] Repayments in v1? — **User (2026-08-20):** yes — `cardTransaction` type
      `Repayment`, expense-line reversal; confirm mechanism sandbox-verified in plan.
- [x] Which coding dimensions push to Ramp? — **User:** all except items, customers,
      suppliers (consequence: Carbon-side supplier resolution; add the rest later).
- [x] Sync direction scope? — **User:** both — Carbon POs/invoices push to Ramp; Ramp
      bills/payments/transactions pull into Carbon.
- [x] Auth model? — **User:** OAuth destination; client-credentials during development
      (schema supports both from day one).
- [x] Invoice→Ramp trigger? — **User (2026-08-20):** automatic push as submitted DRAFT
      bills; Ramp's own approval workflow decides approval (auto-approve rules or
      approver chains). Never `POST /bills` (auto-approved). Toggle `sync.pushInvoices`.
- [x] Cashbacks? — **Delegated:** in scope as `cardTransaction` type `Cashback`
      (statement-credit posting), gated on the income-account mapping being set.
- [x] Carbon-side sync-operation ledger? — **Delegated:** not in v1; Ramp's Accounting tab
      + `IntegrationSync` notification are the failure surface.
- [x] Multi-entity Ramp businesses? — **Delegated:** optional entity filter setting;
      default all entities.
- [x] Module/permission home? — **Delegated:** invoicing module, `invoicing_*` permissions
      (lesson: no new permission family).

## Changelog

- 2026-08-20: Created after research (`.ai/research/ramp-transaction-sync.md`) and user
  resolution of the six major design questions; delegated sub-decisions marked for veto.
- 2026-08-20 (later): Repayments moved INTO v1 scope per user — new `cardTransaction` type
  `Repayment`, `repaid_at`-cursor pull, expense-line reversal posting; Ramp-side confirm
  mechanism flagged sandbox-verify (no public `REPAYMENT_SYNC` sync_type).
- 2026-08-20 (later): Invoice→Ramp push changed from manual action to AUTOMATIC push as
  submitted draft bills per user — Ramp's approval workflow owns the approve/pay decision;
  added `sync.pushInvoices` toggle, archive-on-Carbon-settlement reverse flow,
  double-payment-race risk, and draft-API sandbox-verify items.
- 2026-08-20 (plan phase, precedent-driven amendments): (1) outbound push transport =
  sweep cursors, not event subscriptions (SYNC handler is ProviderID-locked); (2) new
  tables follow the `payment` sibling exactly — single-column `xid()` PK + UNIQUE
  (readableId, companyId), app-assigned readable id via `get_next_sequence`, RLS policies
  named SELECT/INSERT/UPDATE/DELETE on `invoicing_*`, Draft-gated DELETE — instead of the
  generic composite-PK template sketched earlier; (3) account-mapping settings render via
  the existing `dynamicOptions` mechanism in the integration drawer (first consumer);
  (4) v1 dimension push = cost centers (Carbon's one first-class AP-line coding dimension
  today) — further dimension types follow when Carbon grows them.
