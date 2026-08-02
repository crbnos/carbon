# Accounting Sync Engine v2 — Multi-Provider Refactor, Posting Sync, QuickBooks

> Status: draft
> Author: Brad Barbin + Claude
> Date: 2026-07-09
> Research: [.ai/research/quickbooks-accounting-sync-engine.md](../research/quickbooks-accounting-sync-engine.md)
> Related specs: [2026-07-04-integration-surface.md](2026-07-04-integration-surface.md) (public JE
> import/export APIs + webhooks — complementary, not overlapping: that spec is Carbon *as a sync
> target*; this spec is Carbon *as a sync source*)

## TLDR

Refactor the Xero-centric accounting integration (`packages/ee/src/accounting/`) into a
provider-agnostic **accounting sync engine**, add **posting (GL) sync** — journal entries for
inventory economics pushed to the provider, alongside the existing document sync for AR/AP —
and add **QuickBooks providers**: QuickBooks Online (OAuth2/REST) and QuickBooks Desktop
Enterprise 24 (Web Connector transport, vendor-bridged or self-hosted behind an internal
transport interface). Four phases: **A** engine hardening + durable sync-operation ledger +
error inbox; **B** posting sync shipped on Xero; **C** QuickBooks Online provider; **D**
QuickBooks Desktop provider (transport decision gated — Ask First). The combined plan covers
Phases A+B; C and D get their own plans after the Phase-D transport veto.

## Problem Statement

1. **The integration is Xero-shaped even where it pretends not to be.** The core abstraction
   exists (`BaseEntitySyncer`, `SyncFactory`, `externalIntegrationMapping`), but
   `ProviderCredentialsSchema` has a single `oauth2` variant carrying Xero-specific
   `tenantId`/`tenantName` (`packages/ee/src/accounting/core/models.ts:23`), per-company
   `syncConfig` is parsed but ignored in favor of `DEFAULT_SYNC_CONFIG`
   (`core/service.ts`), and the `AuthProvider` contract assumes an OAuth
   authorize-URL/exchange/refresh flow. QuickBooks Desktop — the requested target — has **no
   OAuth and no REST API at all**: its only cloud channel is the QuickBooks Web Connector, a
   Windows app that *polls our endpoint* with qbXML. The current engine cannot express that
   provider.

2. **Nothing posts.** The engine syncs operational documents (customers, vendors, items, POs,
   invoices, bills) but none of Carbon's GL output: no journal entity type, no account
   mapping, no COGS/inventory-adjustment/WIP postings reach the provider. For the
   Fishbowl/MISys-style customer — Carbon runs the shop, QuickBooks keeps the books — posting
   sync *is* the product.

3. **Sync state is invisible and non-durable.** A push is an Inngest job with a 60s cooldown;
   the only persistent state is `lastSyncedAt`/`remoteUpdatedAt` on the mapping row. There is
   no per-record status a user can see, no error queue, no retry/skip levers, no
   reconciliation. Every reference architecture surveyed (SAP IDoc/BD87, Cin7's
   Synchronization Report, Celigo's error inbox, Stripe's idempotency-key state machine)
   treats this as table stakes *before* pushing financial data — and QB Desktop's polling
   transport structurally requires a durable work queue anyway.

## Proposed Solution

### Architecture overview

```
                        Carbon change sources
   DB-write events (PGMQ → carbon/event-sync)   backfill   webhooks   manual retry/re-send
                │                                  │           │            │
                ▼                                  ▼           ▼            ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │  accountingSyncOperation (NEW — durable outbox / per-record ledger) │
        │  Pending → InFlight → Completed | Failed | Warning | Skipped        │
        └─────────────────────────────────────────────────────────────────────┘
                │ drained by Inngest (REST providers: immediately)
                ▼
        SyncFactory.getSyncer(entityType) ──► BaseEntitySyncer subclasses
                │                                    │
                ▼                                    ▼
        Provider (XeroProvider │ QboProvider │ RilletProvider)
```

Entity sync (documents) keeps its current shape — syncers, mapping table, direction/owner
config — but every push/pull is recorded as a sync operation. Posting sync is a new
`journalEntry` entity type whose syncer reads Posted journals and writes provider journal
entries (Xero Manual Journals, QBO JournalEntryAdd, Rillet journal entries), with account mapping resolved through
`externalIntegrationMapping(entityType='account')`.

### Phase A — engine hardening + sync-operation ledger

