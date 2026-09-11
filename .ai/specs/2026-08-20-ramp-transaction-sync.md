# Ramp Integration — Transaction Sync (Cards, Bills, Payments, Reimbursements)

> Status: active implementation; provider-contract release gates and remaining uncertainties
> are explicitly marked in `.claude/rules/ramp-integration.md` and source comments.
> Author: Brad Barbin + Claude
> Date: 2026-08-20
> Research: `.ai/research/ramp-transaction-sync.md`
> Related specs: `.ai/specs/2026-07-02-bank-reconciliation.md`,
> `.ai/specs/implemented/2026-08-05-accounting-document-representation.md`,
> `.ai/specs/implemented/2026-08-15-integration-secret-encryption.md`, and
> `.ai/specs/2026-08-28-ramp-oauth-and-production-hardening.md`

## TLDR

Carbon is a Ramp accounting provider and remains the books of record. It pushes Carbon's chart
of accounts and cost centers to Ramp for coding, pulls ready spend into Carbon documents, posts
those documents, and confirms only observable success to Ramp. An hourly Inngest sweep is the
correctness floor; the webhook is a latency hint.

Cleared, coded card spend becomes `cardTransaction`: Charge/Credit journals move between coded
accounts and the mapped card liability; Payment/Cashback/Repayment types settle or reverse that
liability. Ramp bills become posted `purchaseInvoice` records. Bill payments on an explicitly
supported bank rail become posted AP `payment` + `invoiceSettlement` records;
one-time-card-delivery payments are confirmed without a second payment. Reimbursements become
employee-supplier purchase invoices and, when Ramp-paid, AP payments. Carbon pushes released POs
to Ramp. Posted purchase-invoice export remains disabled until the draft-bill API contract is
sandbox-verified.

New connections use Carbon's production OAuth Connect flow. Existing stored client-credentials
records remain readable, but the UI does not create them.

## Problem statement

Without the integration, controllers re-key Ramp activity and can book the wrong liability.
Card spend is not an AP invoice: the merchant was paid at swipe and Ramp is the creditor. Ramp
Bill Pay can also leave a Carbon invoice open after cash moved, causing duplicate payment and AP
aging errors. The integration gives each movement one Carbon document, one idempotent external
mapping, and a posting that can flow onward to the configured accounting provider.

## Architecture

| Concern | Implemented path |
|---|---|
| Integration config/lifecycle | `packages/ee/src/ramp/config.tsx`, `hooks.server.ts` |
| Ramp API/model/state | `packages/ee/src/ramp/lib/{client,models,state}.ts` |
| Ramp service domains | `connection.ts`, `chart-of-accounts.ts`, `cost-centers.ts`, `suppliers.ts`, `spend.ts`, `sync-confirmation.ts`, `webhooks.ts`; `service.ts` remains the stable facade |
| OAuth callback | `apps/erp/app/routes/api+/integrations.ramp.oauth.ts` |
| Webhook | `apps/erp/app/routes/api+/webhook.ramp.$companyId.ts` |
| Durable sync | thin `ramp-sync.ts` coordinator + `ramp-sync-{shared,card,bill,reimbursement-family,repayment,outbound}.ts`; hourly `ramp-sweep.ts` |
| Payment staging | `ramp-sync-payment.ts` |
| Reimbursement staging | `ramp-sync-reimbursement.ts` |
| External identity | `externalIntegrationMapping` with integration `ramp` |
| Card posting | `packages/database/supabase/functions/post-card-transaction/` |
| ERP reads/UI | invoicing service, card-transactions routes, `ui/CardTransaction/` |
| Integration state | service-role `upsert_company_integration_patch` RPC via `patchIntegrationState` |

Ramp is a spend source, not an accounting `ProviderID`. Its Carbon journals and documents can
continue through the accounting synchronization engine. A Charge, and provider-supported
Credit, with a supplier uses the provider's native `charge` object; its Card Transaction journal
is classified `DOC_BACKED` to prevent duplicate GL representation. Other card types remain
journal-backed. See `.claude/rules/accounting-sync-handlers.md`.

## Connection and convergence

