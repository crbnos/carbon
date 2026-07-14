# Integration Surface: TB API, JE Export/Import APIs, Accounting Webhooks

> Status: in-progress (open questions resolved pre-writing; Brad: "use our current stuff" — ride the existing API-key/MCP infrastructure, no new gateway)
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1059
> Research: `.ai/research/public-company-compliance.md` (§Ecosystem — integration surfaces the ERP must expose)
> Parent: `.ai/specs/2026-07-03-public-company-readiness.md` (finding GAP-E1, Phase 4)
> Siblings (parallel, referenced): `.ai/specs/2026-07-04-document-approvals.md` (JE approval engine — imported JEs route through it), `.ai/specs/2026-07-04-record-integrity-audit-hardening.md` (JE population export definition + `journal.bookId` book dimension), `.ai/specs/2026-07-02-period-closing.md` (period `closeStatus` lifecycle the import gate and webhooks consume)

## TLDR

Public-company customers surround their ERP with bolt-ons that Carbon will never build (research §Ecosystem: even NetSuite doesn't): BlackLine/FloQast pull the trial balance on a schedule to certify reconciliations, Workiva and FP&A tools (Adaptive/Pigment) pull TB + dimensions, auditors pull the full JE population, and Carta/payroll/lease/provision/expense tools (Carta, ADP, FinQuery, OneSource, Ramp) *push* summarized journal entries in. This spec exposes those four feeds on the existing infrastructure — the `apiKey` table (hashed keys, JSONB scopes, Postgres rate limiting, all already enforced by `requirePermissions`), the module service layer the MCP direct-executor already wraps, and the `eventSystemSubscription` → PGMQ → Inngest webhook pipeline: (1) a **trial balance API** sliceable by company/book/period/date-range/dimension with stable account numbers; (2) a **streaming JE population export API** (the record-integrity spec's export, programmatic); (3) a **controlled JE import API** that is validated, approval-workflow-aware (an active JE rule parks imports in `Pending Approval`), period-status-aware (Closed rejected; Locked requires `accounting_create`), idempotent, and audit-stamped with the API-key principal; (4) **webhooks** for journal posted/reversed, period locked/closed/reopened, and approval decisions, with HMAC-signed payloads and Inngest retries. No new auth system, no new gateway, no new queue — two small tables (idempotency keys, webhook topic registrations layered on `eventSystemSubscription`) and a handful of `api+/v1+/` routes.

## Problem Statement

- There is **no external read surface for balances**: `getTrialBalance` (`apps/erp/app/modules/accounting/accounting.service.ts:122`) wraps the `trialBalance` RPC but is only reachable via session-authenticated UI loaders or the MCP protocol — BlackLine/FloQast/Workiva connectors speak plain REST + API key on a cron, not MCP.
- There is **no JE population export** an auditor's Excel/IDEA tooling can consume programmatically; the record-integrity sibling spec defines the export columns and UI, but bolt-ons need it as an endpoint with no row caps.
- There is **no way for Carta/payroll/provision/lease tools to land JEs** except a human rekeying them. `createJournalEntry`/`saveJournalEntryWithLines`/`postJournalEntry` exist but nothing composes them behind validation, idempotency, the approval gate (sibling spec), or the period gate (period-closing spec). An unvalidated import path would be a SOX control bypass — the whole point of the approvals spec.
- There are **no outbound events** for "journal posted" / "period closed" — FloQast polls for close status; BlackLine wants to know when the period locks. The event system (`.ai/rules/event-system.md`) has a WEBHOOK handler with retries and idempotency, but no accounting tables have event triggers attached, no public registration surface exists, and payloads are unsigned raw row diffs.
- API keys already carry `accounting_view`/`accounting_create`/`accounting_update`/`accounting_delete` scopes (`20260219162954_api-key-scopes-rate-limits.sql:121`) and `requirePermissions` (`packages/auth/src/services/auth.server.ts:191-260`) already enforces key hash, expiry, per-key rate limits, and scope→permission mapping — the auth substrate is done; nothing accounting-shaped uses it.

## Proposed Solution

### Surface overview

New route namespace `apps/erp/app/routes/api+/v1+/` (flat routes), all authenticated by the existing `requirePermissions(request, {...})` which transparently accepts either a session or a `carbon-key` header. REST/JSON, versioned in the path so the MCP surface and internal loaders stay untouched.

