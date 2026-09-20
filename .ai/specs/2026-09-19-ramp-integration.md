# Ramp Integration (consolidated, as-built)

> Status: implemented
> Author: Brad Barbin + Claude / Codex
> Date: 2026-09-19
> Rule (source of truth): `.claude/rules/ramp-integration.md`,
> `.claude/rules/accounting-sync-handlers.md`
> Research: `.ai/research/ramp-transaction-sync.md`,
> `.ai/research/ramp-api-doc-verification.md`,
> `.ai/research/accounting-projects.md`,
> `.ai/research/card-transaction-merchant-modeling.md`
> Live verification: `.ai/runs/2026-09-11-ramp-draft-bill-push-verification.md`
>
> **Changelog note:** This spec consolidates and supersedes four source specs —
> `2026-08-20-ramp-transaction-sync.md`, `2026-08-28-ramp-oauth-and-production-hardening.md`,
> `2026-09-11-accounting-projects-crud.md`, and `2026-09-17-ramp-card-merchant-modeling.md`.
> Where the older specs disagreed with the shipped code, this document follows the code and
> the two rule files. See the Changelog at the end for the reconciled decisions.

## TLDR

Carbon is a Ramp **accounting provider** and remains the books of record. It pushes Carbon's
chart of accounts, cost centers, and projects to Ramp for coding; pulls Ramp's ready spend
into Carbon documents; posts those documents; and confirms only observable success back to
Ramp. An hourly Inngest sweep is the correctness floor; the webhook is a latency hint.

- **Card spend** (cleared, coded) becomes a `cardTransaction`. Charge/Credit journals move
  between coded accounts and the mapped card liability; Payment/Cashback/Repayment settle or
  reverse that liability.
- **Bills** become posted `purchaseInvoice` records; **bill payments** on a supported bank
  rail become posted AP `payment` + `invoiceSettlement`; card-paid bills are confirmed without
  a second payment.
- **Reimbursements** become employee-supplier purchase invoices and, when Ramp-paid, AP
  payments. **Repayments** become Repayment card transactions.
- **Outbound**, Carbon pushes released **POs** and coded **draft bills** ("provisional bills")
  to Ramp; it never submits a draft.
- New connections use Carbon's production **OAuth Connect** flow; stored legacy
  `client_credentials` records remain readable but the UI cannot create them.
- A Posted `Charge`/`Credit` with a supplier is additionally represented to the downstream
  accounting provider (Rillet/QBO/Xero) as that provider's **native card-charge object**.

## Problem statement

Without the integration, controllers re-key Ramp activity and can book the wrong liability.
Card spend is not an AP invoice: the merchant was paid at swipe and Ramp is the creditor. Ramp
Bill Pay can also leave a Carbon invoice open after cash has moved, causing duplicate payment
and AP aging errors. The integration gives each movement one Carbon document, one idempotent
external mapping, and a posting that can flow onward to the configured accounting provider.

The direction that makes Ramp unusual: **coding lives in Ramp**. A customer categorizes a
transaction against Carbon's accounts inside Ramp's UI, marks it "ready to sync", and the
`ramp-sync` job pulls it into Carbon already coded — the opposite of the Xero/QBO/Rillet
providers, which own the data and mirror it out.

## Architecture

| Concern | Path |
|---|---|
| Integration config / lifecycle | `packages/ee/src/ramp/config.tsx`, `hooks.server.ts` |
| Ramp API / models / state | `packages/ee/src/ramp/lib/{client,models,state}.ts` |
| Ramp service domains | `connection.ts`, `chart-of-accounts.ts`, `cost-centers.ts`, `projects.ts`, `suppliers.ts`, `spend.ts`, `sync-confirmation.ts`, `webhooks.ts`, `coding.ts`, `allocation.ts`, `money.ts`; `service.ts` is the stable facade |
| OAuth state helper | `packages/auth/src/lib/oauth-state.server.ts` |
| OAuth callback | `apps/erp/app/routes/api+/integrations.ramp.oauth.ts` |
| Webhook | `apps/erp/app/routes/api+/webhook.ramp.$companyId.ts` |
| Durable sync | `ramp-sync.ts` coordinator + `ramp-sync-{shared,card,bill,reimbursement-family,repayment,outbound}.ts`; staging in `ramp-sync-{card,bill}-stage.ts`, `ramp-sync-{payment,reimbursement}.ts`; policy/cursor in `ramp-sync-{policy,cursor}.ts`; hourly `ramp-sweep.ts` |
| External identity | `externalIntegrationMapping`, integration `ramp` |
| Card posting | `packages/database/supabase/functions/post-card-transaction/` |
| ERP reads / UI | invoicing service, `card-transactions*` routes, `ui/CardTransaction/` |
| Integration state | service-role `upsert_company_integration_patch` RPC via `patchIntegrationState` |
| Projects CRUD | `apps/erp/app/modules/accounting` (`project` table, routes under `x+/accounting+/projects*`) |

Ramp is a spend source, **not** an accounting `ProviderID`. Its Carbon journals and documents
still flow onward through the accounting synchronization engine. See
`.claude/rules/accounting-sync-handlers.md`.

## Package layout

EE package `@carbon/ee`, subpaths `@carbon/ee/ramp.server` (server-only service + client) and
`@carbon/ee/ramp/hooks.server` (lifecycle hooks). The `Ramp` config descriptor is exported
from `@carbon/ee` (`integrations[]`). The `.server` naming is required — the module uses
`node:crypto`. `service.ts` is a compatibility facade over the domain modules; pure allocation,
coding, money, and signature helpers live in their named files.