The settings descriptor is active only when public `RAMP_CLIENT_ID` exists. It exposes OAuth plus
flat entity/account/coding/sync settings; no customer id/secret inputs or environment selector.
The callback validates signed single-use state bound to integration/user/company, exchanges the
code, and applies `patchRampOAuthCredentials`. Access/refresh tokens are Vault secrets;
credential type/environment/expiry are plaintext metadata.

Ramp writers use operation-owned dot-path patches:

- settings: `patchRampSettings`
- OAuth connect/reconnect: `patchRampOAuthCredentials`
- token refresh: `patchRampRefreshedTokens`
- connection/webhook: `patchRampConnection`, `patchRampWebhook`
- cursors: `patchRampCursor`
- uninstall cleanup: `clearRampConnectionState`

The RPC advisory-locks the logical integration row, locks the row when present, patches metadata
and the Vault secret bag, and updates `secretRef`/activation/audit fields in one database
transaction. Connect/reconnect and background writers therefore preserve keys they do not own.

`convergeRamp` first validates access, ensures the accounting connection, and best-effort
registers the webhook. A fresh OAuth row has no account mappings, so convergence stops there: no
master-data push and no finance sync. After the required liability and bank mappings (and an
optional valid entity) are saved, `rampOnUpdate` pushes the chart of accounts and cost centers
and requests a sync. A reconnect with preserved valid mappings may converge immediately.

## Sync loop

`rampSyncFunction` is concurrency-limited to one run per company. `ramp-sync.ts` owns context
construction, stable step ordering, result aggregation, and failure notification only. The
card, bill, reimbursement-family, repayment, and outbound modules own their workflows;
`ramp-sync-shared.ts` owns shared tenant/currency/file helpers. Each family remains isolated in
its own Inngest step so one failure does not abort the other families.

| Ramp family | Carbon result | Ramp confirm |
|---|---|---|
| Transactions `SYNC_READY` | Posted Charge/Credit `cardTransaction` | `TRANSACTION_SYNC` |
| Transfers `SYNC_READY` | Posted Payment `cardTransaction` | `TRANSFER_SYNC` |
| Cashbacks `SYNC_READY` | Posted Cashback `cardTransaction` | `STATEMENT_CREDIT_SYNC` |
| Bills ready/not synced | Posted `purchaseInvoice` | `BILL_SYNC` |
| Paid bill payments | Posted AP payment + settlement unless card-backed | `BILL_PAYMENT_SYNC` |
| Reimbursements `SYNC_READY` | Posted employee-supplier invoice, plus payment when Ramp-paid | `REIMBURSEMENT_SYNC` |
| Repayments from cursor | Posted Repayment `cardTransaction` | none exposed |
| Outbound Carbon rows | Ramp PO; draft-bill export release-gated; archive settled mapped bill | none |

All inbound rows are locally checked against the optional configured `entityId` before writes;
only endpoints with a verified query contract receive a remote `entity_id` filter. Account and
cost-center ids from Ramp coding are bulk-verified within the company/company-group boundary.
Unknown coding fails the item rather than silently dropping a dimension.

Amounts use verified wire shapes. Signed and currency values are integer minor units; the
deprecated transaction fallback is a major-unit decimal. Currency precision and the
foreign-per-base exchange rate come from Carbon. Card posting converts document to base by
division. Missing, fractional, non-finite, mismatched, or ambiguous values fail; the sync does
not guess two decimals or par FX.

### Confirmation and recoverability

`confirmSyncs` sends deterministic idempotency keys and omits empty success/failure arrays because
Ramp requires each present array to contain an item. A mapped item is re-confirmed without
re-creating the Carbon document. A confirm transport failure is recorded in the family result
and the still-ready Ramp item is handled again safely.

Failure does not universally mean “nothing was written.” The durable rule is:

- transactional staging either commits its full owned write set or none of it;
- a posting failure can leave an intentional Draft that a retry resumes;
- mapping and observable Posted state decide whether a retry may confirm;
- no family reports success merely because an edge response was ambiguous.

The bill-payment family in `ramp-sync-bill.ts` delegates each item to
`syncRampBillPayment`. `stageRampPaymentDraft` atomically creates/resumes the Draft
payment, settlement, and mapping and preserves its stored source-FX snapshot.
`createOrResumeRampPayment` posts, then requires a tenant-scoped reread to show Posted;
`syncRampBillPayment` owns the per-item workflow.

