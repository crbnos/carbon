# Plan: Integration Surface (TB API, JE export/import, accounting webhooks) — #1059

Spec: `.ai/specs/2026-07-04-integration-surface.md`
Branch: `loop/1059`

## Reality check (grounded via exploration)

| Dependency | Status | Consequence |
|---|---|---|
| period-closing (`getOrCreateAccountingPeriod` gate) | **IMPLEMENTED** | Period gate reusable |
| document-approvals — `journalEntry` approvable type | **NOT wired** (enum = purchaseOrder/qualityDocument/supplier) | JE import approval gate **BLOCKED** — owned by that spec |
| record-integrity — `journal.bookId`, JE population export | **NOT IMPLEMENTED** | TB bookId/dimension slicing + export **BLOCKED** |
| Loop worktree | **no DB / no stack** | Migrations can't be applied; `generate:types` can't run → any code referencing new tables/columns won't typecheck |

Effect: the DB-touching routes/services (import, export, webhook registration CRUD)
cannot be built typecheck-green here and several depend on unbuilt siblings. This
plan delivers the **DB-independent substrate** (Phase 1), writes the migrations as
foundation, and ships a **partial draft PR flagged needs-verification**.

## Tasks (each committable, floor-gate green in a no-DB worktree)

- **T1 — Migrations (foundation, unapplied/flagged).**
  - `apiIdempotencyKey` (RLS enabled, no policies → service-role only)
  - `webhookRegistration` (settings_view/update RLS; `secret` never selected client-side)
  - `journal` source columns `externalId`/`sourceSystem`/`sourceApiKeyId` + index
  - `attach_event_trigger` on `journal`, `accountingPeriod`, `approvalRequest`
  - (trialBalance RPC bookId/dimension params: DEFERRED — owned by record-integrity/financial-reporting; adding a `p_book_id` over a non-existent `journal.bookId` would be dead code)
  - Proof: schema follows conventions-database; **cannot apply** (no DB) → needs-verification.

- **T2 — Models (pure zod) + unit tests.** `accounting.models.ts`:
  - `webhookTopics` + `webhookRegistrationValidator` (https-only url, topics subset, description)
  - `trialBalanceQueryValidator` (periodId | startDate/endDate, bookId, dimension, groupBy, cursor, limit≤1000)
  - `journalEntryImportValidator` (1..100 entries; each 1..500 lines; line = accountNumber + exactly one of debit/credit ≥ 0 + dimensions)
  - Proof: vitest red→green.

- **T3 — Pure integration helpers + unit tests.** `accounting.integration.ts` (pure, no DB types):
  - `hashRequestBody` (sha256 of canonicalized JSON) — idempotency
  - `encodeCursor`/`decodeCursor` (keyset on accountNumber)
  - `validateImportEntryStructure` (balance to the cent, exactly one of debit/credit, ≤500 lines, non-negative)
  - `toTrialBalanceRow` (map RPC row → stable-identifier envelope row keyed by accountNumber)
  - Proof: vitest red→green.

- **T4 — Webhook curated envelope + HMAC signing (packages/jobs) + unit tests.**
  - `webhook-signing.ts` (pure): `buildWebhookEnvelope(topic,…)` per-topic projection; `signWebhookBody(secret,ts,body)` → `v1=<hex HMAC-SHA256(ts + "." + body)>` (mirrors paperless-parts convention)
  - `webhook.ts`: branch on `config.registrationId` → curated envelope + signature headers (`carbon-webhook-id/-timestamp`, `carbon-signature`); legacy raw-diff path preserved. (Failure bookkeeping on `webhookRegistration` DEFERRED — needs table/types.)
  - Proof: vitest — signed envelope verifies, tampered body fails, legacy passthrough unchanged.

- **T5 — OpenAPI 3.1 doc + route + unit test.**
  - `openapi.ts`: hand-maintained OpenAPI 3.1 document — every v1 endpoint, error code, signature scheme.
  - `api+/v1+/openapi[.]json.ts`: serve with the `docs.ts` Redis sliding-window pattern (20/h/IP), no auth.
  - Proof: vitest — validates as OpenAPI 3.1 (structural), documents each endpoint + error + signature.

- **T6 — Trial-balance REST route + unit test.**
  - `api+/v1+/accounting.trial-balance.ts`: `requirePermissions({view:"accounting"})`, parse query, call existing `getTrialBalance`, return `{ data (accountNumber-keyed rows), meta }`. bookId/dimension/groupBy → `400 NOT_SUPPORTED` (honest; deferred to record-integrity).
  - Proof: vitest on `toTrialBalanceRow` mapping (T3); 403 enforced by `requirePermissions` (existing).

## Deferred to Phase 2 (post-migration + siblings) — surfaced on PR
JE import route/service, JE export stream, webhook registration CRUD routes/service,
webhook failure auto-deactivate, MCP `importJournalEntries`, webhooks settings UI card,
TB bookId/dimension slicing. Each needs regenerated DB types and/or a landed sibling spec.