## Connection: OAuth Connect + token refresh

`RampCredentialsSchema` (`lib/models.ts`) is a discriminated union on `type`
(`client_credentials` | `oauth2`) and retains both arms for stored-data compatibility, but the
settings UI exposes only OAuth Connect.

- **OAuth Connect (production, the only new-install UI).** `config.tsx` declares an `oauth`
  block, active only when public `RAMP_CLIENT_ID` is set. `IntegrationCard` renders a one-click
  Connect that redirects to `https://app.ramp.com/v1/authorize` (integration scopes plus
  `offline_access`). The settings loader first calls
  `issueOAuthState({ integrationId: "ramp", userId, companyId })`
  (`@carbon/auth/oauth-state.server`): a random nonce and those binding fields live in the
  signed, HttpOnly, ten-minute `carbon-oauth-state` cookie (signed by `SESSION_SECRET`; there
  is no Ramp-specific state secret or unsigned company id in the callback contract). The
  callback consumes and destroys that cookie **before** interpreting Ramp's response, rejecting
  expiry, replay, or integration/user/company mismatch with the stable `invalid-state` error.
  It then exchanges the code (`exchangeRampOAuthCode`), applies `patchRampOAuthCredentials`, and
  runs `rampOnInstall`. Callback redirects use stable reasons: `invalid-state`, `denied`,
  `invalid-response`, `token-exchange`, `save-failed`, `install-failed`.
- **Hosts.** Production authorize `app.ramp.com`; token exchange and API `api.ramp.com`; sandbox
  `demo-api.ramp.com` (only reachable through a stored legacy `client_credentials` record). The
  production UI offers no environment selector.
- **Token refresh.** `RampClient.getAccessToken` runs the `refresh_token` grant inside a
  sixty-second margin. Ramp does **not** rotate refresh tokens, so `onTokensRefreshed`
  (`patchRampRefreshedTokens`) persists only the new access token + expiry. OAuth app id/secret
  are env (`RAMP_CLIENT_ID` browser-visible, `RAMP_CLIENT_SECRET` server-only), read lazily from
  `process.env` in `connection.ts`.
- **Legacy client credentials.** `RampClient` can still read existing `client_credentials`
  metadata (Basic-auth `client_credentials` grant, cached bearer re-minted under 60s), but
  `RampSettingsSchema` has no id/secret fields and the UI cannot create one.
- **Client behavior.** `listPaginated` drains cursor pages (`page.next`, `page_size=100`),
  parsing each row with a passthrough zod schema. Errors: `RampApiError` (parses `error_v2`),
  `RampRateLimitError` (429 → parsed `Retry-After`). **No in-client retries** — retries live at
  the Inngest job layer. `buildRampIdempotencyKey({ companyId, operation, scope })` = sha256.

### Settings

`RampSettingsSchema` is flat: optional `entityId`; account mapping — `cardLiabilityAccountId`
and `statementBankAccountId` **required**, `cashbackIncomeAccountId` and
`reimbursementBankAccountId` optional; and five sync toggles — `pullTransactions`, `pullBills`,
`pullReimbursements`, `pushPurchaseOrders`, `pushInvoices` (all default `true`). There is **no**
`codingAccountScope` setting (removed 2026-09-11 — see Changelog). The config renders
`SetupInstructions` with the webhook URL `${origin}/api/webhook/ramp/${companyId}`.

## Integration state (atomic, key-owned patches)

`RampIntegrationMetadata` (`companyIntegration.metadata`, id `ramp`) holds: `credentials`
(access/refresh/client secrets vaulted, resolved on read), the four account-mapping ids,
`entityId`, `connectionId`, `webhookId`, `webhookSecret`, `sync` (the five flags), and
`cursors` (`repaymentsRepaidAt`, `purchaseOrderPushUpdatedAt`, `invoicePushUpdatedAt`).

**Every Ramp write goes through `upsert_company_integration_patch`**, exposed by
`patchIntegrationState` and the operation-specific writers in `lib/state.ts`
(`patchRampSettings`, `patchRampOAuthCredentials`, `patchRampRefreshedTokens`,
`patchRampConnection`, `patchRampWebhook`, `patchRampCursor`, `clearRampConnectionState`). The
RPC is service-role-only, takes flat dot-path patch/removal maps, advisory-locks the logical
`(companyId, integrationId)` key, locks an existing row, and writes plaintext metadata, Vault,
`secretRef`, activation, and audit fields in one PostgreSQL transaction. Each writer owns only
its own paths — settings owns entity/account/toggle paths, OAuth owns its credential set,
refresh owns access token + expiry, connection/webhook and each cursor own their paths. This is
never a read/merge/write of the whole record or a whole-object Vault replacement, so
connect/reconnect/background writers preserve keys they do not own.

## Install / converge (`hooks.server.ts`)

`convergeRamp` runs on install and every settings save: it validates credentials
(`client.getBusiness()`), ensures the accounting connection, and best-effort registers the
webhook first. A fresh OAuth callback has no required accounts, so convergence **stops there**:
no master-data push, no financial sync, until both `cardLiabilityAccountId` and
`statementBankAccountId` exist. Once configured, it validates an optional `entityId`, pushes
chart of accounts / cost centers / projects, and fires `trigger("ramp-sync", { companyId,
reason })` (lazy runtime `import("@carbon/jobs")`, because `jobs → ee` is the dependency
direction). A reconnect whose atomic OAuth patch preserved valid mappings may converge
immediately.