The list/confirm wrapper in `ramp-sync-reimbursement-family.ts` delegates each item to
`syncRampReimbursement`. `stageOrResumeRampReimbursementInvoice` uses a
company/external-id advisory lock and atomically creates/resumes the supplier interaction,
Draft invoice, delivery, all lines, and mapping. It can adopt only a uniquely identifiable
legacy untracked Draft. `syncRampReimbursement` posts the invoice and any Ramp-paid AP
payment, and returns success only after those states are observably Posted.

### Outbound cursors

The PO and invoice cursor fields store JSON-encoded `[updatedAt,id]` keysets in their existing
string slots. Legacy timestamp-only cursors replay the boundary inclusively. Each page advances
only across its contiguous successful prefix; a failed row and every later row remain eligible.
Each cursor update is a single key-owned metadata patch. Repayments retain their `repaid_at`
high-water policy, capped before the earliest failed item.

## Card transaction data and tenant boundary

The base Ramp migration is `20260820143726_ramp-integration.sql`; the authoritative forward
schema convergence is `20260911041045_reconcile-ramp-card-transactions.sql`. The latter is
retry-safe and reconciles the registry row, enum values, indexes, sequence, event trigger, RLS,
constraints, and lifecycle guards.

Both `cardTransaction` and `cardTransactionLine` use composite `(id, companyId)` primary keys
with `id()` defaults. Header-to-company, line-to-header, supplier, and cost-center relationships
are tenant-composite. Account integrity is enforced by triggers because `account` is
company-group scoped: every referenced account must belong to the card transaction's company's
group. RLS uses invoicing permissions.

The lifecycle trigger permits Draft edits, Draft→Posted bookkeeping fields, and Posted→Voided
audit fields. The line trigger locks the same parent row and accepts mutations only while Draft,
so line edits serialize with posting/voiding. Header account fields cannot change after Draft.
Migration `20260911130527_enforce-card-transaction-lifecycle-audit.sql` also stores the complete
status/audit invariant as a validated CHECK: Draft has no journal or posting/void audit values;
Posted has `postingDate`, `postedAt`, and `postedBy` but no void audit values; Voided has both
posting and void audit values. Posted/Voided may have no `journalId` when accounting is disabled.

Key header fields are the readable `cardTransactionId`, type/status, liability and optional
offset accounts, merchant/holder/card metadata, dates, currency/rate/amount, optional supplier,
journal link, and audit data. Lines carry the coded account, optional tenant cost center, amount,
and sequence. Payment/Cashback/Repayment require an offset account; Charge/Credit use lines.

ERP single-record reads require `(companyId, id)`. Auxiliary document, line, and cost-center
reads are company-scoped; account labels are restricted to the authenticated company's group.

## Transactional post and void

`postCardTransactionTransaction` opens one Kysely transaction and makes the tenant-scoped header
`FOR UPDATE` its first database read. Settings, company, lines, accounts, periods, journals,
dimensions, and lifecycle writes remain inside that transaction. Repeating post on Posted or
void on Voided returns the stored journal id without a second journal.

Post validates:

- active non-group posting accounts from the correct company group;
- Liability card account, Asset Payment offset, and Revenue Cashback offset;
- company-scoped cost centers and an active CostCenter dimension when a line uses one;
- a valid accounting period, shifting a locked/closed date to the next open period.

With accounting enabled it writes the balanced Card Transaction journal and dimension rows, then
marks the document Posted. With accounting disabled it marks the document Posted without a
journal, matching Carbon's no-GL mode.

Void accepts only Posted. If a journal exists, accounting must still be enabled and the original
tenant-scoped journal must be Posted, have source type Card Transaction, and have every line tied
to this document. Void writes a new Posted journal with negated amounts and copied dimensions,
then marks the document Voided. A document posted while accounting was disabled has no journal
and voids without inventing one.

The builder uses natural-balance-signed `credit()`/`debit()` amounts:

| Type | Journal |
|---|---|
| Charge | debit coded lines; credit card liability |
| Credit | credit coded lines; debit card liability |
| Payment | debit card liability; credit bank Asset |
| Cashback | debit card liability; credit Revenue offset |
| Repayment | debit funding offset; credit scaled original coding lines |