| Endpoint | Method | Scope required | Purpose |
|---|---|---|---|
| `/api/v1/accounting/trial-balance` | GET | `accounting_view` | TB by company/book/period or date range, dimension filter/group-by, paginated |
| `/api/v1/accounting/journal-lines/export` | GET | `accounting_view` | Streaming full-population JE line export (CSV or NDJSON) |
| `/api/v1/accounting/journal-entries` | POST | `accounting_create` | Controlled JE import — single or batch, idempotent, approval- and period-aware |
| `/api/v1/accounting/journal-entries/:id` | GET | `accounting_view` | Poll an imported entry's status (Draft / Pending Approval / Posted / Rejected) |
| `/api/v1/webhooks` | GET/POST | `settings_view`/`settings_update` | List/register webhook endpoints for accounting topics |
| `/api/v1/webhooks/:id` | DELETE | `settings_update` | Deactivate a webhook registration |
| `/api/v1/openapi.json` | GET | public (rate-limited) | OpenAPI 3.1 document for the endpoints above |

### 1. Trial balance API

Extends `getTrialBalance` / the `trialBalance` RPC (already being widened by the financial-reporting spec to four-column opening/debits/credits/closing) with optional `p_book_id` and dimension parameters, then exposes it:

```
GET /api/v1/accounting/trial-balance
  ?periodId=<accountingPeriodId>            -- OR startDate/endDate (ISO); periodId wins
  &bookId=<bookId>                          -- default: primary book (journal.bookId, record-integrity spec)
  &dimension=<dimensionId>:<valueId>        -- repeatable; filters lines carrying that journalLineDimension
  &groupBy=dimension:<dimensionId>          -- optional: one row per (account, dimensionValue)
  &cursor=<opaque>&limit=500                -- keyset pagination on account.number, max 1000
```

Response rows carry **stable identifiers**: `accountNumber` (the mapping key every bolt-on stores), `accountId`, `accountName`, `class`, `openingBalance`, `debits`, `credits`, `closingBalance`, `currencyCode` (company base), plus `dimensionValueId`/`dimensionValueName` when grouped. Envelope: `{ data, meta: { companyId, bookId, periodId|dateRange, generatedAt, nextCursor } }`. Balances reflect **Posted journals only** (the financial-reporting spec's posted-only default), so an extract pulled mid-approval-cycle never moves retroactively except by posting — which webhooks announce.

### 2. JE population export API

Programmatic form of the record-integrity spec's export — same column set (that spec owns the canonical list: entry/line ids, gapless number, book, period, posting/created dates, account number+name, debit/credit, currency + source amounts, dimensions, source document type/id, preparer, approver, approval timestamps, reversal linkage), same underlying query, different transport:

```
GET /api/v1/accounting/journal-lines/export
  ?periodId=... | startDate=...&endDate=...   -- required (bounded extracts)
  &bookId=...&source=...&status=Posted        -- filters; status defaults to Posted
  &format=csv|ndjson                          -- default csv
```

Implementation: a `ReadableStream` response (React Router loader returning a streamed `Response`) over a Kysely cursor query ordered by journal number — **no row cap, no pagination**; the research is explicit that auditors need the full population flat. `Content-Disposition` filename embeds company/period/book. Rate-limit note: one export request = one unit against the key's window regardless of row count; a long-running stream holds no DB transaction (cursor batches of 5k).

### 3. Controlled JE import API

The landing path for Carta SBC entries, payroll summaries, FinQuery lease JEs, and provision adjustments. Composes existing service functions — `createJournalEntry` → `saveJournalEntryWithLines` → the approval-aware posting entry point that the document-approvals spec installs in the service layer ("for JEs also the service entry point so the MCP path is covered" — this API is exactly that second consumer).

```jsonc
POST /api/v1/accounting/journal-entries
Idempotency-Key: <caller-chosen, per request>        // header, required
{
  "entries": [                                        // 1..100 per request
    {
      "externalId": "carta-sbc-2026-06",              // caller's id, echoed back, indexed
      "postingDate": "2026-06-30",
      "description": "June SBC expense per Carta",
      "bookId": null,                                 // default primary book
      "autoSubmit": true,                             // default true: submit for posting after create
      "lines": [
        { "accountNumber": "6200", "description": "SBC expense", "debit": 41250.00, "credit": 0,
          "dimensions": { "dep": "eng" } },            // dimensionId|code : valueId|code
        { "accountNumber": "3150", "debit": 0, "credit": 41250.00 }
      ]
    }
  ]
}
```

**Validation (per entry, all-or-nothing within the entry, entries independent):** lines balance to the cent; every `accountNumber` resolves to an active, direct-posting account in the company's chart; every dimension key/value resolves to an active `dimension`/`dimensionValue`; amounts non-negative with exactly one of debit/credit per line; ≤ 500 lines per entry.

**Period gate:** `postingDate`'s period `closeStatus` is checked via the period-closing spec's service gate — `Closed` → entry rejected (`422 PERIOD_CLOSED`); `Locked` → allowed only because the key carries `accounting_create` (the API principal *is* an accounting actor — mirrors the Locked-period rule for accounting users); `Open` → allowed. The DB trigger backstop from the period-closing spec catches anything this layer misses.

**Approval gate:** with `autoSubmit`, the entry is created as Draft and then submitted through `isApprovalRequired('journalEntry', companyId, baseAmount)`. An active rule matching the amount → status `Pending Approval`, an `approvalRequest` is created, approvers are notified via the existing `ApprovalRequested` event, and the per-entry result reports `status: "Pending Approval"` with `approvalRequestId` — the integration polls `GET .../journal-entries/:id` or subscribes to the `journal_entry.posted` webhook. No matching rule → posts immediately (`status: "Posted"`, journal number returned). `autoSubmit: false` → parks at Draft for human review.

**Idempotency:** the `Idempotency-Key` header is scoped `(companyId, apiKeyId, key)`. First request persists the request-body hash and, on completion, the full per-entry results. Replay with the same key + same body hash → the **stored original response** (200, `replayed: true` in meta) — no new journals, ever. Same key + different body → `409 IDEMPOTENCY_KEY_REUSED`. Keys expire after 30 days. A concurrent duplicate (row exists, response not yet stored) → `409 IDEMPOTENCY_KEY_IN_FLIGHT` with Retry-After.

**Audit stamping:** `createdBy`/`updatedBy` = the key's `createdBy` user (existing `requirePermissions` behavior — the executor identity), and the journal rows carry `externalId`, `sourceSystem` (from the key's name), and `sourceApiKeyId` so the JE export and audit log distinguish "landed via integration X" from "keyed by the user who happens to own the key". The record-integrity spec's audit coverage picks these up with no extra work.