- **`ensureRampConnection`** only CREATES (when `metadata.connectionId` is unset,
  `remote_provider_name: "Carbon"`). A fresh Carbon DB pointed at a Ramp business that already
  has a Carbon connection fails install — adopt the existing `connectionId` by hand until it
  self-heals. Ramp allows exactly one active accounting connection per company.
- **`ensureRampWebhook`** is idempotent (skips when `webhookId` set); on create it writes
  `webhookId` and the vaulted `webhookSecret` together via `patchRampWebhook`.
- **`rampOnUninstall`** best-effort deletes the webhook and the accounting connection, then
  `clearRampConnectionState` removes connection/webhook ids and the webhook secret without
  disturbing OAuth credentials / settings / cursors. `rampHealthcheck` = `getBusiness()`
  succeeds AND at least one accounting connection is linked/active/connected.

### Outbound master data (coding options)

- **`pushChartOfAccounts`** pushes active, non-group accounts as Ramp coding options
  (`POST /accounting/accounts`, `id` = Carbon `account.id`, batched at 500). The card-liability
  account is classified `CREDCARD`; otherwise `glAccountClass` maps to Ramp `classification`
  (Asset→ASSET, etc.); an unclassifiable account is skipped. **Every classifiable account is
  pushed VISIBLE** — the Carbon-side `visible` flag must never reach the wire (Ramp 422
  DEVELOPER_7001 rejects the whole batch). Visibility is part of the mapping fingerprint;
  accounts a prior `"expense"`-scope install PATCHed HIDDEN flip back to VISIBLE. `account` is
  companyGroup-scoped (PK is `id` alone, no `companyId`).
- **`pushCostCenters`** converges `costCenter` rows into ONE custom `SINGLE_CHOICE` field
  (`id: "carbon-cost-center"`) whose `name`/`display_name` are the company group's CostCenter
  `dimension.name` (the customer's word for the concept). It is a true diff, not a blind post:
  read the field by `remote_id`, create with `id` when absent (idempotent by `id`) or PATCH the
  name when Carbon's changed; then read field-options and `diffCostCenterOptions` →
  create (`{ id: costCenter.id, value }` against `field_id: ramp_id`, ≤500), rename
  (`display_name`), hide removed (`visibility: "HIDDEN"`, never delete), re-show restored.
  Tracked in `externalIntegrationMapping` (`costCenter` per option, `costCenterField` for the
  field) with fingerprints. First calls `ensureCostCenterDimension`. Runs in `convergeRamp` and
  as the `ramp-cost-centers` step of every `ramp-sync` (≤1h latency for a new cost center).
- **`pushProjects`** (`lib/projects.ts`, `id: "carbon-project"`) is the exact parallel for the
  Carbon **Project** entity — a SECOND independent custom `SINGLE_CHOICE` field, same true-diff
  convergence (create / rename / HIDE inactive / re-show restored), tracked in
  `externalIntegrationMapping` (`project` per option, `projectField` for the field).
  `ensureProjectDimension` FINDS the group's active `Project` dimension (seeded by the Projects
  dimension slice; rarely creates). Runs in `convergeRamp` and the `ramp-projects` step of every
  `ramp-sync`. Cost Center convergence is left entirely unchanged (parallel field, own id).
- Every purchase invoice the sync creates (bill AND reimbursement) gets its required
  `purchaseInvoiceDelivery` row in the same transaction as the header/lines/mapping —
  `post-purchase-invoice` reads it with `.single()` and refuses to post without it.

## The sync loop (`ramp-sync*.ts`, Inngest)

`rampSyncFunction` (id `ramp-sync`, event `carbon/ramp-sync`, `retries: 2`,
`concurrency: { key companyId, limit 1 }`). `ramp-sync.ts` is the thin durable coordinator: it
builds `RampSyncContext`, runs a fixed `step.run` sequence, totals failures, and notifies. Each
family lives in its own module with its own failure isolation, so one family's failure does not
abort the others; drain exceptions increment that family's `failed` count, confirm failures
appear as `confirmError`, and both feed the coordinator's final issue total. Steps, in order:

| Step | Ramp source | Carbon result | Confirm `syncType` |
|---|---|---|---|
| `ramp-chart-of-accounts` | (outbound) | Ramp GL-account options | — |
| `ramp-cost-centers` | (outbound) | Ramp cost-center field/options | — |
| `ramp-projects` | (outbound) | Ramp project field/options | — |
| `ramp-card-transactions` | transactions `SYNC_READY` | `cardTransaction` Charge/Credit | `TRANSACTION_SYNC` |
| `ramp-transfers` | transfers `SYNC_READY` | `cardTransaction` Payment | `TRANSFER_SYNC` |
| `ramp-cashbacks` | cashbacks `SYNC_READY` | `cardTransaction` Cashback | `STATEMENT_CREDIT_SYNC` |
| `ramp-bills` | bills (sync_ready, not synced) | posted `purchaseInvoice` | `BILL_SYNC` |
| `ramp-bill-payments` | paid bills' `payment` | AP `payment` + `invoiceSettlement` | `BILL_PAYMENT_SYNC` |
| `ramp-reimbursements` | reimbursements `SYNC_READY` | employee-supplier `purchaseInvoice` (+ payment when Ramp-paid) | `REIMBURSEMENT_SYNC` |
| `ramp-repayments` | repayments (`from_repaid_at` cursor) | `cardTransaction` Repayment | *(none)* |
| `ramp-outbound` | Carbon POs + posted invoices | Ramp POs (archived on Completed/Closed) + coded Ramp DRAFT bills (never submitted) | *(none)* |
| `ramp-notify-failures` | (internal) | in-app notification to the configurer | — |