1. **Credentials become a real union.** `ProviderCredentialsSchema` gains variants:
   - `oauth2` — generic (accessToken, refreshToken, expiresAt, scope) + `providerMetadata`
     JSONB for provider-specific fields (Xero `tenantId`/`tenantName`, QBO `realmId`).
     Existing stored credentials are read through a compatibility shim (old flat shape →
     new shape on read; written back in new shape on next refresh).
   - `apiKey` — key-based REST providers (Rillet): `apiKey`, `environment`
     (production|sandbox), `providerMetadata` (Rillet: `subsidiaryId`, `webhookToken`).
     (Replaced the `webConnector` variant when QBD was removed on 2026-08-01.)
   - `bridge` — vendor-managed connection: `vendor` (e.g. `"conductor"`),
     `externalConnectionId` (e.g. Conductor end-user id). Vendor API keys are platform env
     vars, never per-company rows.
2. **Provider contract v2.** `BaseProvider` drops the OAuth assumptions: auth strategies
   (`OAuth2AuthStrategy` shared by Xero/QBO; `WebConnectorAuthStrategy`; `BridgeAuthStrategy`)
   and a `capabilities` object (`transport: "rest" | "polled"`, `supportsWebhooks`,
   `supportsJournalPush`, `maxBatchSize`). Xero-isms (tenant discovery via `GET /connections`,
   `xero-tenant-id` header, 100/page pagination, .NET date parsing) move fully inside
   `XeroProvider`.
3. **Per-company sync config applied.** `getAccountingIntegration()` deep-merges
   `companyIntegration.metadata.syncConfig` over `DEFAULT_SYNC_CONFIG` per entity
   (enabled/direction/owner). Settings UI exposes per-entity toggles (enable + direction,
   constrained to directions the syncer supports).
4. **`accountingSyncOperation` table** (Data Model below): one row per attempted sync of one
   entity in one direction. Enqueue instead of direct-dispatch in the three existing entry
   points (`events/sync.ts`, `sync-external-accounting.ts`, `accounting-backfill.ts`); a
   drain step executes operations through the existing syncers and records outcome, attempts,
   and provider error text. Cooldown/dedup: an existing `Pending` operation for the same
   (entityType, entityId, direction, integration) absorbs re-triggers instead of creating a
   duplicate row.
5. **Sync activity + error inbox UI.** New tab on the integration detail page
   (`x+/settings+/integrations.$id.tsx`): operations table (status chip, entity, direction,
   trigger, attempts, last attempt, error message), row actions **Retry** (Failed/Warning →
   Pending), **Skip**, **Re-send** (Completed → Pending), bulk retry, and a status filter.
   Statuses follow Cin7's proven semantics (research Consensus Pattern 4). In-app only in v1
   (no email digest).

### Phase B — posting sync (shipped on Xero)

1. **Account mapping.** Map Carbon `account.id` → provider account through
   `externalIntegrationMapping(entityType='account', integration, externalId=<provider
   account id/code>)` — per `.ai/lessons.md`, external codes are legitimate only as mapping
   keys; resolution is always to Carbon account **id**. Settings UI section lists Carbon
   posting accounts (accounts referenced by `accountDefault`, `itemPostingGroup`, and any
   account with posted journal lines), each with a provider-account picker (chart fetched via
   the existing accounts route), plus a "Match by code" bulk action. **Pre-flight rule (SAP
   lesson): an unmapped account on a pushable journal → operation lands `Warning`, never a
   provider error.**
