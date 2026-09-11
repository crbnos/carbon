---
paths:
  - packages/ee/src/ramp/**
  - packages/jobs/src/inngest/functions/integrations/ramp-sync*.ts
  - packages/jobs/src/inngest/functions/integrations/ramp-sweep.ts
  - packages/database/supabase/functions/post-card-transaction/**
  - apps/erp/app/modules/invoicing/ui/CardTransaction/**
  - apps/erp/app/routes/x+/invoicing+/card-transactions*.tsx
  - apps/erp/app/routes/api+/integrations.ramp.oauth.ts
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
>   `{ currency, value }`; `parseVerifiedRampMinorAmount` accepts the verified integer-minor
>   object shapes, while `normalizeRampCardTransactionAmount` handles that preferred field
>   and the deprecated major-unit card fallback without conflating their units.
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
>   `scaleLinesToTotal`. It uses the canonical bounded Hamilton allocator so no line
>   absorbs more than one minor unit of residual; same-currency input is a no-op.
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
  category "Spend Management", active only when public `RAMP_CLIENT_ID` is configured).
  The UI connection is the production OAuth `oauth` block; the form carries no customer
  client credentials. `RampSettingsSchema` is flat: optional `entityId`, account mapping
  (`cardLiabilityAccountId` + `statementBankAccountId` **required**;
  `cashbackIncomeAccountId`, `reimbursementBankAccountId` optional),
  `codingAccountScope` (`"expense"` default | `"all"` — which accounts Ramp's coding
  picker offers, see "Coding" below), and five sync toggles (`pullTransactions`,
  `pullBills`, `pullReimbursements`, `pushPurchaseOrders`, `pushInvoices`, all default
  `"true"`). Renders `SetupInstructions` with the webhook URL
  `${origin}/api/webhook/ramp/${companyId}` — **see "The webhook route" below.**
- **Client** — `lib/client.ts`: `RampClient` over the Ramp Developer API v1. Host is
  `https://api.ramp.com` (production) or `https://demo-api.ramp.com` (sandbox), chosen
  from `credentials.environment`. `client_credentials` grant mints/caches a bearer token
  (`POST /developer/v1/token`, Basic auth, re-mint under 60s remaining). `oauth2` exchanges
  authorization codes and refreshes within the same margin; `buildRampClient` supplies the
  Carbon OAuth app plus an `onTokensRefreshed` callback that atomically persists the new
  access token and expiry. Ramp does not rotate the refresh token. `listPaginated`
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
- **Server domains** — `lib/service.ts` is a stable compatibility facade, not an
  implementation monolith. `connection.ts` owns metadata reads, client construction, OAuth
  exchange and the accounting connection; `chart-of-accounts.ts` and `cost-centers.ts` own
  coding-master convergence; `suppliers.ts` owns accounting/merchant/employee supplier
  resolution; `spend.ts` owns Ramp spend vendors, PO push and draft-bill push/archive;
  `sync-confirmation.ts` owns confirm payloads; `webhooks.ts` owns remote webhook lifecycle;
  and `state.ts` owns atomic metadata/Vault patches. `lib/index.ts` plus the facade preserve
  the public `@carbon/ee/ramp.server` contract. Pure allocation, coding, money and signature
  helpers remain in their named modules. Service-role operations take the caller's client and
  company id; pure helpers do not pretend to require database context.
- **Webhook signature** — `lib/webhook.ts`: `verifyRampWebhookSignature({signature, body,
  secret})` — HMAC-SHA256 over the RAW body, base64, constant-time compare, fail-closed.
  Consumed by the webhook route (see "The webhook route" below).
- **Hooks** — `hooks.server.ts`: `rampOnInstall` / `rampOnUpdate` / `rampOnUninstall` /
  `rampHealthcheck`, registered in `packages/ee/src/hooks.server.ts` under `ramp`. Cloned
  from the Rillet hook shape.

## Auth: signed Connect flow + token refresh

`RampCredentialsSchema` (`lib/models.ts`) retains both `client_credentials` and `oauth2`
for stored-data compatibility, but the settings UI exposes only OAuth Connect.

- **OAuth "Connect to Ramp" (production, primary)**: `config.tsx` declares an
  `oauth` block, so `IntegrationCard` renders a one-click Connect that redirects
  to `https://app.ramp.com/v1/authorize` (scopes incl. `offline_access`). The settings
  loader first calls `issueOAuthState({integrationId:"ramp",userId,companyId})` from
  `@carbon/auth/oauth-state.server`; the random nonce and binding fields live in the
  signed, HttpOnly, 10-minute `carbon-oauth-state` cookie. The callback consumes and
  destroys that cookie before code exchange, rejecting expiry, replay, or integration/
  user/company mismatch with stable `invalid-state` UI copy. It then calls
  `exchangeRampOAuthCode` → `patchRampOAuthCredentials` → `rampOnInstall`. The patch
  replaces only OAuth-owned paths, preserves settings/runtime state, and stores access +
  refresh tokens in Vault. Account mapping happens afterwards in the Details drawer.
  Carbon's OAuth app id/secret
  are env (`RAMP_CLIENT_ID`/`RAMP_CLIENT_SECRET`), read lazily from `process.env`
  in `connection.ts` (never `import "@carbon/env"` there — it eagerly validates
  unrelated required vars and breaks server-only tests).
- **Token refresh**: `RampClient.getAccessToken` runs the `refresh_token` grant
  when an oauth2 access token is within the refresh margin. Ramp does NOT rotate
  refresh tokens, so the `onTokensRefreshed` hook (wired in `getRampIntegration`)
  persists the new access token + expiry only. The OAuth app creds are passed
  into `RampClient` via its `RampClientOptions` (client.ts stays env-free — it is
  client-bundled). Pinned by `lib/__tests__/client.test.ts`.
- **Legacy client credentials**: `RampClient` can still read existing
  `client_credentials` metadata, but `RampSettingsSchema` has no id/secret fields and the
  UI cannot create a new client-credentials install.

## Install / converge (hooks.server.ts)

`convergeRamp` runs on install and every settings save. It validates credentials with
`client.getBusiness()`, ensures the accounting connection, and best-effort registers the
webhook first. A fresh OAuth callback has no required accounts, so it returns here: it does
**not** push master data or start financial sync before both `cardLiabilityAccountId` and
`statementBankAccountId` exist. Once configured, it validates an optional `entityId`, pushes
CoA/cost centers, and fires `trigger("ramp-sync", {companyId, reason})`. A reconnect whose
atomic OAuth patch preserved valid mappings may therefore converge immediately. The trigger
uses a lazy runtime `import("@carbon/jobs")` because `jobs → ee` is the dependency direction.

- `pushChartOfAccounts` pushes active, non-group accounts as Ramp coding options
  (`POST /accounting/accounts`, `id` = Carbon `account.id`, batched at
  `RAMP_ACCOUNTS_BATCH_SIZE = 500`). The card-liability account is classified `CREDCARD`;
  otherwise `rampClassificationForClass` maps Carbon `glAccountClass` → Ramp
  `classification` (Asset→ASSET, etc.); an unclassifiable account is skipped.
  The POST item is built by `toRampGlAccountPayload` — the Carbon-side `visible` flag must
  never reach the wire (Ramp 422 DEVELOPER_7001 "Unknown field" rejects the whole batch).
  **Picker scope**: `isCodableAccount` decides whether an account is selectable —
  under the default `codingAccountScope: "expense"` only Expense-class accounts plus
  the card-liability account are; the rest are never created, and ones already in
  Ramp are `PATCH`ed `visibility: "HIDDEN"` once (visibility is part of the mapping
  fingerprint, so a Ramp-side manual change survives until Carbon's rule changes).
  Ramp's native GL-account field keeps Ramp's own label; only its contents shrink.
- `pushCostCenters` converges `costCenter` rows into ONE custom `SINGLE_CHOICE` field
  (remote `id: "carbon-cost-center"`, `RAMP_COST_CENTER_FIELD_ID` in `lib/coding.ts`)
  whose `name`/`display_name` are the company group's CostCenter **`dimension.name`**
  (the customer's word for the concept — "Project" for a project-tracking customer —
  which also names the Rillet Field). It is a true diff, not a blind post:
  `GET /accounting/fields?remote_id=` (create with **`id`** when absent — the POST is
  idempotent by `id`; PATCH the name only when Carbon's changed since the last push),
  then `GET /accounting/field-options?field_remote_id=` and the pure
  `diffCostCenterOptions` → create (`{ id: costCenter.id, value }` against
  `field_id: ramp_id`, ≤500 per batch), rename (`display_name`, falling back from
  `value`), hide removed (`visibility: "HIDDEN"`, never delete) and re-show restored.
  Tracked in `externalIntegrationMapping` (`costCenter` per option, `costCenterField`
  for the field) with fingerprints. `POST /field-options` is all-or-nothing and
  rejects existing options — which is why the old blind re-post failed on every
  second run and silently never pushed a cost center added after install. It first
  calls `ensureCostCenterDimension`, creating the group's active `CostCenter`
  dimension row if missing (nothing else seeds one for groups created after the
  `20260228024512` backfill). Runs on install / settings save AND as the
  `ramp-cost-centers` step of every `ramp-sync`, so a new cost center reaches Ramp
  within ≤1h.
- Every purchase invoice the sync creates (bill AND reimbursement) gets its required
  `purchaseInvoiceDelivery` row in the same database transaction as the header, lines, and
  mapping — `post-purchase-invoice` reads it with `.single()` and refuses to post without it.
  Standalone invoices use a bare delivery; a single-PO bill preserves the mapped order's
  delivery metadata. The demo sandbox's bills and reimbursements were uncoded when this was
  implemented, so the complete inbound pull still needs live verification.
- `ensureRampConnection` only CREATES (when `metadata.connectionId` is unset). A fresh Carbon
  DB pointed at a Ramp business that already has a Carbon connection (a re-install, a new
  worktree against the sandbox) fails the install hook — adopt the existing connection id
  (`GET /accounting/connection`) into `metadata.connectionId` by hand until it self-heals.
- `ensureRampWebhook` is idempotent (skips when `metadata.webhookId` set); on create it
  writes `webhookId` and the vaulted `webhookSecret` together through `patchRampWebhook`.
- `rampOnUninstall` best-effort deletes the webhook and the accounting connection
  (tolerating already-gone), then `clearRampConnectionState` removes connection/webhook
  ids and the webhook secret without disturbing OAuth credentials/settings/cursors.
  `rampHealthcheck` = `getBusiness()` succeeds AND at least one
  accounting connection is `linked`/`active`/`connected`.

## Metadata (`companyIntegration.metadata`, id `ramp`)

`RampIntegrationMetadata`: `credentials` (access/refresh/client secrets vaulted and resolved on read),
`cardLiabilityAccountId`, `statementBankAccountId`, `cashbackIncomeAccountId`,
`reimbursementBankAccountId`, `entityId`, `connectionId`, `webhookId`, `webhookSecret`,
`sync` (the five flags), and **`cursors`**:
`cursors.repaymentsRepaidAt`, `cursors.purchaseOrderPushUpdatedAt`,
`cursors.invoicePushUpdatedAt`.

All Ramp writes go through `upsert_company_integration_patch`, exposed by
`patchIntegrationState` and the operation-specific functions in `lib/state.ts`. The RPC is
service-role-only, takes flat dot-path patch/removal maps, advisory-locks the logical
`(companyId,integrationId)` key, locks an existing row, and writes plaintext metadata,
Vault, `secretRef`, activation, and audit fields in one PostgreSQL transaction. Settings
owns only entity/account/scope/toggle paths; OAuth owns its credential set; refresh owns
access token + expiry; connection/webhook and each cursor own only their paths. Never
reintroduce raw read/merge/write or a whole-object Vault replacement.

## The sync loop (`ramp-sync*.ts`, Inngest)

`ramp-sync.ts` is the thin durable coordinator for `rampSyncFunction` (id `ramp-sync`, event
`carbon/ramp-sync`, trigger key `"ramp-sync"` in `packages/lib/src/trigger.ts`; `retries: 2`,
`concurrency: { key companyId, limit 1 }`). It creates `RampSyncContext`, runs the fixed
`step.run` sequence, totals failures, and notifies. Business workflows live in
`ramp-sync-card.ts`, `ramp-sync-bill.ts`, `ramp-sync-reimbursement-family.ts`,
`ramp-sync-repayment.ts`, and `ramp-sync-outbound.ts`; shared tenant/currency/file helpers
live in `ramp-sync-shared.ts`. Pure policy and cursor contracts remain in their dedicated
files. Transactional staging/resume lives in `ramp-sync-card-stage.ts`,
`ramp-sync-bill-stage.ts` (with PO-line policy in `ramp-sync-bill-po.ts`),
`ramp-sync-payment.ts`, and `ramp-sync-reimbursement.ts`.
Family modules contain their own failure isolation, so one family does not abort the others;
drain exceptions increment that family's `failed` count and appear in its `error`, while
confirm failures appear as `confirmError` and are included in the coordinator's final issue
total. Durable steps remain, in order:

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

Card families use `stageOrResumeRampCardTransaction` to advisory-lock the company/Ramp id
and atomically create or resume the **Draft** `cardTransaction`, lines, and mapping before
posting it through `post-card-transaction`. A missing or ambiguous edge response succeeds
only when a tenant-scoped reread observes `Posted`; Ramp receipts are then stored on the
Carbon transaction best-effort. Bills likewise use `stageOrResumeRampBill` to atomically
stage the supplier interaction, Draft `purchaseInvoice`, delivery, lines, and mapping
before `post-purchase-invoice`; an ambiguous response is accepted only after observing
`Posted`. Bill payments delegate to
`syncRampBillPayment` in `ramp-sync-payment.ts`: the Draft payment, settlement, and Ramp
mapping are staged atomically, the stored source-FX snapshot is retained on resume, and
success requires a tenant-scoped reread showing Posted. Reimbursements delegate to
`syncRampReimbursement` in `ramp-sync-reimbursement.ts`: a company/Ramp-id advisory lock
serializes the atomic supplier-interaction + Draft invoice + delivery + lines + mapping
stage, and Ramp-paid rows also require their AP payment to be observably Posted before
confirm. All writes attribute to `"system"`. Gating: `metadata.sync.pull*` flags;
`cardLiabilityAccountId` (required for
every card family); `statementBankAccountId` (transfers, bill payments, repayments);
`cashbackIncomeAccountId` (cashbacks). A configured `entityId` is enforced locally on
every inbound row before mapping or writes; only endpoints with a verified query contract
receive the remote `entity_id` filter. Amounts use their verified wire shape: signed and
currency amounts are integer minor units, while the deprecated card-transaction fallback
is a major-unit decimal. Missing, non-finite, fractional-minor, currency-mismatched, or
ambiguous values fail that item instead of becoming zero. The currency's authoritative
`decimalPlaces` is read once per code and cached.

**FX (foreign-per-base convention).** `exchangeRate` everywhere here is the
`get_exchange_rate` foreign-per-base rate (`getRampExchangeRate(ctx, code)`, cached;
base → 1). A missing/invalid currency precision or exchange rate fails the affected
item; Ramp sync never guesses two decimals or posts foreign currency at par. The card
journal converts document→base by DIVIDING via the shared `toBaseAmount`
(`build-card-transaction-journal.ts`) — NOT multiplying. Standalone inbound bill and
reimbursement lines use quantity one and write the document amount to
`purchaseInvoiceLine.supplierUnitPrice`; a linked-PO bill preserves its covered quantity and
stores `supplierUnitPrice = document amount / covered quantity`. Both forms store the
resolved `exchangeRate` on header and lines (NEVER write the generated `unitPrice`/
`totalAmount`, which are `supplier* / exchangeRate`); `post-purchase-invoice` then posts the
generated base `unitPrice`.
Outbound pushes send DOCUMENT currency under the `currency`/`invoice_currency`
label — PO push uses `purchaseOrderLine.supplierUnitPrice` (already document),
draft-bill push converts the generated base `totalAmount` back via
`toDocumentAmount(total, rate, decimals)`.

Coding: `codeSelections` (pure, `packages/ee/src/ramp/lib/coding.ts`, unit-tested) reads a
Ramp `accounting_field_selections` list — the first `category_info.type === "GL_ACCOUNT"`
selection's `external_id` (the Carbon `account.id` Carbon pushed) wins for the account; the
first selection whose **`category_info.external_id === "carbon-cost-center"`** wins for the
cost center. A CUSTOM field has no `type` at creation, so its selections come back typed
`OTHER` — matching the native `COST_CENTER` enum (what the code did until 2026-09-10)
never fires and dropped every project tag silently. A line coded to an account Carbon
can't find (verified against `account` in one `.in()` query) — or to a cost center Carbon
can't find (`verifyCostCenters`, one company-scoped `.in()` query) — fails that item as
"uncoded" without creating anything; the tag is never dropped.

### Confirm semantics (`confirmSyncs`)

After each card/bill/reimbursement family drains, it `POST /accounting/syncs` (body built by
the pure `buildSyncConfirmBody`) with `sync_type`, an idempotency key (`buildRampIdempotencyKey` over
`(companyId, syncType, sha256(sorted ids))` — a retried confirm can't double-apply),
`successful_syncs` (`{id, reference_id, deep_link_url?}`), and `failed_syncs`
(`{ id, error: { message } }` — Ramp's item shape; `{id, message}` is a 422). **Both lists have
`minItems: 1`: an empty list must be OMITTED, never sent as `[]`** — until 2026-09-10 every
confirm 422'd on one of these and was only `console.error`'d, so synced transactions stayed
`SYNC_READY` in Ramp forever and were re-listed each run. A confirm failure now also lands on
the family's step output as `confirmError`. A family confirms whatever it managed to gather
**even if its own drain threw partway** (the confirm is outside the drain's try/catch). An
empty batch is skipped.
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

- **Bills** (`syncBill`): a company/Ramp-id advisory lock serializes the atomic staging
  transaction. Carbon-born `bill.remote_id` may identify an existing invoice, and a legacy
  `(supplierId, supplierReference)` match is adopted only when it identifies one untracked
  Draft; a posted reference collision fails closed. A bill tied entirely to one mapped
  Carbon PO stages from that PO with exact line provenance and quantity reconciliation,
  respecting existing reservations. Multi-PO bills deliberately stage as standalone
  invoices instead of guessing a conversion target.
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
`scaleRepaymentLines` (the canonical bounded allocator distributes residual by largest
remainder so lines sum exactly to the header without distorting one line). A nonzero
repayment with no source basis is rejected rather than fabricated. Funding:
`STATEMENT_CREDIT` offsets the card liability; otherwise the statement bank account.

### Outbound: the draft-bill-only rule

`ramp-outbound` (gated by `pushPurchaseOrders` / `pushInvoices`) is cursor-driven
(`purchaseOrderPushUpdatedAt` / `invoicePushUpdatedAt`). These string metadata slots hold
JSON-encoded `[updatedAt,id]` keysets; legacy timestamp-only values replay their boundary
inclusively. Each page advances only across its contiguous successful prefix, so a failed
row and every row after it remain eligible on the next run.

- **POs** (`pushPurchaseOrder`): Completed/Closed mapped POs are archived; released POs
  ensure a Ramp vendor then create (carrying `external_id: po.id` for Ramp's
  bill-matching plus an entity-scoped idempotency key) or PATCH a mapped PO.
- **Invoices** (`pushInvoiceDraftBill`): posted invoices still Open/Partially Paid, not
  already mapped in either direction, not an Employee-supplier reimbursement, are pushed
  as a **draft bill then SUBMITted** (`POST /bills/drafts` + `/submit`, landing in Ramp
  "Pending approval"). **An auto-approved `POST /bills` is NEVER used** — draft + submit
  only, so a human approves in Ramp. Best-effort attaches the invoice PDF.
  **Release-gated off:** `spend.ts` keeps `RAMP_DRAFT_BILL_CONTRACT_VERIFIED = false`
  until monetary units, coding, PDF fields, and the submit response's bill identity
  have verified contract tests. The gate runs before any vendor/document/provider
  I/O and applies even to existing `pushInvoices: true` installs; it has no customer
  setting or environment override. Blocked exports count as failures and retain the
  cursor for retry. Purchase-order push and archive-on-settlement remain available.
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

## cardTransaction schema (migration `20260911041045_reconcile-ramp-card-transactions.sql`)

The forward, retry-safe reconciliation migration supersedes the three branch-only Ramp
schema migrations. Both `cardTransaction` and `cardTransactionLine` use composite
`(id, companyId)` primary keys with `id()` defaults. The parent, supplier, and cost-center
relationships are tenant-composite; account triggers require header and line accounts to
belong to the company's `companyGroupId`. It also converges the Ramp registry row, journal
enum values, document enums, indexes, RLS, event trigger, and the per-company
`CARD-%{yyyy}-%{mm}-` sequence.

- `cardTransaction`: `cardTransactionId` (readable, unique per company), `type`, `status`,
  `integration` (default `'ramp'`), `cardAccountId` (NOT NULL FK `account`), `offsetAccountId`
  (nullable FK), merchant/holder/last4/memo, `transactionDate`/`postingDate` (DATE),
  `currencyCode`, `exchangeRate`, `amount` (`>= 0`), `journalId`, posted/voided audit.
  CHECK: Payment/Cashback/Repayment require an `offsetAccountId`; Charge/Credit use lines.
- `cardTransactionLine`: codes an `amount` to an `accountId` (+ optional tenant-composite
  `costCenterId`), `sequence`, and a same-company parent with `ON DELETE CASCADE`.
- RLS on both is gated by **invoicing** permissions. The lifecycle trigger allows only
  Draft edits, Draft→Posted bookkeeping fields, and Posted→Voided audit fields. The line
  trigger locks the same parent row as posting and refuses mutation unless it is Draft, so
  line edits and post/void serialize rather than race.

## Card transactions → the accounting provider

The forward reconciliation migration gives `cardTransaction` a tenant-composite
**`supplierId`** foreign key and an **event trigger**
(`attach_event_trigger('cardTransaction', …)`). The card
family resolves the Ramp merchant to a Carbon supplier before posting —
`resolveMerchantSupplier` (`lib/suppliers.ts`): mapping-first under entityType
`"merchant"` keyed by Ramp `merchant_id`, then a case-insensitive `supplier.name`
match, then auto-create tagged with the `"Card Merchant"` supplier type (it delegates to
`resolveRampSupplier`, which now takes `{ entityType, supplierTypeId }`). A transaction
with no merchant name still posts with `supplierId` null. A Posted `Charge` (and, where
the provider can represent a refund, `Credit`) with a supplier is then pushed to the
accounting provider as its native **card-charge object** (Rillet charge, QBO Purchase,
Xero SPEND bank transaction) with the merchant and cost-center dimension, and its journal
is DOC_BACKED-excluded per row; everything else stays a journal entry. Ramp receipts remain
attached to the Carbon transaction; only the Rillet adapter currently uploads them to the
provider. Full
rules: `.claude/rules/accounting-sync-handlers.md` → "Card charges as provider objects".

## post-card-transaction edge function

`packages/database/supabase/functions/post-card-transaction/` (registered in
`config.toml`, `verify_jwt = true`). `{ type: "post" | "void", cardTransactionId, userId,
companyId }`. `postCardTransactionTransaction` opens one Kysely transaction and performs
the tenant-scoped header `FOR UPDATE` as its first read; every settings, company, line,
account, period, journal, dimension, and lifecycle write stays inside that transaction.
Repeated post of Posted or void of Voided returns the stored journal id without another
journal. The database parent-locking line trigger takes the same lock, closing the line-edit
race.

- **post**: only from Draft. Requires company settings/config, active non-group posting
  accounts in the company group, a Liability card account, Asset payment offset, Revenue
  cashback offset, and company-scoped cost centers. Resolves the accounting period (shifts a Locked/Closed period
  forward to the next open period, writing the shifted `postingDate` back). When
  `companySettings.accountingEnabled`, builds the journal (`sourceType`/`documentType`
  `'Card Transaction'`) and writes cost-center `journalLineDimension`s against the
  group's oldest active `CostCenter` `dimension` row; flips the row to Posted with
  `journalId`. Accounting-off = Posted with no journal. **A line carrying a
  `costCenterId` with no such dimension row REFUSES to post** ("Company group has no
  active Cost Center dimension") rather than posting a balanced journal that silently
  lost the tag — `pushCostCenters` creates the row for installed integrations, so this
  only fires for a company posting card transactions without the Ramp converge.
- **void**: only from Posted. When a journal exists, requires accounting enabled and proves
  the original company-scoped journal is Posted, source type `Card Transaction`, and every
  line points back to this document. It writes a new Posted reversal with negated amounts
  and copied dimensions, then flips the document to Voided. Documents posted while
  accounting was disabled have no journal and void without fabricating one.

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
  `getCardTransaction(client, companyId, id)` / `getCardTransactions` in
  `invoicing.service.ts`. Detail, line, document, and cost-center reads are company-scoped;
  account labels are resolved only from the authenticated company's group.

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
- **Sandbox** = `demo-api.ramp.com` (`RAMP_SANDBOX_HOST`) for a stored legacy
  `client_credentials` record. The current Connect UI creates production OAuth records and
  exposes no environment selector.
- **`// TODO(task-1)` API uncertainties remain narrowly source-marked**: reimbursement
  paid-state, bill sync/payment and card payment-method enums, repayment funding enum and
  amount shape, the draft-bill payload/submit identity, the all-connections/accounts
  endpoints, and the webhook challenge/signing contract. Transaction amount/coding behavior
  and converted PO-line reconciliation are implemented and are not
  part of that unresolved list. Grep `TODO(task-1)` in `packages/ee/src/ramp/**` and
  `packages/jobs/src/inngest/functions/integrations/ramp-sync*.ts` before relying on one
  of the remaining values.
- There is **no `apps/erp/app/modules/invoicing/AGENTS.md`** to cross-reference.
- **User-facing docs (`docs/`) are a separate follow-up** — not written here.