Gating: the `metadata.sync.pull*` flags; `cardLiabilityAccountId` (every card family);
`statementBankAccountId` (transfers, bill payments, repayments); `cashbackIncomeAccountId`
(cashbacks). A configured `entityId` is enforced **locally** on every inbound row before mapping
or writes; only endpoints with a verified query contract also receive a remote `entity_id`
filter. Blank `entityId` means all inbound entities.

### Money and FX

Amounts use their **verified wire shape**: signed and currency amounts are integer minor units
(`entity_amount.value`), while the deprecated card-transaction `amount` fallback is a major-unit
decimal — the two are never conflated (`money.ts`: `parseVerifiedRampMinorAmount`,
`normalizeRampCardTransactionAmount`). Missing, non-finite, fractional-minor,
currency-mismatched, or ambiguous values fail that item rather than becoming zero. Currency
precision (`currency.decimalPlaces`) and the foreign-per-base exchange rate
(`get_exchange_rate`, `getRampExchangeRate`, cached) come from Carbon; the sync never guesses two
decimals or par FX. The card journal converts document→base by **dividing** via `toBaseAmount`.
Ramp line amounts are in the merchant currency while the header is settlement `entity_amount`,
so `buildTransactionLines` scales lines to the settlement total via `scaleLinesToTotal` (the
canonical bounded Hamilton allocator; same-currency input is a no-op).

### Coding (round-trip)

`codeSelections` (pure, `lib/coding.ts`) reads a Ramp `accounting_field_selections` list: the
first `category_info.type === "GL_ACCOUNT"` selection's `external_id` (the Carbon `account.id`)
wins for the account; the first selection whose `category_info.external_id === "carbon-cost-center"`
wins for the cost center; `"carbon-project"` for the project. A CUSTOM field has no `type` at
creation, so its selections come back typed `OTHER` — matching the native `COST_CENTER` enum
never fires and silently dropped every project/cost-center tag until this was fixed. A line
coded to an account, cost center, or project Carbon can't find (verified in one `.in()` query
each — `verifyCostCenters`, `verifyProjects`) fails that item as "uncoded" without creating
anything; the tag is never dropped. `buildLineCodingSelections` is the OUTBOUND mirror
(`{ field_external_id, field_option_external_id }`) — GL account on Ramp's native `"Category"`,
cost center on `"carbon-cost-center"`, project on `"carbon-project"` — round-trip pinned by
tests.

### Idempotency, confirm, recoverability

An already-synced Ramp item is detected via its `externalIntegrationMapping` and re-confirmed
only, never re-created. `mapping.link(...)` is written **before** the confirm, so a retry (the
item still lists as SYNC_READY until Ramp records the confirm) short-circuits on the mapping.
Entity-type reuse: card families → `cardTransaction` (repayments key `repayment:<id>`); bills +
reimbursements → `bill` (distinct id spaces); bill payments → `payment`.