## Outbound and master-data rules

- Chart-of-accounts push sends active non-group accounts in batches of 500. Under the default
  expense coding scope, only Expense accounts plus the configured card liability remain visible.
- Cost centers converge into one custom single-choice field, diffing create/rename/hide/restore
  operations and tracking field/option mappings.
- Released POs are created with `external_id: po.id`, required currency/entity fields, and an
  entity-scoped idempotency key; mapped POs PATCH, while mapped Completed/Closed POs archive.
- Purchase-invoice export is fail-closed before any provider I/O until the draft-bill and submit
  contract is sandbox-verified. Once that explicit code gate is enabled, the prepared path uses
  `/bills/drafts` followed by submit and never the auto-approved bill-create path. Mapped
  Paid/Voided Carbon invoices archive remotely; status reads are bounded so mappings beyond
  PostgREST's row cap are not omitted, and lookup/archive failures are reported by the family.
- An absent outbound entity setting currently falls back to the first Ramp business entity. This
  remains a documented multi-entity hardening gap.

## Webhook and sweep

The webhook resolves the active integration and vaulted secret. Every request, including a
challenge, requires a valid HMAC-SHA256 signature over the raw body; only a signed-body challenge
is accepted. Payloads are nudges only: the route triggers
`ramp-sync`, which re-fetches authoritative state. Header/signing/challenge details remain
source-marked for provider verification.

`rampSweepFunction` runs hourly, lists active Ramp integrations, and emits one sync event per
company. This is the correctness guarantee when webhook delivery, registration, or connect-time
enqueue fails.

## Decisions retained from the original design

- New `cardTransaction` document; no AP invoice for card spend.
- Payment, Cashback, and Repayment remain card-register transaction types.
- Reimbursements use employee-as-supplier purchase invoices and payments.
- Cost centers are the v1 pushed line dimension; items, customers, and suppliers are not Ramp
  coding dimensions.
- Carbon POs push automatically when enabled. The invoice flag retains retry eligibility, but
  draft-bill export fails closed until its provider contract is sandbox-verified and the code
  release gate is explicitly enabled.
- Optional entity filter; blank means all inbound entities. The outbound first-entity fallback is
  retained only as an explicit hardening gap.
- Invoicing module and permissions own card transactions.
- Ramp confirmation plus Carbon mappings are the operational ledger; there is no separate Ramp
  sync-operation table.

## Verification and remaining risk

Automated coverage includes Ramp client/model/service/coding/money/state/hooks tests, cursor and
policy tests, atomic card/bill/payment/reimbursement tests, real-database transaction integration
tests, post-card-transaction integration tests, OAuth state/callback tests, and
accounting-provider charge tests. Connected verification is still required for the draft-bill
payload/submit identity, repayment funding beyond documented `ach`, and the exact webhook
signing/challenge contract. Bill-payment methods and reimbursement states use explicit supported
sets checked against the 2026-09-11 provider schema; unknown values fail closed.

Other retained risks:

- Ramp allows one active accounting connection; installing Carbon may replace a direct
  Ramp-to-provider topology.
- Existing remote supplier/vendor and PO-number collisions require human cleanup or a future
  pre-match hardening path.
- Hourly recovery bounds missed-webhook staleness but does not make provider outages invisible.
- The OAuth production application and requested scopes remain external dependencies.

## Changelog

- 2026-08-20: Created after research and user resolution of the major domain decisions.
- 2026-08-20: Added repayments and automatic submitted-draft invoice push per user direction.
- 2026-08-20 plan phase: chose sweep cursors, invoicing permissions, dynamic account options,
  and cost centers as the first pushed dimension.
- 2026-09-10: Added merchant suppliers and native accounting-provider charge objects.
- 2026-09-11: Refreshed to the implemented OAuth flow, atomic key-owned integration state,
  composite tenant-safe card schema, transactional post/void, stable outbound keyset cursors,
  and transactional Ramp payment/reimbursement staging. Removed the obsolete client-credentials
  setup, immediate-install-sync, read/merge/write metadata, single-column card key, and
  non-atomic posting descriptions.
- 2026-09-11: Recorded the signed-challenge requirement, supported financial discriminators,
  bounded archive status reads, and the fail-closed draft-bill release gate.
