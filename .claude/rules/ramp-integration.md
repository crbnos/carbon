---
paths:
  - packages/ee/src/ramp/**
  - packages/jobs/src/inngest/functions/integrations/ramp-sync.ts
  - packages/jobs/src/inngest/functions/integrations/ramp-sweep.ts
  - packages/database/supabase/functions/post-card-transaction/**
  - apps/erp/app/modules/invoicing/ui/CardTransaction/**
  - apps/erp/app/routes/x+/invoicing+/card-transactions*.tsx
  - apps/erp/app/routes/api+/webhook.ramp.$companyId.ts
---

# Ramp Integration

Carbon acts as Ramp's **accounting provider**. Ramp pushes card transactions, bills,
and reimbursements into Carbon's general ledger; Carbon pushes its chart of accounts and
cost centers to Ramp so spend gets coded there, and pushes purchase orders + vendor bills
back for matching. EE package `@carbon/ee`, subpath `@carbon/ee/ramp.server` (server-only
service + client) and `@carbon/ee/ramp/hooks.server` (lifecycle hooks). The `Ramp` config
descriptor is exported from `@carbon/ee` (`packages/ee/src/index.ts` `integrations[]`).

The direction that makes Ramp unusual: **coding lives in Ramp**. A customer categorizes a
transaction against Carbon's accounts inside Ramp's UI, marks it "ready to sync", and the
`ramp-sync` job pulls it into Carbon already coded — the opposite of the Xero/QBO/Rillet
providers, which own the data and mirror it out.

> **Live-verified 2026-08-28** (Ramp sandbox, scopes granted). Key corrections that
> came out of it — see `.ai/research/ramp-api-doc-verification.md` for the full record:
> - Transaction **`amount` is DEPRECATED and a major-unit (dollar) FLOAT** — read
>   `entity_amount.value` (signed integer minor-units/cents) instead. The old code read
>   `amount` as cents and understated every card charge 100×. `RampSignedAmount` =
>   `{ currency, value }`; `toMinorUnits` handles both it and `CurrencyAmount` (`{amount}`).
> - Transaction **coding lives on `line_items[].accounting_field_selections[]`** (mirrored
>   in `accounting_categories`), NOT top-level `accounting_field_selections` (which is `[]`).
>   The selection's **type is at `category_info.type`** (`GL_ACCOUNT`/`COST_CENTER`), its
>   `external_id` is the pushed Carbon `account.id`.
> - **`account` (chart of accounts) is companyGroup-scoped — NO `companyId` column** (PK is
>   `id` alone). Four sites had `.eq("companyId")` on `account` and all failed hard
>   (post-card-transaction, pushChartOfAccounts, ramp-sync account verification) — fixed to
>   `id`-only / `companyGroupId`.
> - `getJobDatabaseClient(5)` was poisoned by the accounting sweeps' `pool.end()` on the
>   shared pool ("Cannot use a pool after calling end on the pool") — fixed in `jobs/db.ts`.
> - **Foreign-currency charge** — FIXED + live-verified: Ramp line amounts are in the
>   MERCHANT currency but the header is settlement `entity_amount`, so
>   `buildTransactionLines` scales the lines to the settlement total via the shared
>   `scaleLinesToTotal` (residual on the largest line; no-op for same-currency).
> - **Outbound PO/bill push** — FIXED + live-verified (option B). PO create uses `external_id`
>   (not `remote_id`) with required `currency` + `entity_id` (resolved from `metadata.entityId`
>   or the business's first entity) + `three_way_match_enabled: false`; line items use
>   `external_id` + `unit_quantity`. The PO/bill `vendor_id` is a **Ramp SPEND vendor**
>   (`POST /vendors`), NOT an accounting vendor — `resolveOrCreateRampSpendVendor` matches by
>   `external_vendor_id`/name then CREATES one with the supplier's synced purchasing-contact
>   email + `country` + `state` (US requires it) and `business_vendor_contacts` as a **single
>   object** (plural name, `allOf` of one). `loadRampVendorSuppliers` batches the
>   supplier→purchasing-contact/address embed. `archiveBill` now `DELETE /bills/{id}` (bills
>   have no `/archive`). Webhook signing encoding is the one thing the public docs don't cover.

## Pieces

- **Config** — `packages/ee/src/ramp/config.tsx`: `defineIntegration` (id `"ramp"`,
  category "Spend Management", `active: true`). `RampSettingsSchema` is flat: connection
  (`clientId`, optional `clientSecret` — blank means "keep the vaulted secret",
  `environment` production|sandbox, optional `entityId`), account mapping
  (`cardLiabilityAccountId` + `statementBankAccountId` **required**;
  `cashbackIncomeAccountId`, `reimbursementBankAccountId` optional), and five sync
  toggles (`pullTransactions`, `pullBills`, `pullReimbursements`, `pushPurchaseOrders`,
  `pushInvoices`, all default `"true"`). Renders `SetupInstructions` with the webhook URL
  `${origin}/api/webhook/ramp/${companyId}` — **see "The webhook route" below.**
- **Client** — `lib/client.ts`: `RampClient` over the Ramp Developer API v1. Host is
  `https://api.ramp.com` (production) or `https://demo-api.ramp.com` (sandbox), chosen
  from `credentials.environment`. `client_credentials` grant mints/caches a bearer token
  (`POST /developer/v1/token`, Basic auth, re-mint under 60s remaining); `oauth2` returns
  the stored token and throws if expired (refresh not implemented). `listPaginated`
  drains cursor pages (`page.next`, `page_size=100`) parsing each row with a passthrough
  zod schema. Errors: `RampApiError` (parses the `error_v2` envelope) and
  `RampRateLimitError` (429 → parsed `Retry-After`); **no in-client retries** — retries
  live at the Inngest job layer. `buildRampIdempotencyKey({companyId, operation, scope})`
  = sha256, a clone of `buildRilletIdempotencyKey`.
- **Models** — `lib/models.ts`: passthrough zod schemas for every Ramp object Carbon
  reads (transactions, bills+payments, transfers, cashbacks, reimbursements, repayments,
  vendors, POs, entities, webhook events, sync results). `RampCurrencyAmount` is
  `{ amount: int (MINOR units), currency_code }`; `fromMinorUnits(amount, code, decimals)`
  converts to major units through the shared precision `round` (`decimals` is
  `currency.decimalPlaces`, never a literal). `RampIntegrationMetadataSchema` is the shape
  stored on `companyIntegration.metadata` (see Metadata below). `RampCredentialsSchema` is
  a discriminated union on `type` (`client_credentials` | `oauth2`).
- **Service** — `lib/service.ts` (`@carbon/ee/ramp.server`): the server-only glue. Every
  function takes a **service-role** supabase client + `companyId`, resolves vaulted
  secrets (`resolveIntegrationSecrets`), and builds a `RampClient`. Key exports:
  `getRampIntegration`, `ensureRampConnection`, `pushChartOfAccounts`, `pushCostCenters`,
  `ensureRampWebhook`, `completeWebhookVerification`, `advanceRampCursor`, `confirmSyncs`,
  `resolveRampSupplier`, `resolveEmployeeSupplier`, `scaleRepaymentLines` (pure),
  `pushPurchaseOrder`, `pushInvoiceDraftBill`, `archiveRampBillForInvoice`. Plus pure
  helpers `rampClassificationForClass` and `chunk`.
- **Webhook signature** — `lib/webhook.ts`: `verifyRampWebhookSignature({signature, body,
  secret})` — HMAC-SHA256 over the RAW body, base64, constant-time compare, fail-closed.
  Consumed by the webhook route (see "The webhook route" below).
- **Hooks** — `hooks.server.ts`: `rampOnInstall` / `rampOnUpdate` / `rampOnUninstall` /
  `rampHealthcheck`, registered in `packages/ee/src/hooks.server.ts` under `ramp`. Cloned
  from the Rillet hook shape.

## Install / converge (hooks.server.ts)

`convergeRamp` runs on install (with a fired initial sync) and on every settings save
(`onUpdate`, no initial sync): validate credentials up front via `client.getBusiness()`
(a bad client id/secret fails the install with a clear message), then
`ensureRampConnection` → `pushChartOfAccounts` → `pushCostCenters` → `ensureRampWebhook`.
Install additionally fires `trigger("ramp-sync", { companyId, reason: "install" })` — and
does so through a **lazy runtime `import("@carbon/jobs")`** because `jobs → ee` is the only
allowed dependency direction (ee must never import jobs).

- `pushChartOfAccounts` pushes active, non-group accounts as Ramp coding options
  (`POST /accounting/accounts`, `id` = Carbon `account.id`, batched at
  `RAMP_ACCOUNTS_BATCH_SIZE = 500`). The card-liability account is classified `CREDCARD`;
  otherwise `rampClassificationForClass` maps Carbon `glAccountClass` → Ramp
  `classification` (Asset→ASSET, etc.); an unclassifiable account is skipped.
- `pushCostCenters` pushes `costCenter` rows as one `SINGLE_CHOICE` coding field
  (`id: "carbon-cost-center"`); skips silently when the table is empty/unreadable.
- `ensureRampWebhook` is idempotent (skips when `metadata.webhookId` set); on create it
  persists `webhookId` to the plaintext metadata column and the returned signing `secret`
  to the vault (`webhookSecret`) via `persistIntegrationSecrets` (the vault RPC REPLACES,
  so the full secret bag is re-vaulted).
- `rampOnUninstall` best-effort deletes the webhook and the accounting connection
  (tolerating already-gone). `rampHealthcheck` = `getBusiness()` succeeds AND at least one
  accounting connection is `linked`/`active`/`connected`.

## Metadata (`companyIntegration.metadata`, id `ramp`)

`RampIntegrationMetadata`: `credentials` (vaulted secrets resolved on read),
`cardLiabilityAccountId`, `statementBankAccountId`, `cashbackIncomeAccountId`,
`reimbursementBankAccountId`, `entityId`, `connectionId`, `webhookId`, `webhookSecret`,
`sync` (the five flags), and **`cursors`**:
`cursors.repaymentsRepaidAt`, `cursors.purchaseOrderPushUpdatedAt`,
`cursors.invoicePushUpdatedAt`. Non-secret keys (`connectionId`, `webhookId`, cursors)
are written via a read-merge-write against the raw metadata column
(`updateStoredRampMetadata` / `advanceRampCursor`) so no sibling key or vaulted secret is
clobbered; secret keys go through `persistIntegrationSecrets`.

## The sync loop (`ramp-sync.ts`, Inngest)

`rampSyncFunction` (id `ramp-sync`, event `carbon/ramp-sync`, trigger key `"ramp-sync"` in
`packages/lib/src/trigger.ts`; `retries: 2`, `concurrency: { key companyId, limit 1 }`).
One function per company; each Ramp **family** is its own `step.run` wrapped in try/catch
so one family's failure never aborts the others (FAMILY-FAILURE ISOLATION). Families, in
order:

| Step | Family | Becomes | syncType (confirm) |
|------|--------|---------|--------------------|
| `ramp-card-transactions` | transactions `sync_status=SYNC_READY` | `cardTransaction` Charge/Credit | `TRANSACTION_SYNC` |
| `ramp-transfers` | transfers `SYNC_READY` | `cardTransaction` Payment | `TRANSFER_SYNC` |
| `ramp-cashbacks` | cashbacks `SYNC_READY` | `cardTransaction` Cashback | `STATEMENT_CREDIT_SYNC` |
| `ramp-bills` | bills (`sync_ready`, not-synced) | posted `purchaseInvoice` | `BILL_SYNC` |
| `ramp-bill-payments` | paid bills' `payment` | AP `payment` + `invoiceSettlement` | `BILL_PAYMENT_SYNC` |
| `ramp-reimbursements` | reimbursements `SYNC_READY` | `purchaseInvoice` (Employee supplier) | `REIMBURSEMENT_SYNC` |
| `ramp-repayments` | repayments (`from_repaid_at` cursor) | `cardTransaction` Repayment | *(no Ramp confirm)* |
| `ramp-outbound` | Carbon POs + posted invoices | Ramp POs + draft bills; archive settled | *(no confirm)* |

Card families create a **Draft** `cardTransaction` (+ lines), post it via the
`post-card-transaction` edge function, link the mapping, and attach Ramp receipts
(non-fatal). Bills/reimbursements insert a Draft `purchaseInvoice` (or convert a mapped
PO for a PO-linked bill) and post it via `post-purchase-invoice`; bill payments and
Ramp-paid reimbursements post an AP `payment` via `post-payment`. All writes attribute to
`"system"`. Gating: `metadata.sync.pull*` flags; `cardLiabilityAccountId` (required for
every card family); `statementBankAccountId` (transfers, bill payments, repayments);
`cashbackIncomeAccountId` (cashbacks). Amounts come from `fromMinorUnits`; the currency's
`decimalPlaces` is read once per code and cached.

Coding: `codeSelections` reads a Ramp `accounting_field_selections` list — the first
`GL_ACCOUNT` selection's `external_id` (the Carbon `account.id` Carbon pushed) wins for the
account, the first `COST_CENTER` for the cost center. A line coded to an account Carbon
can't find (verified against `account` in one `.in()` query) fails that item as "uncoded"
without creating anything.

### Confirm semantics (`confirmSyncs`)

After each card/bill/reimbursement family drains, it `POST /accounting/syncs` with
`sync_type`, an idempotency key (`buildRampIdempotencyKey` over
`(companyId, syncType, sha256(sorted ids))` — a retried confirm can't double-apply),
`successful_syncs` (`{id, reference_id, deep_link_url?}`), and `failed_syncs`
(`{id, message}`). A family confirms whatever it managed to gather **even if its own drain
threw partway** (the confirm is outside the drain's try/catch). An empty batch is skipped.
**Repayments and the outbound families have no Ramp confirm** — their idempotency IS the
`externalIntegrationMapping` / the cursor.

### Idempotency (mapping-guarded)

An already-synced Ramp item is detected via its `externalIntegrationMapping` and
re-confirmed only, never re-created. `mapping.link(...)` is written **before** the confirm,
so a retry (SYNC_READY still lists the item until Ramp records the confirm) short-circuits
on the mapping. Entity-type reuse per family: card families → `cardTransaction`
(repayments key it as `repayment:<id>`); bills + reimbursements → `bill` (distinct id
spaces); bill payments → `payment`.

### Dedupe / short-circuit rules

- **Bills** (`syncBill`): mapping-first; then Carbon-born short-circuit (`bill.remote_id`
  resolves to an existing `purchaseInvoice` → link + skip); then a duplicate guard on
  `(supplierId, supplierReference)` → link + skip; PO-linked bills convert the first mapped
  Carbon PO via the `convert` edge function.
- **Bill payments** (`syncBillPayment`): a bill paid by a **Ramp card** (`payment_method`
  in `CARD_PAYMENT_METHODS`) is **confirmed WITHOUT posting an AP payment** — the card
  spend already routes through the card-transaction sync, so posting a payment would
  double-count. Non-card payments post the AP payment that closes the invoice.
- **Suppliers** (`resolveRampSupplier`): mapping-first (`vendor` entityType) → case-
  insensitive exact `supplier.name` match → auto-create. `resolveEmployeeSupplier`
  (reimbursements/repayment users) does the same but ensures an "Employee" `supplierType`
  and names the supplier `"<First> <Last> (<email>)"`.

### Repayments (cursor-driven)

There is no Ramp confirm for repayments, so the `metadata.cursors.repaymentsRepaidAt`
high-water mark IS the idempotency. `computeRepaymentCursor` advances to
`min(max(processed), min(failed) − 1s)` so a failed item is re-listed next sweep — the
cursor only advances over provably-covered work. Each repayment scales its ORIGINAL card
transaction's coding lines by `repaymentAmount / originalAmount` via the pure
`scaleRepaymentLines` (rounding residual lands on the largest-magnitude line so the scaled
lines sum EXACTLY to the header — the invariant `post-card-transaction` asserts). Funding:
`STATEMENT_CREDIT` offsets the card liability; otherwise the statement bank account.

### Outbound: the draft-bill-only rule

`ramp-outbound` (gated by `pushPurchaseOrders` / `pushInvoices`) is cursor-driven
(`purchaseOrderPushUpdatedAt` / `invoicePushUpdatedAt`, same failed-holds-back shape):

- **POs** (`pushPurchaseOrder`): Completed/Closed mapped POs are archived; released POs
  ensure a Ramp vendor then create (carrying `remote_id: po.id` for Ramp's bill-matching)
  or PATCH.
- **Invoices** (`pushInvoiceDraftBill`): posted invoices still Open/Partially Paid, not
  already mapped in either direction, not an Employee-supplier reimbursement, are pushed
  as a **draft bill then SUBMITted** (`POST /bills/drafts` + `/submit`, landing in Ramp
  "Pending approval"). **An auto-approved `POST /bills` is NEVER used** — draft + submit
  only, so a human approves in Ramp. Best-effort attaches the invoice PDF.
- **Archive-on-settlement**: a pushed bill whose Carbon invoice is now Paid/Voided is
  archived and the mapping stamped `archived: true` so it never re-fires.

If any family leaves failures, a final `ramp-notify-failures` step sends one in-app
`NotificationEvent.IntegrationSync` to the integration's configurer (`updatedBy`, unless
`"system"`).

## The sweep (`ramp-sweep.ts`)

`rampSweepFunction` (id `ramp-sweep`, cron `0 * * * *` hourly, `retries: 2`): lists every
company with an ACTIVE `ramp` integration and fires one `carbon/ramp-sync`
(`reason: "sweep"`) each. **Webhooks are latency; the sweep is correctness** — a missed or
disabled webhook delivery becomes ≤1h of staleness, never permanent loss. `ramp-sync` is
idempotent, so re-firing is safe.

## cardTransaction schema (migration `20260820143726_ramp-integration.sql`)

A payment-shaped document that **deliberately mirrors the `payment` sibling**, NOT the
composite-PK table template: **single-column TEXT PK** (`xid()`), Draft→Posted→Voided
lifecycle. Migration also seeds the `integration` registry row (`ramp`), adds the journal
enum values `'Card Transaction'` (to `journalEntrySourceType` + `journalLineDocumentType`),
the `cardTransactionType` (Charge/Credit/Payment/Cashback/Repayment) and
`cardTransactionStatus` (Draft/Posted/Voided) enums, and a per-company `cardTransaction`
sequence (`CARD-%{yyyy}-%{mm}-`). The migration is **not transactional and must be
idempotent** (every statement guarded) — the deploy runner retries a failed file over
partial state.

- `cardTransaction`: `cardTransactionId` (readable, unique per company), `type`, `status`,
  `integration` (default `'ramp'`), `cardAccountId` (NOT NULL FK `account`), `offsetAccountId`
  (nullable FK), merchant/holder/last4/memo, `transactionDate`/`postingDate` (DATE),
  `currencyCode`, `exchangeRate`, `amount` (`>= 0`), `journalId`, posted/voided audit.
  CHECK: Payment/Cashback/Repayment require an `offsetAccountId`; Charge/Credit use lines.
- `cardTransactionLine`: codes an `amount` to an `accountId` (+ optional `costCenterId`),
  `sequence`, `ON DELETE CASCADE` from the header.
- RLS on both is gated by the **invoicing** module permissions (mirrors `payment` /
  `invoiceSettlement`). DELETE is restricted to `Draft`; line writes additionally require
  the parent header to be Draft.

## post-card-transaction edge function

`packages/database/supabase/functions/post-card-transaction/` (registered in
`config.toml`, `verify_jwt = true`). `{ type: "post" | "void", cardTransactionId, userId,
companyId }`. Kysely transaction with a `FOR UPDATE` lock + status re-assert (TOCTOU guard).

- **post**: only from Draft. Resolves the accounting period (shifts a Locked/Closed period
  forward to the next open period, writing the shifted `postingDate` back). When
  `companySettings.accountingEnabled`, builds the journal (`sourceType`/`documentType`
  `'Card Transaction'`) and writes cost-center `journalLineDimension`s; flips the row to
  Posted with `journalId`. Accounting-off = Posted with no journal.
- **void**: only from Posted. Emits a reversing journal (negated amounts, carrying the
  original lines' dimensions) and flips to Voided.

### The journal builder (`build-card-transaction-journal.ts`)

Pure, unit-testable, golden-master-pinned. Amounts are **natural-balance-signed** via
`credit()`/`debit()` (a balanced entry has debits == credits and does NOT sum to zero in
stored `amount`; a separate debit(+)/credit(−) total is asserted ~0 within
`BALANCE_TOLERANCE = 0.01`). Both sides scale by `exchangeRate` to base currency. The card
account is **always booked as a LIABILITY** (a credit card is money owed). The five types:

| Type | Journal |
|------|---------|
| **Charge** | line accounts **debited** (their class); card liability **credited** for the total. Requires lines summing to the header. |
| **Credit** | mirror of Charge — line accounts credited; card liability debited (refund/return). |
| **Payment** | card liability **debited**; the offset (bank asset) **credited** — statement payment pays down the card. |
| **Cashback** | card liability **debited**; the offset **credited as REVENUE** (a rebate is income), whatever the offset's class. |
| **Repayment** | offset (bank asset or card liability, per funding) **debited** for the total; each line account **credited**. Requires lines summing to the header. |

## ERP UI (invoicing module)

- Routes: `card-transactions.tsx` (list, loader `getCardTransactions`, filters
  search/type/status), `card-transactions.$id.tsx` (read-only Drawer detail with lines +
  receipts + a **Void** action for Posted rows, `update: "invoicing"`),
  `card-transactions.$id.void.tsx` (action → service-role `functions.invoke(
  "post-card-transaction", { type: "void" })`).
- Components: `apps/erp/app/modules/invoicing/ui/CardTransaction/` —
  `CardTransactionsTable.tsx`, `CardTransactionStatus.tsx`, `index.ts`. Service:
  `getCardTransaction` / `getCardTransactions` in `invoicing.service.ts`.

## The webhook route

`apps/erp/app/routes/api+/webhook.ramp.$companyId.ts` (`runtime: "nodejs"` for the
constant-time HMAC) is what Ramp POSTs to. A delivery is a **nudge, not data**: after
verification it fires the same `trigger("ramp-sync", { reason: "webhook" })` the sweep
fires, so the sync body re-derives everything and a lost delivery is only latency. Flow:
`getRampIntegration` (404 when not installed/active; resolves the vaulted `webhookSecret`)
→ **challenge handshake** (a `challenge` in the body or `?challenge=`, handled BEFORE
signature since a verification probe may be unsigned — calls `completeWebhookVerification`
AND echoes `{ challenge }`) → **signature verify** (`x-ramp-signature` header +
`verifyRampWebhookSignature`, fail-closed 401 without a stored secret or valid signature) →
parse `RampWebhookEventSchema` (unrecognized events acked, never rejected) →
`trigger("ramp-sync")`. The exact Ramp header name, signing encoding, and challenge shape
are `// TODO(task-1)` (sandbox-unverified defaults). The **hourly `ramp-sweep` remains the
correctness guarantee**; the webhook is latency only.

## Caveats & not-yet-built

- **One active connection per company.** The metadata carries a single `connectionId` /
  `webhookId`; `ensureRampConnection` creates one connection (`remote_provider_name:
  "Carbon"`) and reuses it — there is no multi-connection support.
- **Sandbox** = `demo-api.ramp.com` (`RAMP_SANDBOX_HOST`), selected by the
  `environment: "sandbox"` setting. Client-credentials tokens are minted per host.
- **`// TODO(task-1)` field-name uncertainties**: numerous Ramp API strings/shapes
  (sync-status values, `payment_method`/reimbursement-`state`/repayment-`status` enums,
  bill `vendor` shape, whether transaction `amount` is minor-units, several POST bodies,
  the webhook signing encoding) are documented defaults pending live-sandbox verification.
  Grep `TODO(task-1)` in `packages/ee/src/ramp/**` and `ramp-sync.ts` before relying on a
  specific value.
- There is **no `apps/erp/app/modules/invoicing/AGENTS.md`** to cross-reference.
- **User-facing docs (`docs/`) are a separate follow-up** — not written here.