`confirmSyncs` (`POST /accounting/syncs`, body from the pure `buildSyncConfirmBody`) sends
`sync_type`, a deterministic idempotency key (over `companyId`, `syncType`, sorted ids),
`successful_syncs` (`{ id, reference_id, deep_link_url? }`) and `failed_syncs`
(`{ id, error: { message } }`). Both lists have `minItems: 1`: an empty list must be **OMITTED**,
never sent as `[]` (an empty `[]` 422'd for weeks and left transactions permanently SYNC_READY).
A family confirms whatever it gathered even if its own drain threw partway. Repayments and the
outbound families have **no Ramp confirm** — their idempotency IS the mapping / cursor.

The durable rule: transactional staging either commits its full owned write set or none of it;
a posting failure can leave an intentional Draft a retry resumes; mapping and observable Posted
state decide whether a retry may confirm; no family reports success merely because an edge
response was ambiguous.

### Transactional staging per family

- **Card families** use `stageOrResumeRampCardTransaction` to advisory-lock the company/Ramp id
  and atomically create or resume the Draft `cardTransaction`, lines, and mapping before posting
  through `post-card-transaction`. A missing/ambiguous edge response succeeds only when a
  tenant-scoped reread observes `Posted`; Ramp receipts are then stored best-effort. A mapped
  Draft is refreshed from the latest validated Ramp header/coding in the same transaction; a
  failed refresh rolls back and Posted rows stay immutable.
- **Bills** use `stageOrResumeRampBill` to atomically stage the supplier interaction, Draft
  `purchaseInvoice`, delivery, lines, and mapping before `post-purchase-invoice`. A company/Ramp
  advisory lock serializes staging. A Carbon-born `bill.remote_id` may identify an existing
  invoice; a legacy `(supplierId, supplierReference)` match is adopted only when it identifies
  one untracked Draft (a posted reference collision fails closed). A bill tied entirely to one
  mapped Carbon PO stages from that PO with exact line provenance and quantity reconciliation;
  multi-PO bills deliberately stage as standalone invoices.
- **Bill payments** delegate to `syncRampBillPayment` (`ramp-sync-payment.ts`): the Draft
  payment, settlement, and mapping stage atomically, the stored source-FX snapshot is retained
  on resume, and success requires a tenant-scoped reread showing Posted. A bill paid by a **Ramp
  card** (`payment_method` in `CARD_PAYMENT_METHODS`, incl. `ONE_TIME_CARD_DELIVERY`) is
  confirmed **without** posting an AP payment (the card spend already routes through the card
  sync — posting would double-count). Only verified bank rails (`ACH`, `CHECK`, `DIRECT_DEBIT`,
  `DOMESTIC_WIRE`, `FED_NOW`, `INTERNATIONAL`, `LOCAL_BANK_TRANSFER`, `RTP`, `SWIFT`) post a
  payment; missing/unknown methods, `PAID_MANUALLY`, `VENDOR_CREDIT`, crypto, and `UNSPECIFIED`
  fail visibly.
- **Reimbursements** delegate to `syncRampReimbursement` (`ramp-sync-reimbursement.ts`): a
  company/Ramp advisory lock serializes the atomic supplier-interaction + Draft invoice +
  delivery + lines + mapping stage; Ramp-paid rows also require their AP payment to be observably
  Posted before confirm. `REIMBURSED` / `REIMBURSED_VIA_PUSH` require a posted settlement;
  `APPROVED`, `AWAITING_PAYMENT`, `AWAITING_PUSH_PAYMENT`, `MANUALLY_REIMBURSED` create/confirm
  the invoice without a Ramp bank payment; other states fail before writes. Legacy adoption
  requires exactly one unposted, system-created Draft with the expected `RAMP-REIMB-<id>`
  reference and fully matching identity/dates/currency/amounts/coding/FX; ambiguous matches are
  rejected.
- **Suppliers.** `resolveRampSupplier` (`vendor` entityType, bills/POs): mapping-first →
  case-insensitive exact `supplier.name` match → auto-create. `resolveEmployeeSupplier`
  (reimbursements/repayment users): the same but ensures an "Employee" `supplierType` and names
  the supplier `"<First> <Last> (<email>)"`. Merchant resolution is different — see below.

### Repayments (cursor-driven)

There is no Ramp confirm; the `metadata.cursors.repaymentsRepaidAt` high-water mark controls
replay and the `repayment:<id>` mapping prevents duplicates. `computeRepaymentCursor` advances
to `min(max(processed), min(failed) − 1s)` so a failed item re-lists next sweep. Each repayment
scales its ORIGINAL card transaction's coding lines by `repaymentAmount / originalAmount` via the
pure `scaleRepaymentLines` (bounded allocator; lines sum exactly to the header). A nonzero
repayment with no source basis is rejected. The funding field is a free string; only the
documented lowercase `ach` value is supported (statement-bank offset). Missing/unverified funding
(including `STATEMENT_CREDIT`) fails visibly and holds the cursor before that item.

### Outbound: PO push and draft-bill-only

`ramp-outbound` (gated by `pushPurchaseOrders` / `pushInvoices`) is cursor-driven. The cursor
metadata slots hold JSON-encoded `[updatedAt, id]` keysets; legacy timestamp-only values replay
their boundary inclusively. Each page advances only across its contiguous successful prefix, so a
failed row and every row after it remain eligible. Failed supplier/supplier-type lookups are
failures, not missing suppliers, and cannot advance a cursor.

- **POs** (`pushPurchaseOrder`): released POs ensure a Ramp SPEND vendor
  (`resolveOrCreateRampSpendVendor` — matches by `external_vendor_id`/name then creates with the
  supplier's synced purchasing-contact email + country/state and a single
  `business_vendor_contacts` object), then create (`external_id: po.id` for bill-matching, an
  entity-scoped idempotency key, `currency`, `entity_id`, `three_way_match_enabled: false`; lines
  by `external_id` + `unit_quantity`) or PATCH a mapped PO. Completed/Closed mapped POs are
  archived. Each page preloads PO/vendor mappings in two reads and drains one paginated vendor
  snapshot only when named suppliers remain unmapped.
- **Invoices** (`pushInvoiceDraftBill`): **DRAFT-ONLY, shipped + live-verified 2026-09-11.**
  Targets unmapped Open/Partially Paid invoices from non-Employee suppliers. Ensures the Ramp
  SPEND vendor, reads the invoice's POSTED "Purchase Invoice" journal for its account-costed
  lines (`loadBillCostingLines` + `toTransactionCurrencyLines` — the SAME path QBO/Xero/Rillet
  use, NOT `purchaseInvoiceLine.accountId`, which is null for item/part lines), then
  `POST /bills/drafts` with `remote_id: invoice.id` (the echo guard + bill-match key — the inbound
  `ramp-bills` step dedupes on it), decimal document-currency line `amount`s, and per-line coding
  via `buildLineCodingSelections`. Only accounts/cost centers/projects Carbon has pushed are
  coded; an unpushed one degrades the line to uncoded rather than 422-ing the whole bill. An
  invoice with no posted journal fails `UNMAPPED_ACCOUNTS` and retains its cursor. It **NEVER
  submits** — `POST /bills/drafts/{id}/submit` needs a payment method + payee contact (per-vendor
  Ramp bill-pay config Carbon doesn't own, verified `400 BILL_PAY_7145`) — and must **not** also
  send `enable_accounting_sync: false` (Ramp 422s against a `remote_id`). Maps
  `("bill", invoice.id, "ramp", <draft id>)`.
- **No bill archive-on-settlement.** A Ramp draft has no delete endpoint
  (`DELETE /bills/drafts/{id}` → 405), so a handed-off draft is not retracted when its Carbon
  invoice settles — Ramp owns the bill's lifecycle after handoff. (PO archive on Completed/Closed
  is separate and still runs.)
- The outbound entity, when unset, falls back to the business's first entity —
  `resolveRampEntityId`. This remains a documented multi-entity hardening gap (see Remaining
  risks).

## cardTransaction schema

Base migration `20260820143726_ramp-integration.sql`; authoritative forward reconciliation
`20260911150050_reconcile-ramp-card-transactions-forward.sql` (retry-safe; supersedes the three
branch-only Ramp schema migrations and converges the registry row, enums, indexes, sequence,
event trigger, RLS, constraints, and lifecycle guards); lifecycle audit invariant
`20260911150058_enforce-card-transaction-lifecycle-audit-forward.sql`.

Both `cardTransaction` and `cardTransactionLine` use composite `(id, companyId)` primary keys
with `id()` defaults. Header-to-company, line-to-header, supplier, and cost-center/project
relationships are tenant-composite. `account` integrity is enforced by triggers (because
`account` is company-group scoped): every referenced account must belong to the transaction's
company's group. RLS uses **invoicing** permissions.

- `cardTransaction`: `cardTransactionId` (readable, unique per company via a
  `CARD-%{yyyy}-%{mm}-` sequence), `type`, `status`, `integration` (default `'ramp'`),
  `cardAccountId` (NOT NULL FK), `offsetAccountId` (nullable FK), merchant/holder/last4/memo,
  `transactionDate`/`postingDate` (DATE), `currencyCode`, `exchangeRate`, `amount` (`>= 0`),
  `supplierId` (tenant-composite FK), `journalId`, and posted/voided audit. CHECK:
  Payment/Cashback/Repayment require an `offsetAccountId`; Charge/Credit use lines.
- `cardTransactionLine`: codes an `amount` to an `accountId` (+ optional tenant-composite
  `costCenterId` and `projectId`), `sequence`, and a same-company parent with `ON DELETE CASCADE`.
- **Lifecycle triggers**: the header trigger allows only Draft edits, Draft→Posted bookkeeping
  fields, and Posted→Voided audit fields; the line trigger locks the same parent row and refuses
  mutation unless Draft, so line edits serialize with post/void. The stored CHECK invariant:
  Draft has no journal or posting/void audit; Posted has `postingDate`/`postedAt`/`postedBy` and
  no void audit; Voided has both. `journalId` may be null for Posted/Voided when accounting is
  disabled.

## post-card-transaction edge function

`packages/database/supabase/functions/post-card-transaction/`, registered in `config.toml`,
`verify_jwt = true`. Body `{ type: "post" | "void", cardTransactionId, userId, companyId }`.
Requires invoicing-update permission; for an authenticated JWT the shared edge helper requires
`sub === userId` and looks up permissions for that subject (a body-supplied user cannot
substitute). `postCardTransactionTransaction` opens one Kysely transaction and makes the
tenant-scoped header `FOR UPDATE` its first read; all settings/company/line/account/period/
journal/dimension/lifecycle work stays inside it. Repeating post on Posted or void on Voided
returns the stored journal id without a second journal.

- **post** (only from Draft): validates active non-group posting accounts from the correct
  company group, a Liability card account, Asset payment offset, Revenue cashback offset,
  company-scoped cost centers, an active `CostCenter` (and `Project`) dimension when a line uses
  one, and a valid accounting period (shifting a Locked/Closed date forward to the next open
  period, writing the shifted `postingDate` back). With accounting enabled it writes the balanced
  Card Transaction journal + cost-center/project `journalLineDimension` rows and marks Posted;
  with accounting disabled it marks Posted without a journal. A line carrying a `costCenterId`
  with no dimension row **refuses to post** rather than silently dropping the tag. Payment/Cashback
  reject coding lines; Charge/Credit/Repayment require finite, strictly positive line magnitudes
  summing to the header. Journal-line ids are preallocated and bound explicitly to dimensions.
- **void** (only from Posted): when a journal exists, requires accounting enabled and proves the
  original tenant-scoped journal is Posted, source type Card Transaction, and every line ties to
  this document; writes a new Posted reversal with negated amounts and copied dimensions
  (reversal ids also preallocated), then marks Voided. A document posted while accounting was
  disabled has no journal and voids without inventing one.

### Journal builder (`build-card-transaction-journal.ts`)

Pure, unit-testable, golden-master-pinned. Amounts are natural-balance-signed via
`credit()`/`debit()`; both sides divide by the foreign-per-base `exchangeRate`. The card account
is always booked as a **liability**.

| Type | Journal |
|---|---|
| Charge | line accounts debited (their class); card liability credited for the total (lines must sum to header) |
| Credit | mirror of Charge (line accounts credited; card liability debited) |
| Payment | card liability debited; bank Asset offset credited |
| Cashback | card liability debited; offset credited as **Revenue** (a rebate is income), whatever the offset's class |
| Repayment | funding offset (bank Asset or card liability, per funding) debited; each line account credited (lines must sum to header) |

## Card transactions → the accounting provider

A Posted `Charge` (and, where the provider can represent a refund, `Credit`) with a supplier is
pushed to the downstream accounting provider as its native **card-charge object** — Rillet
`charge`, QBO `Purchase` (`PaymentType: "CreditCard"`, `Credit: true` for a refund), Xero
`BankTransaction` `Type: "SPEND"` (`"RECEIVE"` for a refund) against the CREDITCARD-type account
— carrying the merchant, cost-center/project dimensions, receipt, and FX. Its Card Transaction
journal is marked `DOC_BACKED`-excluded **per row** (the inventory-adjustment carve-out
precedent); Payment/Cashback/Repayment stay journal entries on every provider. The policy is per
row, never a blanket flip. Rillet reimbursements route to the native `POST /reimbursements`
object (employee-supplier invoices; `payable_account_code` from the posted AP control line);
Xero/QBO reimbursements stay bills (their native shape). Full rules:
`.claude/rules/accounting-sync-handlers.md` → "Card charges as provider objects".

### Merchant modeling (the "Card Merchant" catch-all)

`resolveMerchantSupplier` (`lib/suppliers.ts`) is **match-or-default, never one supplier per
merchant** — the per-merchant auto-create polluted the vendor master with hundreds of one-off
rows (SAP/NetSuite/Intacct/QBO all treat the card merchant as transaction metadata; spend
platforms collapse the tail to a single catch-all vendor). Resolution order:

1. **Mapping-first** — `externalIntegrationMapping`, entityType `"merchant"`, keyed by Ramp
   `merchant_id`. Reuse if mapped (idempotent).
2. **Exact-name match** to an EXISTING supplier (escaped case-insensitive `ilike`). If the
   merchant is already a real vendor, use it AND write the `"merchant"` mapping.
3. **Catch-all** — the single `"Card Merchant"` house supplier per company
   (`resolveCardMerchantCatchAllSupplier`, find-or-create, tagged the `"Card Merchant"`
   `supplierType`). **No per-merchant mapping is written on this fallback**, so the mapping table
   does not re-accumulate one row per merchant; the catch-all is resolved by its stable identity
   every sync.

The per-merchant auto-create path is removed entirely (no existing installs to preserve — no
toggle, migration, or compatibility path). `resolveRampSupplier` keeps its auto-create for the
bill/PO `"vendor"` path. A transaction with no merchant name posts with `supplierId` null (the
charge falls back to a plain journal entry). Because all card spend now shares the catch-all
vendor, merchant identity rides on the provider charge **line description**
(`charge.merchantName ?? line.description ?? charge.memo`), not on `vendor_id` alone. A
per-merchant "Merchant" GL dimension is a deferred follow-up.

## Accounting Projects

Projects are a flat Accounting master-data list, delivered in three sequenced slices, kept
**separate** from Cost Centers so a transaction can carry both. This supersedes the earlier
customer practice of representing a "Project" by renaming the CostCenter field.

- **Slice 1 — CRUD.** A `project` table (immutable `id('prj')`, composite PK `("id","companyId")`,
  required company-unique `name`, optional `description`, `active BOOLEAN`, standard audit; four
  RLS policies using existing `accounting_view/create/update/delete` scopes). A flat Projects page
  under Accounting → Configure (Payment Terms table/drawer precedent): searchable/paginated table,
  permission-gated New/Edit/Delete, drawer form with Name + Description. Delete is soft
  (`active = false`); active lists exclude inactive rows, history-safe reads include them. Name
  reuse is blocked across active and inactive rows. Service: `projectValidator`, `getProjects`,
  `getProject` (incl. inactive), `upsertProject`, `deleteProject`, `Project` type.
- **Slice 2 — Dimension.** `Project` added to `dimensionEntityType` (enum-add migration + a
  separate backfill migration, because PostgreSQL cannot consume a new enum value in the same
  transaction) plus new-company seed. A group-level `Project` dimension per company group. App/EE
  wiring: `dimensionEntityTypes` array, `getEntityDimensionValues` / `getEntityValuesByIds`
  (eager-loaded, low-cardinality), `DIMENSION_LABEL_SOURCES`, `DimensionEntityTypeIcon`, selector
  color. Mirrors the ScrapReason precedent. Only active Projects appear for new assignment;
  historical ids continue to resolve.
- **Slice 3 — Ramp.** The `carbon-project` `SINGLE_CHOICE` field convergence + coding
  encode/decode (Phase 3a, above) and the inbound persistence round-trip (Phase 3b): `projectId`
  columns on `cardTransactionLine` / `purchaseInvoiceLine` (tenant-composite FK), staging threads
  the picked project, and `post-card-transaction` / `post-purchase-invoice` write a Project
  `journalLineDimension` per line — the same round-trip cost centers use.

## Webhook and sweep

The webhook route (`webhook.ramp.$companyId.ts`, `runtime: "nodejs"` for constant-time HMAC) is
what Ramp POSTs to. A delivery is a **nudge, not data**. Flow: `getRampIntegration` (404 when
not installed/active; resolves the vaulted `webhookSecret`) → **signature verify**
(`x-ramp-signature` + `verifyRampWebhookSignature`, HMAC-SHA256 over the raw body, base64,
constant-time compare, fail-closed 401) → **challenge handshake** (only a `challenge` in the
signed body echoes `{ challenge }`; an unsigned query parameter cannot supply or override it) →
otherwise parse `RampWebhookEventSchema` (unrecognized events acked, never rejected) →
`trigger("ramp-sync", { reason: "webhook" })`. The exact header name, signing encoding, and
challenge shape remain sandbox-unverified defaults; unsigned handshakes are rejected.

`rampSweepFunction` (id `ramp-sweep`, cron `0 * * * *`, `retries: 2`) lists every company with an
ACTIVE `ramp` integration and fires one `carbon/ramp-sync` (`reason: "sweep"`) each. **Webhooks
are latency; the sweep is correctness** — a missed or disabled webhook delivery becomes ≤1h of
staleness, never permanent loss. `ramp-sync` is idempotent, so re-firing is safe.

## ERP UI (invoicing module)

- Routes: `card-transactions.tsx` (list, `getCardTransactions`, filters search/type/status),
  `card-transactions.$id.tsx` (read-only Drawer detail with lines + receipts + a **Void** action
  for Posted rows, `update: "invoicing"`), `card-transactions.$id.void.tsx` (action →
  service-role `functions.invoke("post-card-transaction", { type: "void" })`).
- Components: `ui/CardTransaction/` (`CardTransactionsTable.tsx`, `CardTransactionStatus.tsx`).
  Service: `getCardTransaction(client, companyId, id)` / `getCardTransactions`. Single-record
  reads require `(companyId, id)`; detail/line/document/cost-center reads are company-scoped;
  account labels are restricted to the authenticated company's group.
- Purchase-invoice header shows a Ramp badge when a `("bill", invoiceId, "ramp")` mapping exists.
- Sync Activity tab renders "Card Charge <id>" rows linked to the card transaction, across
  Completed/Skipped/Excluded/Failed/Warning.

## Decisions retained

- New `cardTransaction` document; no AP invoice for card spend. Payment/Cashback/Repayment remain
  card-register transaction types. Reimbursements use employee-as-supplier purchase invoices and
  payments.
- Cost centers and projects are the pushed line dimensions; items, customers, and suppliers are
  not Ramp coding dimensions.
- Carbon POs and draft bills push automatically when enabled; draft-bill export is draft-only and
  never submits.
- Invoicing module and permissions own card transactions.
- Ramp confirmation + Carbon mappings are the operational ledger; there is no separate Ramp
  sync-operation table.
- Only `Charge`/`Credit` (with a supplier) become provider charge objects; the policy is per row.

## Verification and remaining risk

Automated coverage: Ramp client/model/service/coding/money/state/hooks tests, cursor/policy
tests, atomic card/bill/payment/reimbursement tests, real-database staging integration tests,
post-card-transaction transaction/concurrency tests, OAuth state/callback tests, and
accounting-provider charge/reimbursement tests. Live-verified on the Ramp sandbox 2026-08-28
(scopes granted) and the Rillet sandbox 2026-09-10/09-11 (draft-bill push, charge/credit,
reimbursement, void). QBO has no sandbox — its charge adapter ships VERIFY-flagged like its
payment push. Xero SPEND/RECEIVE remains unverified.

Remaining risks and gaps:

- **Multi-entity outbound.** With more than one Ramp entity and no configured `entityId`,
  outbound PO/bill push falls back to the first business entity — ambiguous for a multi-entity
  business. Recommended follow-up: refuse outbound creation with a setup error instead of guessing.
  Inbound all-entity behavior is intentional.
- **Unmapped PO recovery / number collisions.** `pushPurchaseOrder` is mapping-first with an
  entity-scoped idempotency key but does not pre-match an unmapped PO by `external_id`, and a true
  `purchase_order_number` collision is not surfaced as a dedicated error. Recommended follow-up:
  pre-match by `external_id`; surface (never silently rename) a true collision.
- **API contracts still sandbox-unverified**: the exact webhook signing/challenge contract, and
  repayment funding beyond documented `ach`. Bill-payment methods and reimbursement states use
  explicit supported sets checked against Ramp's 2026-09-11 OpenAPI; unknown values fail closed.
- **Rillet reimbursement payments** are blocked on Rillet's API (no reimbursement-payment
  endpoint); a Ramp-paid reimbursement stays UNPAID in Rillet and Carbon's payment push parks it
  Skipped/Warning `UNSUPPORTED_REIMBURSEMENT_PAYMENT` with a visible reason.