2. **`journalEntry` entity type + `JournalEntrySyncer`.** Push-only. Source: `journal` rows
   reaching `status='Posted'`, filtered by `sourceType`:
   - **Push by default**: Purchase Receipt, Sales Shipment, Transfer/Inbound/Outbound
     Transfer, Inventory Adjustment, Inventory Count, Production Order, Production Event,
     Job Consumption, Job Receipt, Job Close, Asset Depreciation, Asset Disposal.
   - **Hard-excluded** (their financial representation is the synced *document*; pushing both
     double-posts): Sales Invoice, Purchase Invoice, Payment, Credit Memo, Debit Memo,
     Sales Return, Purchase Return.
   - **Manual**: off by default, per-company toggle.
   - **Safety net**: any pushable journal containing a line on a mapped AR/AP control account
     (`accountDefault.receivablesAccount`/`payablesAccount`) → `Warning`, never pushed
     (also keeps QBD's one-AR/AP-line-per-JE constraint unreachable).
   Trigger: add `journal` to the event system (event trigger migration + entry in
   `TABLE_TO_ENTITY_MAP`, `packages/jobs/src/inngest/functions/events/sync.ts:36`). Enqueue on:
   (a) **INSERT with `status='Posted'` and `reversalOfId IS NULL`** — Carbon's `post-*` edge
   functions insert journals born Posted (never UPDATEd from Draft), so INSERT is the posting
   event on the main path; reversal inserts (`reversalOfId` set) skip because they are
   represented by (c); (b) UPDATE transitioning to `Posted` (covers Draft→Posted flows, e.g.
   approval-gated manual JEs); (c) UPDATE transitioning to `Reversed` → the reversal push.
   Same-status UPDATEs never enqueue. Independent of the integration-surface spec's public
   webhooks (#1059) — this is the internal path. *(Amended 2026-07-09 during implementation:
   the original UPDATE-transition-only rule missed that posting functions INSERT journals as
   Posted.)*
3. **Consolidation.** Per-company setting: `Individual` (default — one provider journal per
   Carbon journal) or `Daily summary` (Inngest cron aggregates the day's pending journal
   operations into one provider journal per posting date, lines grouped per account; memo
   carries count + Carbon reference for drill-back). Cin7/MRPeasy precedent.
4. **Reversals.** `journal.status → 'Reversed'` enqueues a reversing push referencing the
   original mapping (Xero: new reversing manual journal; metadata links both). Never delete
   or mutate in the target (SAP reversal-by-reference).
5. **Period-lock policy.** Per-connection setting: `Park as error` (default — postingDate
   older than the provider lock date → `Warning` pre-flight) or `Re-date to first open day`
   (original date preserved in the journal narration; NetSuite pattern). Lock date: queried
   from Xero org settings; **manually captured** for QBO (its API cannot read the close
   date); QBD statusCode 3170 handled as `Warning`.
6. **Idempotency.** The sync-operation `idempotencyKey` = `journal.id` (+ consolidation batch
   key for daily mode); provider-side: Xero manual-journal `Narration` carries the Carbon
   journal id and the mapping row stores the provider id — retry checks mapping-before-insert.
7. **Reconciliation job (minimal v1).** Weekly Inngest cron per connection: (a) presence check
   — every `Completed` journal operation's `externalId` still exists remotely; (b) aggregate
   check — sum of Carbon-pushed journals per account/month vs sum of the corresponding
   provider journals. Drift renders as a report section on the sync-activity tab. Deeper
   trial-balance tie-out deferred.

### Phase C — QuickBooks Online provider

`QboProvider` using the existing `quickbooks` integration stub (`packages/ee/src/quickbooks/
config.tsx` — already `appcenter.intuit.com` OAuth2): `realmId` in `providerMetadata`, minor-
version-pinned REST client, token refresh on 401 like Xero. Entity syncers: customer, vendor,
item (created as **Non-inventory/Service** — QBO item-level inventory tracking stays off, per
research Consensus Pattern 2), invoice, bill, purchaseOrder, journalEntry (JournalEntry API).
Pull: scheduled cursor on `MetaData.LastUpdatedTime` via the Change Data Capture endpoint;
QBO webhooks are a stretch goal. Closed-books date: captured from the admin at connect time
(setting), pre-flight validated. Requires Intuit app credentials (`QUICKBOOKS_CLIENT_ID`
already referenced from `@carbon/auth`).

### Phase D — QuickBooks Desktop provider (REMOVED 2026-08-01)

Phase D shipped (self-hosted QBWC SOAP endpoint, qbXML layer, `qbwcSession`
table, polled-transport drain gate) and was then **removed in full on
2026-08-01** in favor of a Rillet provider: QuickBooks Desktop was dropped
from the product. The QBWC/qbXML implementation, its migration, routes, UI,
`fast-xml-parser` dependency, the `webConnector` credentials variant, and
the `"polled"` transport were all deleted. QuickBooks Online (Phase C) and
Xero are unaffected.

Its replacement is the **Rillet provider** (`providers/rillet/`): API-key
REST transport (`Authorization: Bearer` + pinned `X-Rillet-API-Version: 4`),
push-only journal/customer/vendor/item/invoice(AR_ONLY)/bill syncers,
chart-of-accounts pull for account mapping, and the codebase's first
`payment` syncer — inbound AR invoice payments via a signed webhook
(`/api/webhook/rillet/:companyId`, HMAC-SHA256 over
`$timestamp.$id.$entity.$event.$body`) that writes Carbon `payment` +
`invoiceSettlement` rows and flips `salesInvoice` status.

### Phase E — Generic pull sweep (added 2026-08-01)

Webhooks are a latency optimization, not the correctness guarantee: Rillet
disables a webhook after repeated delivery failures, Xero's inbound sync
was webhook-only, and firewalled self-hosted instances cannot receive
webhooks at all. The **accounting-pull-sweep** cron
(`packages/jobs/.../accounting-pull-sweep.ts`, every 30 min) is the
guarantee. Providers opt in by implementing `SupportsIncrementalPull`
(`listChanges({ since })` → normalized `ProviderChange[]`, optional
`pullLookbackDays` cap): QBO wraps Intuit CDC (folded from the former
`quickbooks-cdc.ts`; 29-day clamp now provider-declared), Rillet lists
changed invoice payments via `GET /invoice-payments?updated.gt` with a
composite `<invoiceRemoteId>:<paymentRemoteId>` entity id. Cursor state
lives at `metadata.settings.pullCursor` (advance-after-drain, Celigo
rule); the ledger's idempotency + cooldown make webhook- and
sweep-triggered pulls collapse into one operation.

**Multi-instance Rillet** (several self-hosted Carbon databases writing to
one Rillet org as different subsidiaries): outbound partitions naturally by
the per-instance `subsidiaryId` (stamped on journals/invoices/bills, plus a
`carbon-company` external reference for audit); inbound ownership is
decided by the local invoice mapping — the sweep drops changes whose
`dependsOnMapping` is absent (no ledger noise), and the payment syncer's
`shouldSync` benignly skips webhook-delivered payments on unmapped invoices
(another instance's subsidiary, or a Rillet-native invoice).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Two QuickBooks providers vs one | Separate `quickbooks-online` and `quickbooks-desktop` providers | They share nothing — auth (OAuth2 vs QWC/password), transport (REST vs polled qbXML), IDs, data model (research §QBD surface) |
| Sync-state storage | New `accountingSyncOperation` table (durable outbox), not Inngest state | Canon (SAP IDoc queue, Stripe idempotency rows, Cin7 sync report); QBD polling requires a durable queue; users need a visible inbox |
| Status lifecycle | `Pending → InFlight → Completed \| Failed \| Warning \| Skipped` | Cin7's proven semantics: Failed auto-retries, Warning waits for a human, Skipped is permanent opt-out, Completed→Pending is manual re-send |
| Posting model | Documents for AR/AP (existing syncers) + journal entries for inventory economics | Industry consensus (Fishbowl, MISys, Cin7, SOS, Katana, Unleashed, MRPeasy — research Consensus Pattern 1) |
| Double-posting prevention | Hard-exclude doc-backed sourceTypes from journal push + AR/AP control-account safety net | The invoice document already books Dr AR/Cr Revenue in the provider; pushing its journal too would double-post |
| Account mapping storage | `externalIntegrationMapping(entityType='account')`, resolve to Carbon `account.id` | `.ai/lessons.md`: external codes only as mapping keys; reuses existing table + service, no new mapping table |
| Account mapping UI shape | Flat list of Carbon posting accounts → provider account picker + code-match bulk action | Flat defaults + per-entity assignment (Carbon doctrine, `feedback_no_matrix_config`); Cin7/Fishbowl/MISys all ship flat mapping pages |
| Consolidation | Per-company `Individual` (default) / `Daily summary` | Cin7 per-channel consolidation + MRPeasy daily journal; summary for high-volume shops without a matrix of options |
| Reversals | Push reversing entries referencing the original; never delete/mutate in target | SAP reversal-by-reference; Fishbowl's delete-and-replace is the documented anti-pattern |
| Period-lock handling | Pre-flight validation + per-connection policy: park (default) / re-date-to-open | Consensus Pattern 7; QBO API can't read the close date so it must be captured at connect time |
| Journal push trigger | Event system (`journal` added to event triggers + `TABLE_TO_ENTITY_MAP`) | Same mechanism as existing entity push; independent of #1059's public webhooks; ~1 min latency acceptable for posting sync |
| Credentials schema | Discriminated union `oauth2 \| webConnector \| bridge`, provider-specifics in `providerMetadata` | QBD cannot be expressed as oauth2; tenantId/realmId are provider metadata, not shared shape |
| QBD transport | **Self-hosted QBWC endpoint** (`QbwcTransport`); `QbdTransport` interface retained so a bridge stays a future swap-in | **Decided by Brad 2026-07-09** (see Open Questions): full control, no per-company-file vendor fee, no bridge-vendor shutdown exposure; the customer-support tail is accepted scope |
| QBWC endpoint hosting | ERP resource route `api+/integrations.quickbooks-desktop.qbwc.ts` (raw SOAP over HTTPS) | The queue + syncers live in Node (`@carbon/ee`, `@carbon/jobs`); Deno edge functions cannot import them; a resource route can return `text/xml` and is rate-limitable via `@carbon/kv` |
| QBWC session state | `qbwcSession` Postgres table (ticket = row id) | Serverless ERP has no instance memory; sessions must survive hops; Postgres over Redis for auditability + house RLS consistency |
| XML library | `fast-xml-parser` (build + parse qbXML/SOAP) | No XML library exists in the repo; pure-JS and dependency-free; SOAP envelopes are hand-rolled templates (fixed 8-operation WSDL) — approved as part of the build decision |
| QBWC password handling | Node `crypto.scrypt` hash + `timingSafeEqual` compare; password shown once at generation | No new dependency; QBWC stores the password client-side, we store only the hash in the `webConnector` credentials variant |
| QBWC write safety | `newMessageSetID`/`oldMessageSetID` error recovery on every writing batch + RefNumber/Memo stamping + query-before-insert | Mandated by the QBWC Programmer's Guide; RefNumber uniqueness is NOT enforced by QB, so recovery + stamping together prevent double-posting across dropped connections |
| QBD item representation | 1:1 Non-inventory items, QB inventory features off (setup prerequisite) | More legible than Fishbowl's FB_Item placeholder; avoids double COGS (Consensus Pattern 2); Enterprise list limits are ample |
| Multi-tenancy (heuristic 1) | `accountingSyncOperation` has `companyId`, composite PK `("id","companyId")`, `id('syncop')` default, audit columns | Golden rules |
| Service shape (heuristic 2) | New service fns in `packages/ee/src/accounting/core/` take `client` first, return `{data, error}` | `conventions-services.md`; matches existing `ExternalIntegrationMappingService` |
| RLS (heuristic 3) | `accountingSyncOperation`: SELECT for company members; INSERT/UPDATE/DELETE service-role only (mirrors `externalIntegrationMapping` policies) | Sync writes happen in jobs/edge context; users only read + trigger status changes through actions |
| Permissions (heuristic 4) | Sync activity/mapping routes under `x+/settings+/integrations.$id` reuse that route's `settings` scoping; mutating actions require `settings_update` | Same gate as existing integration configuration |
| Forms (heuristic 5) | Mapping + config forms use `ValidatedForm` + zod validators + route actions | `conventions-forms.md` |
| Module layout (heuristic 6) | All engine code stays in `packages/ee/src/accounting/` (core + providers/{xero,quickbooks-online,quickbooks-desktop}); no new ERP module; UI components under existing settings routes | `packages/ee/AGENTS.md` layout; kebab-case dirs |
| Backward compat (heuristic 7) | Credential read-shim; `externalIntegrationMapping` schema untouched; `DEFAULT_SYNC_CONFIG` behavior identical when no stored config; existing Xero mappings keep working | No public contract changes; EE-internal surfaces only |
| Plan gating | QBO/QBD registered in the `integrations` array with `FEATURE_PLANS` gates like Xero | `packages/ee/AGENTS.md`: FEATURE_PLANS is the single source of truth |
| DELETE sync | Still not implemented (log + skip), unchanged | `packages/ee/AGENTS.md` "Never"; deletion semantics differ per provider and are out of scope |

## Data Model Changes

One new table, one enum, one event-trigger wiring, no changes to existing tables.

```sql
-- Sync operation status (capitalized display values per enum conventions)
CREATE TYPE "syncOperationStatus" AS ENUM (
  'Pending', 'In Flight', 'Completed', 'Failed', 'Warning', 'Skipped'
);

CREATE TABLE "accountingSyncOperation" (
    "id" TEXT NOT NULL DEFAULT id('syncop'),
    "companyId" TEXT NOT NULL,
    "integration" TEXT NOT NULL,                -- provider id ('xero', 'quickbooks-online', ...)
    "entityType" TEXT NOT NULL,                 -- AccountingEntityType incl. new 'journalEntry'
    "entityId" TEXT NOT NULL,                   -- Carbon id (push) or remote id (pull)
    "direction" TEXT NOT NULL,                  -- 'push-to-accounting' | 'pull-from-accounting'
    "trigger" TEXT NOT NULL,                    -- 'event' | 'webhook' | 'backfill' | 'manual' | 'posting' | 'retry'
    "status" "syncOperationStatus" NOT NULL DEFAULT 'Pending',
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP WITH TIME ZONE,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "externalId" TEXT,                          -- provider id on success
    "metadata" JSONB,                           -- consolidation batch key, warning reason, links
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "accountingSyncOperation_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "accountingSyncOperation_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One live operation per record+direction+integration: partial unique absorbs re-triggers
CREATE UNIQUE INDEX "accountingSyncOperation_pending_uq"
  ON "accountingSyncOperation" ("companyId", "integration", "entityType", "entityId", "direction")
  WHERE "status" IN ('Pending', 'In Flight');
CREATE INDEX "accountingSyncOperation_inbox_idx"
  ON "accountingSyncOperation" ("companyId", "integration", "status", "updatedAt");
CREATE UNIQUE INDEX "accountingSyncOperation_idempotency_uq"
  ON "accountingSyncOperation" ("companyId", "integration", "idempotencyKey");

ALTER TABLE "accountingSyncOperation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT" ON "accountingSyncOperation" FOR SELECT
  USING ("companyId" IN (SELECT unnest(get_companies_with_employee_permission('settings_view'::text)))); -- mirror externalIntegrationMapping's exact helper in the migration
-- No INSERT/UPDATE/DELETE policies: writes via service role (jobs) only.
```

(The Phase D `qbwcSession` table was removed with QBD on 2026-08-01; its
migration was deleted before ever reaching main. The `integration` registry
gained a seed row for `rillet` instead.)

- **Event wiring**: migration attaches the standard event trigger to `journal` (same helper as
  existing event-system tables) so UPDATEs enqueue into PGMQ; the SYNC handler maps
  `journal → 'journalEntry'` and enqueues only on transition to `Posted`/`Reversed`.
- **Settings**: posting-sync config (enabled sourceTypes, consolidation, period-lock policy,
  provider lock date for QBO) lives in `companyIntegration.metadata.settings` — existing
  pattern, no schema change.
- **No changes** to `journal`, `externalIntegrationMapping`, or `companyIntegration` columns.
- After migration: `pnpm run generate:types` before typecheck (full-stack type chain).

## API / Service Changes

All in `packages/ee` unless noted; service functions take `client` first, return `{data, error}`.

- `accounting/core/models.ts`: credentials union (`oauth2` | `webConnector` | `bridge`);
  `journalEntry` added to `AccountingEntityType` + `ENTITY_DEFINITIONS` (depends on: account
  mapping); sync-operation zod schemas; provider `capabilities` type.
- `accounting/core/service.ts`: apply merged per-company `syncConfig`; credential read-shim.
- `accounting/core/operations.ts` (NEW): `enqueueSyncOperation()`, `claimPendingOperations()`,
  `completeOperation()`, `failOperation()`, `transitionOperation()` (retry/skip/re-send with
  status-transition guards).
- `accounting/core/account-mapping.ts` (NEW): `getAccountMappings()`, `upsertAccountMapping()`,
  `matchAccountsByCode()`, `getUnmappedPostingAccounts()` — thin wrappers over
  `ExternalIntegrationMappingService` with `entityType='account'`.
- `accounting/providers/xero/entities/journal-entry.ts` (NEW): `JournalEntrySyncer`
  (push-only; Manual Journals API; pre-flight account-mapping + period-lock + AR/AP-control
  validation; consolidation-aware).
- `providers/quickbooks-online/` (Phase C): `QboProvider` (OAuth2 via the shared strategy,
  `realmId` in `providerMetadata`), entity syncers (separate Customer and Vendor syncers —
  QBO has no dual-Contact), `journal-entry.ts` against the QBO JournalEntry API, CDC pull
  cron. **Prerequisite refactor (first C task): `SyncFactory` becomes a provider-keyed
  registry** — today `core/sync.ts` imports Xero syncers directly and switches on entityType
  only.
- (Phase D file surface — `providers/quickbooks-desktop/`, the QBWC SOAP
  route, the `.qwc` download route — was deleted with QBD on 2026-08-01;
  `providers/rillet/` + `api+/webhook.rillet.$companyId.ts` replace it.)
- `packages/jobs`: `events/sync.ts` — add `journal` to `TABLE_TO_ENTITY_MAP`, enqueue
  operations instead of direct dispatch; `sync-external-accounting.ts` /
  `accounting-backfill.ts` — enqueue + drain through operations; NEW
  `accounting-reconciliation.ts` cron; NEW daily-consolidation cron (both registered in the
  functions index — jobs AGENTS "Ask First" noted: registration is part of this spec's
  approved scope).
- ERP routes: `x+/settings+/integrations.$id.tsx` gains loader data + actions for sync
  activity (retry/skip/re-send), account mapping, and posting-sync settings; existing
  `api+/integrations.xero.accounts.ts` reused for chart fetch. Route actions follow
  flash/redirect conventions; no `Response.json`.

## UI Changes

On the integration detail page (`x+/settings+/integrations.$id.tsx`), for accounting-category
integrations:

1. **Sync activity tab**: operations table (status chip, entity type, entity link, direction,
   trigger, attempts, last attempt, error message), status filter, row actions
   Retry/Skip/Re-send, bulk retry. Uses existing `@carbon/react` table components; counts
   shown plainly (no parenthesized numbers).
2. **Account mapping section**: Carbon posting accounts ↔ provider account picker, unmapped
   accounts surfaced first, "Match by code" bulk action.
3. **Posting sync settings**: enable toggle, sourceType checklist (defaults per spec),
   consolidation (Individual/Daily), period-lock policy (+ manual lock-date field for QBO).
4. **Entity sync settings**: per-entity enable/direction from the applied `syncConfig`.
5. Detail views opened from the table use Drawer overlays (house convention).
6. **QBD connection card** (Phase D): generate-credentials action (password displayed once),
   .QWC file download, setup checklist (QB admin grant/unattended mode, QB inventory features
   off, account mapping, conversion date), health line ("Last poll: {relative time}") with a
   24h-stale Warning banner.

MES: no changes.

## Acceptance Criteria

Phase A
- [ ] With Xero connected, editing a customer creates an `accountingSyncOperation` row that
      transitions Pending → Completed, and the customer appears/updates in Xero (existing
      behavior preserved through the new ledger).
- [ ] A push that Xero rejects (e.g. invalid account code forced in a test) lands `Failed`
      with the Xero error text visible in the sync activity tab; Retry re-runs it; Skip
      permanently parks it; a Completed row can be Re-sent.
- [ ] Two rapid edits to the same customer produce one Pending operation (absorbed), not two.
- [ ] A company with `syncConfig.entities.item.enabled=false` in metadata no longer pushes
      items; a company with no stored config behaves exactly as today.
- [ ] Stored pre-refactor Xero credentials still authenticate (read-shim) and refresh writes
      the new shape.
- [ ] `pnpm --filter @carbon/ee test` and scoped typechecks pass; `pnpm run generate:types`
      run after the migration.

Phase B
- [ ] With all accounts mapped, posting a receipt in Carbon produces exactly one Xero manual
      journal whose lines match the Carbon journal (accounts via mapping, amounts, date), and
      the mapping row links `journal.id` ↔ Xero ManualJournalID.
- [ ] Posting a sales invoice produces **no** journal push (doc-backed exclusion) — only the
      existing invoice document sync.
- [ ] A pushable journal referencing an unmapped account lands `Warning` (no Xero call);
      mapping the account + Retry completes it.
- [ ] A journal dated before the Xero lock date lands `Warning` under the default policy; with
      re-date policy it posts to the first open day with the original date in the narration.
- [ ] Reversing a Carbon journal creates a reversing Xero manual journal; the original is
      untouched.
- [ ] Daily-summary mode: N same-day pushable journals produce one Xero manual journal with
      per-account aggregated lines; drill-back reference in the narration.
- [ ] Re-running a completed journal push (idempotency): no duplicate Xero journal.
- [ ] Reconciliation cron flags a manually-deleted Xero journal as drift in the report.

Phase C (accepted at its own plan)
- [ ] QBO: same acceptance set as Xero posting sync (documents + journals + inbox behavior),
      plus closed-books date captured at connect and enforced pre-flight, plus
      `SyncFactory` provider registry proven by both providers running side by side in one
      company-agnostic test.

Phase D — criteria retired with the QBD removal on 2026-08-01 (see the
Phase D tombstone). Rillet acceptance criteria live with its work on branch
feat/quickbooks-enterprise-v1: provider unit tests (headers, idempotency
keys, rate-limit mapping, RFC 9457 errors, chart normalization, sync-config
forcing), pure-mapper tests (journal DEBIT/CREDIT + UNMAPPED_ACCOUNTS,
contacts, payment status transitions), webhook signature tests, and a
sandbox live-fire gate (journal + AR_ONLY invoice push, signed
payment webhook → Carbon payment + settlement rows).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Double-posting if a doc-backed journal slips through the filter | High | Hard-exclusion list + AR/AP control-account safety net + idempotency keys + acceptance test |
| Refactor regresses live Xero sync | Med | Phase A keeps syncer behavior identical behind the ledger; credential shim; acceptance test on existing flows before B |
| QBWC support tail lands on us (QBWC1085, PC off after reboot, cert/TLS issues, company-file mismatch, Rightworks quirks) | Med | Health surface (last-poll + stale banner), remediation text on every Warning, customer-facing setup docs; `QbdTransport` keeps a bridge vendor as an escape hatch |
| qbXML protocol edge cases (windows-1252 encoding, field-length truncation, version drift across QB editions) | Med | Golden-fixture tests from real QB responses; pre-flight length validation (`NAME_TOO_LONG` Warning, never silent truncation); version taken from the session handshake, not assumed |
| Double-posting across dropped QBWC connections | High | `newMessageSetID`/`oldMessageSetID` recovery on every writing batch + RefNumber/Memo stamping + query-before-insert (three independent layers) |
| Event-system latency (~1 min) for posting sync | Low | Acceptable for books-sync; manual "Sync now" and backfill cover urgency |
| Consolidation math drift (rounding across aggregated lines) | Med | Aggregate per account with 2dp rounding at line level + balancing check before push; reconciliation cron catches residue |
| Per-provider feature skew over time (Katana's fate) | Med | Posting features live in core; providers implement narrow interfaces; capabilities flags gate UI |

## Open Questions

> HARD STOP: resolved before implementation. Autonomous resolutions (combined spec+plan
> request — accepted from research recommendations, surfaced for veto) are marked
> **Autonomous**. One question is Ask-First territory and remains BLOCKED for Brad.

- [x] **QBD transport: rent (Conductor) vs build (self-hosted QBWC)?** — **Answer (Brad,
      2026-07-09): build the self-hosted QBWC endpoint.** Carbon implements the QuickBooks
      Web Connector SOAP service itself (Phase D §design). The `QbdTransport` interface is
      retained so a bridge vendor remains a future swap-in option, and the research's
      operational caveats (customer keeps a Windows PC on, QBWC-not-a-service, cert/TLS,
      QBWC error zoo) are accepted as support scope. Implied by this decision and called out
      explicitly: one new production dependency for XML parsing/building (`fast-xml-parser` —
      no XML library exists in the repo today).
- [x] Product positioning for QB customers — **Autonomous:** Carbon's GL always stays on;
      sync is additive (journals out + documents per owner config); no suppression of Carbon
      accounting. Reversible, matches existing `DEFAULT_SYNC_CONFIG` owner semantics; a
      Fulfil-style minimal-bridge mode would be a scope reduction needing a product call.
- [x] Posting granularity default — **Autonomous:** Individual, with per-company Daily
      summary option (Cin7/Fishbowl default; MRPeasy summary for volume).
- [x] Which sourceTypes push — **Autonomous:** inventory-economics types on by default;
      doc-backed types hard-excluded; Manual off by default (see Phase B §2).
- [x] QBD item representation — **Autonomous:** 1:1 Non-inventory items; QB inventory
      features off as a documented setup prerequisite (research recommendation over FB_Item).
- [x] Payments push/pull in Phase B — **Autonomous:** remains disabled in v1; two-way invoice
      sync keeps status fresh; payment-application sync revisited with Phase C.
- [x] Dimensions → Xero tracking categories / QB classes — **Autonomous:** out of scope v1;
      documented follow-up (mapping table design deferred until posting sync is proven).
- [x] Employee/time sync (QBD TimeTrackingAdd) — **Autonomous:** out of scope v1.
- [x] Sync-state storage — **Autonomous:** durable `accountingSyncOperation` table (canon +
      QBD queue requirement), not Inngest-internal state.
- [x] Error notifications — **Autonomous:** in-app inbox only in v1; email digest deferred.

## Changelog

- 2026-07-09: Created after research (.ai/research/quickbooks-accounting-sync-engine.md);
  open questions resolved autonomously per combined spec+plan delegation, except QBD
  transport (Ask-First, BLOCKED for Brad — gates Phase D only). Plan for Phases A+B follows
  at .ai/plans/2026-07-09-accounting-sync-engine-phase-ab.md.
- 2026-07-09 (later): **QBD transport decided by Brad: build the self-hosted QBWC endpoint.**
  Phase D rewritten around `QbwcTransport` (SOAP resource route, `qbwcSession` table, qbXML
  layer over `fast-xml-parser` — new dependency called out, message-set error recovery,
  QWC/credential issuance UI, Windows-free protocol tests + manual QB gate). Phase C
  sharpened (provider-keyed `SyncFactory` refactor as its first task; split
  Customer/Vendor syncers). Plans added: .ai/plans/2026-07-09-accounting-sync-engine-phase-c.md
  and .ai/plans/2026-07-09-accounting-sync-engine-phase-d.md.
- 2026-08-01: **Phase D removed; Rillet provider added** (branch
  feat/quickbooks-enterprise-v1). QuickBooks Desktop/QBWC deleted in full
  (see the Phase D tombstone). Rillet: push-everything + inbound payment
  webhook; posting-sync defaults gained `Non-Conformance` and
  `Inbound Inspection` (quality scrap posting merged from main) and a
  config-aware Inventory Adjustment double-post guard.