**Batch response:** `207`-style per-entry results — `{ index, externalId, journalEntryId, status, journalNumber?, approvalRequestId?, errors? }`. One invalid entry never blocks its siblings.

### 4. Webhooks

Rides the event system end to end: registration creates `eventSystemSubscription` rows via the existing `create_event_system_subscription` RPC; delivery is the existing PGMQ → Inngest `event-handler-webhook` function (already: 3 retries with backoff, `idempotency: msgId`, per-record concurrency keys). Three additions: **topic semantics**, **payload curation**, and **signing**.

**Topic catalog (v1):**

| Topic | Table / trigger | Filter |
|---|---|---|
| `journal_entry.posted` | `journal` UPDATE | `status` → `Posted` |
| `journal_entry.reversed` | `journal` UPDATE | `status` → `Reversed` |
| `period.locked` / `period.closed` / `period.reopened` | `accountingPeriod` UPDATE | `closeStatus` transition |
| `approval.decided` | `approvalRequest` UPDATE | `status` → `Approved`/`Rejected` |

Migration work: `attach_event_trigger('journal', ...)`, `attach_event_trigger('accountingPeriod', ...)`, `attach_event_trigger('approvalRequest', ...)` — none of these tables have async event triggers today (the rule's trigger inventory covers sales/purchasing/etc. only).

**Registration:** `POST /api/v1/webhooks { url, topics: ["journal_entry.posted", ...], description? }` → creates one `webhookRegistration` row (secret generated server-side, returned **once**) plus one `eventSystemSubscription` per topic (handlerType `WEBHOOK`, `config = { url, registrationId, topic }`), named `webhook:<registrationId>:<topic>` for clean teardown via `delete_event_system_subscriptions_by_name`.

**Delivery:** the webhook Inngest handler learns a curated envelope when `config.registrationId` is present (legacy raw-diff behavior preserved otherwise): `{ id: msgId, topic, companyId, occurredAt, data }` where `data` is a per-topic projection (journal id/number/postingDate/book/total/status + externalId; period id/fiscalYear/periodNumber/closeStatus; approval documentType/documentId/decision/decisionBy) — never raw row diffs. Headers: `carbon-webhook-id`, `carbon-webhook-timestamp`, `carbon-signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`. Consumers verify signature + reject stale timestamps (replay window 5 min). Retries: Inngest's existing 3 attempts; deliveries that exhaust retries set `lastFailureAt`/`failureCount` on the registration, and 20 consecutive failures auto-deactivate it (audit-logged).

### 5. Scopes, rate limits, docs, MCP

- **Scopes:** no new scope values — `accounting_view` covers TB + export + status polling, `accounting_create` covers import, `settings_view`/`settings_update` cover webhook registration (webhook config is company plumbing, not accounting data). The API-keys settings UI already lets admins grant these per key.
- **Rate limits:** existing per-key `rateLimit`/`rateLimitWindow` columns + `check_api_key_rate_limit` apply unchanged (default 1000/h). Guidance shipped in docs: TB pollers ≤ hourly; use webhooks instead of polling; export counts as one request. The unauthenticated `openapi.json` route reuses the `docs.ts` Redis sliding-window pattern (20/h/IP).
- **OpenAPI docs:** `/api/v1/openapi.json` serves a hand-maintained OpenAPI 3.1 document (checked into the repo next to the routes; zod validators are the source of truth for shapes — schemas generated from the same `accounting.models.ts` validators via `zod-to-json-schema`, already a transitive dependency). The existing `/api/docs` (PostgREST swagger) is unrelated and untouched.
- **MCP:** the direct-executor already exposes `accounting.*` service functions, so `accounting_getTrialBalance` and `accounting_getJournalEntries` gain book/dimension parameters for free when the service signatures grow. **Added:** one new service function `importJournalEntries` (the same function the REST route calls — validation, period gate, approval submission, per-entry results) becomes an MCP tool with `createdBy` auth-field enrichment via `tool-metadata.json`. **Reused, not duplicated:** everything else. Raw `postJournalEntry` stays MCP-blocked-list material once the approvals spec lands its gate (that spec owns the entry-point wiring).

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Multi-tenancy (heuristic 1) | Both new tables: `companyId`, composite PK `("id","companyId")`, `id()` prefixes, audit columns | House convention; idempotency uniqueness additionally scoped by `apiKeyId` so two integrations can't collide on key names |
| 2 | Service shape (heuristic 2) | New functions (`getTrialBalanceV2` params fold into `getTrialBalance`, `getJournalLinesExportCursor`, `importJournalEntries`, `upsertWebhookRegistration`, `deleteWebhookRegistration`) live in `accounting.service.ts`/`accounting.models.ts`; webhook registration helpers wrap the existing event-system RPCs | One service file per module; import composes existing create/save/post functions rather than re-implementing posting |
| 3 | RLS (heuristic 3) | `apiIdempotencyKey`: no direct client access (service-role only — SELECT policy `false`); `webhookRegistration`: `settings` permission policies; secrets column excluded from any view | Idempotency rows are infrastructure, not user data; webhook secrets must never round-trip to the browser |
| 4 | Permissions (heuristic 4) | Routes call `requirePermissions` with `view:/create: "accounting"` or `settings` — the *same* helper sessions use; scope mapping `{permission}_{action}` is already implemented in `auth.server.ts` | Zero new auth code paths; one enforcement point for expiry, rate limit, and scope |
| 5 | Forms (heuristic 5) | No new forms in v1 — API-key management UI exists; webhook registrations get a read-only list on the API-keys settings page (registration itself is API-first, matching how integrations onboard) | Bolt-on vendors register programmatically; a create-form is a fast follow if humans want it |
| 6 | Module layout (heuristic 6) | Routes in `routes/api+/v1+/`; logic in `modules/accounting/`; webhook handler changes in `packages/jobs/src/inngest/functions/events/webhook.ts` | Versioned public namespace keeps internal `api+` loaders and MCP untouched |
| 7 | Backward compatibility (heuristic 7) | Everything additive: new routes, optional RPC params, new event triggers, envelope-vs-legacy branch in the webhook handler keyed on `config.registrationId` | Existing eventSystemSubscription WEBHOOK users (raw diffs, custom headers) keep exact behavior |
| 8 | No new gateway/auth | Ride `apiKey` + `requirePermissions` + PostgREST-independent REST routes | Brad's resolution: "use our current stuff"; the substrate already does hashing, scopes, rate limits, expiry |
| 9 | Import lands as real drafts, not a staging table | Entries are ordinary `journal` rows from creation; approval/period gates are the same ones humans hit | One posting pipeline = one control to audit (the entire point of GAP-E1's "controlled" import); a staging table would fork the SOX surface |
| 10 | Webhooks over event system, not a new dispatcher | Topics = named `eventSystemSubscription` rows; delivery = existing Inngest fn | Retries, idempotency, and per-record ordering already exist; only signing + payload curation are genuinely new |
| 11 | Stable account identifier = `accountNumber` | Import addresses accounts by number; TB returns number first | Bolt-on mapping tables store account numbers (BlackLine/FloQast convention); internal ids leak nothing useful and break on COA re-import |

## Data Model Changes

```sql
-- Idempotency keys for the import API (service-role only; no client RLS access)
CREATE TABLE "apiIdempotencyKey" (
    "id" TEXT NOT NULL DEFAULT id('idem'),
    "companyId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL REFERENCES "apiKey"("id") ON DELETE CASCADE,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,             -- sha256 of canonicalized body
    "status" TEXT NOT NULL DEFAULT 'in_flight' CHECK ("status" IN ('in_flight','completed')),
    "responseStatus" INTEGER,
    "responseBody" JSONB,                    -- stored per-entry results, replayed verbatim
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW() + INTERVAL '30 days',
    CONSTRAINT "apiIdempotencyKey_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "apiIdempotencyKey_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "apiIdempotencyKey_unique" UNIQUE ("companyId", "apiKeyId", "idempotencyKey")
);
ALTER TABLE "apiIdempotencyKey" ENABLE ROW LEVEL SECURITY;  -- no policies: service-role only

-- Webhook endpoint registrations (topic fan-out lives in eventSystemSubscription)
CREATE TABLE "webhookRegistration" (
    "id" TEXT NOT NULL DEFAULT id('wh'),
    "companyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "secret" TEXT NOT NULL,                  -- HMAC secret; returned once at creation
    "topics" TEXT[] NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP WITH TIME ZONE,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "webhookRegistration_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "webhookRegistration_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "webhookRegistration" ENABLE ROW LEVEL SECURITY;
-- SELECT/INSERT/UPDATE/DELETE policies gated on settings_view / settings_update
-- via the standard has_company_permission pattern; "secret" never selected client-side.

-- Journal source columns (coordinate with record-integrity spec — additive, IF NOT EXISTS)
ALTER TABLE "journal"
  ADD COLUMN IF NOT EXISTS "externalId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceApiKeyId" TEXT;
CREATE INDEX IF NOT EXISTS "journal_externalId_idx" ON "journal" ("companyId", "externalId");

-- Event triggers for webhook topics (async only; no sync interceptors)
-- attach_event_trigger('journal', ...), attach_event_trigger('accountingPeriod', ...),
-- attach_event_trigger('approvalRequest', ...)
-- trialBalance RPC: optional p_book_id + p_dimension_id/p_dimension_value_id params (additive defaults)
```

Run `pnpm run generate:types` after the migration, before typechecking.

## API / Service Changes

- `accounting.service.ts`: extend `getTrialBalance` (bookId, dimension filter/group, cursor); add `getJournalLinesExportCursor` (Kysely cursor over the record-integrity export query), `importJournalEntries` (validation → period gate → create → approval-aware submit; returns per-entry results), `getWebhookRegistrations` / `upsertWebhookRegistration` / `deleteWebhookRegistration` (wrapping the event-system RPCs for topic rows).
- `accounting.models.ts`: `journalEntryImportValidator` (entry + line + dimensions), `trialBalanceQueryValidator`, `webhookRegistrationValidator`, topic enum.
- Routes: `api+/v1+/accounting.trial-balance.ts`, `accounting.journal-lines.export.ts`, `accounting.journal-entries.ts`, `accounting.journal-entries.$id.ts`, `webhooks.ts`, `webhooks.$id.ts`, `openapi[.]json.ts`.
- `packages/jobs/.../events/webhook.ts`: curated-envelope branch, HMAC signing, failure bookkeeping on `webhookRegistration`.
- MCP: `importJournalEntries` registered in `tool-metadata.json` with `createdBy`/`companyId` auth fields; no other tool changes.

## UI Changes

Read-only "Webhooks" card on the API-keys settings page (registration list: url, topics, active, last failure). Nothing else — this spec is deliberately API-first.

## Acceptance Criteria

- [ ] `GET /trial-balance` with a `carbon-key` holding `accounting_view` returns four-column rows keyed by `accountNumber`; the same request with a key lacking the scope returns 403.
- [ ] TB API slices by `bookId` (adjustment-book rows excluded from the primary-book extract) and by `dimension=<id>:<value>`; `groupBy=dimension:` returns per-value subtotals that sum to the unfiltered TB.
- [ ] Export streams the full JE population for a period with no row cap; columns match the record-integrity spec's export byte-for-byte for the same filter.
- [ ] Imported JE in a company with an active journal-entry approval rule lands in `Pending Approval` with an `approvalRequest`; approver notification fires; on approval it posts with `preparedBy` = the key principal and `approvedBy` = the approver.
- [ ] Import with `postingDate` in a Closed period returns `422 PERIOD_CLOSED` and creates no rows; a Locked period accepts the import (key has `accounting_create`).
- [ ] Unbalanced entry, unknown `accountNumber`, or unknown dimension value rejects that entry with a line-level error while sibling entries in the batch succeed.
- [ ] Replaying the same `Idempotency-Key` + body returns the original stored response with `replayed: true` and creates zero new journals; same key + different body returns 409.
- [ ] Posting a journal fires `journal_entry.posted` to a registered URL with a valid `carbon-signature` HMAC; tampered body fails verification; delivery retries on 5xx; 20 consecutive failures deactivate the registration.
- [ ] Locking/closing/reopening a period fires the corresponding `period.*` webhook with fiscalYear/periodNumber/closeStatus.
- [ ] `openapi.json` validates as OpenAPI 3.1 and documents every v1 endpoint, error code, and the signature scheme.
- [ ] Existing WEBHOOK eventSystemSubscriptions without `registrationId` still deliver legacy payloads unchanged.
- [ ] Rate limiting: a key over its window receives 429 with `X-RateLimit-*` headers on every v1 route.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Import bypasses a control if the approvals spec's service entry point slips | High | Hard dependency: import ships only after document-approvals lands; `importJournalEntries` calls its `isApprovalRequired` gate, not `postJournalEntry` directly |
| Webhook payloads leak financial data to a mistyped URL | Med | Secret returned once, HTTPS-only URL validation, curated minimal envelopes (ids + status, not line detail — consumers pull detail via the authenticated API) |
| Long export streams under load | Med | Cursor batching (5k), bounded date range required, one-request rate-limit cost documented |
| Idempotency table growth | Low | 30-day `expiresAt` + scheduled Inngest cleanup (piggybacks an existing daily cron) |
| `journal` event trigger adds write overhead to the posting hot path | Low | AFTER STATEMENT trigger short-circuits when no active subscription exists (existing `dispatch_event_batch` behavior) |

## Open Questions

> Resolutions confirmed before writing (per the spec lifecycle); no blocking questions remain.

- [x] **New API gateway / auth mechanism?** — Resolved (Brad): **"use our current stuff"** — the `apiKey` table (hashed keys, JSONB scopes, `check_api_key_rate_limit`), `requirePermissions`, the MCP direct-executor, and the `api+` route namespace. No Kong/Zuplo/new token format.
- [x] **Where does the JE export column definition live?** — The record-integrity spec owns it; this API is a transport over the same query (verified: that spec is a parallel sibling on this branch).
- [x] **Do imports post directly or route through approvals?** — Through approvals, always: same service entry point as the UI/MCP paths (document-approvals spec resolution "the MCP path is covered" extends to this API).
- [x] **Locked-period semantics for API principals?** — Locked accepts imports when the key carries `accounting_create`, mirroring the period-closing rule that accounting users may post adjustments into Locked periods; Closed always rejects.
- [x] **New scope values?** — None; existing `accounting_*`/`settings_*` scopes map cleanly (verified against `20260219162954`).

## Changelog

- 2026-07-04: Created (GAP-E1, Phase 4 of the readiness roadmap; tracking issue crbnos/carbon#1059)