- **One active connection per company.** Installing Carbon may replace a direct Ramp-to-provider
  topology. A fresh Carbon DB against a Ramp business that already has a Carbon connection needs
  its `connectionId` adopted by hand.
- **OAuth production application + scopes** remain external dependencies (repository tests cannot
  establish provider approval).
- **Historical `supplierId` backfill**, a `costCenter` event trigger (hourly converge is the same
  guarantee accounts get), a per-merchant "Merchant" GL dimension, and `Payment`-type transfers
  as QBO `CreditCardPayment` / Xero `BankTransfers` are deferred follow-ups.
- User-facing `docs/` are a separate follow-up.

## Changelog

- **2026-08-20** (`ramp-transaction-sync`): created after research and user resolution of the
  major domain decisions — new `cardTransaction` document, five card types, bills/payments/
  reimbursements/repayments families, outbound PO + draft-bill push, sweep cursors, invoicing
  permissions, cost centers as the first pushed dimension.
- **2026-08-28** (`ramp-oauth-and-production-hardening`): replaced client-credentials setup with
  the production OAuth Connect flow (signed single-use state, key-owned metadata patches,
  non-rotating refresh, settings-gated convergence). Retained multi-entity and PO-recovery gaps.
- **2026-09-10/09-11** (project coding + Rillet charge sync, nuclear remediation, migration-order
  reconciliation, sync-module extraction): fixed the cost-center round-trip
  (`category_info.external_id` match, idempotent field/option diff, dimension ensure); added
  native provider charge objects (per-row `DOC_BACKED`) and Rillet reimbursements; reconciled the
  card schema **forward to composite `(id, companyId)`** (superseding the original single-column
  plan); made staging/posting transactional, idempotent, and tenant-safe; verified amounts read
  `entity_amount.value` in minor units (the deprecated `amount` was a major-unit float);
  **shipped draft-bill export as draft-only** (removed the `RAMP_DRAFT_BILL_CONTRACT_VERIFIED`
  gate, never submits, no bill archive-on-settlement); **removed the `codingAccountScope`
  setting** (every classifiable account pushed VISIBLE).
- **2026-09-11/09-12** (accounting projects): Projects CRUD, the Project dimension, and the
  `carbon-project` Ramp field + inbound round-trip. Superseded the CostCenter-as-"Project"
  practice.
- **2026-09-17** (card-merchant modeling): replaced per-merchant supplier auto-create with the
  single `"Card Merchant"` catch-all; merchant identity moved onto the charge line description.
- **2026-09-19**: consolidated the four source specs into this as-built document.
