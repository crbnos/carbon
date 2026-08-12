# Accounting Sync Engine v2 (Phases A+B) — implementation plan

**Spec:** .ai/specs/implemented/2026-07-09-accounting-sync-engine.md
**Research:** .ai/research/quickbooks-accounting-sync-engine.md
**Branch:** feat/quickbooks-enterprise (worktree /Users/barbinbrad/Code/carbon-feat-quickbooks-enterprise)

Scope: Phase A (engine hardening + sync-operation ledger + error inbox) and Phase B (posting
sync on Xero). Phases C (QBO) and D (QBD) are NOT in this plan; Phase D is gated on the
Conductor Ask-First decision recorded in the spec's Open Questions.

## Progress
- [x] Task 1: Migration — syncOperationStatus enum, accountingSyncOperation table, journal event trigger *(file written: 20260709142743_accounting-sync-operations.sql; NOT applied — no local DB in this worktree per "don't run the service"; apply with `pnpm db:migrate` when a stack is up)*
- [x] Task 2: Regenerate DB types *(deferred with Task 1 — no DB to generate from; code uses the house cast workaround for the new table; run `pnpm run generate:types` after the migration applies)*
- [x] Task 3: Credentials union + providerMetadata + legacy read-shim *(tests colocated per @carbon/ee layout: core/credentials.test.ts)*
- [x] Task 4: Apply per-company syncConfig *(resolveSyncConfig in core/service.ts; tests core/sync-config.test.ts)*
- [x] Task 5: Sync-operations service (core/operations.ts) *(table access via cast until generate:types runs; decision logic tested as pure functions in core/operations.test.ts)*
- [x] Task 6: Route Inngest sync entry points through the operations ledger *(shared enqueue/drain helper accounting-sync-operations.ts; all three entry points flow enqueue→claim→execute→close; cooldown moved into enqueueSyncOperation; idempotency-key scope = delivery id (event.id ?? runId) — NOT the plan's literal 'live', which would have permanently blocked re-syncs via the total unique index; createdBy = integration.updatedBy ?? 'system'; backfill livelock guard added)*
- [x] Task 7: Sync activity tab (error inbox UI) *(IntegrationForm drawer gains a tabbed layout — new optional `tabs`/`defaultTab` props, Settings stays the first tab, drawer widens to size="lg", forceMount preserves form state across tab switches; SyncActivity table + nested detail drawer wired to getSyncOperations/transitionOperation with ?syncStatus/?syncPage params and ?tab=sync-activity deep link; bulk retry submits repeated `ids` fields per house convention. Gotcha: a type-only import of @carbon/ee/accounting from SyncActivity (re-exported through the ~/modules/settings barrel) flipped an unrelated supabase select over the TS2589 depth cliff (usePurchaseInvoiceAutoFill) — SyncActivity uses local structural operation types instead; the same graph shift made QuoteForm.tsx:95's @ts-expect-error unused, so it was removed)*
- [x] Task 8: Account-mapping service (core/account-mapping.ts) *(Kysely-based per the external-mapping precedent — supabase-js can't express DISTINCT and caps at max_rows=1000; unmapped union = accountDefault + journalLine only: itemPostingGroup has no account columns since 20260229000000_drop-posting-groups; tests colocated core/account-mapping.test.ts)*
- [x] Task 9: journalEntry entity type + Xero JournalEntrySyncer *(source-type lists trimmed to real `journalEntrySourceType` enum values — Inbound/Outbound Transfer, Inventory Count, Opening Balance don't exist; shared pre-flight helpers + PostingSyncSettings resolver in new core/posting.ts per Phase C/D expectations; pre-flight failures surface as structured JournalEntrySyncFailure objects on SyncResult.error (syncer overrides pushToAccounting so errorCode/warning/metadata aren't flattened to strings) — drain detects via isJournalEntrySyncFailure and records failOperation({errorCode, warning}); reversal contract: drain pushes entityId `<journal.id>:reversal` (getJournalEntrySyncEntityId) when op metadata.reversal=true; Xero lock date = max(Organisation.PeriodLockDate, EndOfYearLockDate, settings.lockDate), cached per syncer instance; LineAmount sign convention (positive=debit) matches InventoryAdjustmentSyncer — sandbox verification still TODO in file header; tests colocated providers/xero/entities/journal-entry.test.ts, 27 cases, 93 total green)*
- [x] Task 10: Journal posting trigger through the event system *(TABLE_TO_ENTITY_MAP gains journal→journalEntry; envelope carries full old+new rows for UPDATEs (row_to_json in dispatch_event_batch), so transitions are detected as old.status≠new.status landing on Posted/Reversed — decision + config gate live as pure fns in accounting-sync-operations.ts (getJournalPostingDecision / isJournalEntryPostingEnabled), tested colocated; journal ops enqueue via a second enqueueSyncOperations call with trigger='posting' (reversal → entityId `<id>:reversal` + metadata.reversal). Drain additions folded in: structured JournalEntrySyncFailure → failOperation({errorCode, warning, metadata merged over op metadata}) via getSyncOperationFailureRecord; daily-consolidation hold excludes journalEntry at CLAIM time — sanctioned ee deviation: claimPendingOperations gains excludeEntityTypes (query-level .not-in via getClaimEntityTypeExclusion, so held rows never eat the claim limit and stay Pending for the Task 12 cron — chosen over a release-to-Pending fn to avoid attemptCount churn + cron races) and failOperation gains optional metadata; drainSyncOperations now REQUIRES integrationMetadata (all 7 call sites pass it). RESOLVED by spec amendment 2026-07-09: post-* edge functions INSERT journals born status='Posted' — spec Phase B §2 amended and getJournalPostingDecision now ALSO enqueues INSERTs born Posted with reversalOfId IS NULL (reversal inserts skip; the original's Reversed transition carries the push); 3 INSERT test cases added, 48 jobs tests green)*
- [x] Task 11: Account mapping + posting-sync settings UI *(AccountMapping.tsx + PostingSyncSettings.tsx render as two new IntegrationForm tabs — "Account Mapping", "Posting" — ahead of Sync Activity; loader reuses the existing xero listChartOfAccounts call for the chart (coded accounts only: Xero manual journals reference accounts by code) and computes match-by-code proposals server-side via matchAccountsByCode; the Kysely-based ee mapping services get the app singleton getDatabaseClient() from ~/services/database.server (RLS bypassed — route requirePermissions + companyId scoping is the gate). Three new intents before the plan-gate, all stay-on-page + flash: upsert-account-mapping (per-row ValidatedForm; selected provider code/name travel in hidden fields because the journal syncer reads codes from mapping metadata), bulk-upsert-account-mappings (drawer confirm-all; repeated JSON-encoded `mappings` fields per the `ids` precedent), update-posting-settings (read-modify-write deep-merge into metadata.settings.postingSync — credentials/other settings keys preserved). TS2589 recurrence: exporting the new components through the settings barrel flips usePurchaseInvoiceAutoFill.ts + purchasing.service.ts REGARDLESS of what they import (bisect: barrel export alone is the trigger; @carbon/form-direct imports didn't help) — so the components are deliberately NOT barrel-exported (documented in Integrations/index.ts) and the route imports them by file path; their validators are local zfd adaptations in settings.models.ts (importing ee zod into the barrel would re-flip) and both components use local structural types like SyncActivity. erp typecheck exit 0; biome clean on the 5 touched files)*
- [x] Task 12: Daily-consolidation cron *(accounting-consolidation.ts, cron 0 2 \* \* \* UTC, registered. Flow: pre-scan claimable journalEntry ops (getSyncOperations gains a narrow `entityType` filter — flagged deviation) → resolve journal postingDates → per candidate date (strictly < today UTC) RESERVE a marker op via enqueueSyncOperation with key `daily:<integration>:<date>` BEFORE claiming (return-existing semantics = re-run guard; marker already Completed → late backdated members push INDIVIDUALLY through the syncer instead of stranding or double-consolidating) → include-only claim (sanctioned deviation: claimPendingOperations gains `entityTypes` include filter, mutually exclusive with excludeEntityTypes, guard tested) → partition (markers/reversals/byDate/held/missing — pure fn in accounting-sync-operations.ts, tested) → per date: fetchLocal each member via the syncer, mirror shouldSync gates (status/sourceType/already-mapped ⇒ complete-as-skip), aggregate via new core/posting.ts helper aggregateJournalEntriesForDate (nets per account, drops zero lines, asserts balance — colocated posting.test.ts incl. 3-journals/2-accounts, zero-drop, unbalanced-throws), run the SAME runJournalEntryPreflight with the syncer's now-public cached getters (getAccountCodesById/getControlAccountIds/getLockDate private→public — flagged), push ONE createManualJournal with narration `Carbon daily summary <date> — <n> journals` (+redate suffix) → complete members with metadata.consolidatedInto + externalId (completeOperation gains optional `metadata` — flagged, mirrors failOperation) → complete marker LAST (commit point). Batch pre-flight failure ⇒ whole-batch failOperation on every member with the pre-flight errorCode + memberJournalIds metadata, marker failed too. Reversals push individually via the overridden pushToAccounting (base BATCH workflow flattens structured failures — observed gap, noted for Task 14). Ops dated ≥ today: not claimed when they're the only work; if co-claimed they stay In Flight and recover via the stale rule. journal-entry entities added to the xero barrel so jobs can import mapJournalEntryToManualJournal/JournalEntrySyncer (flagged). Individual mode: cron no-ops (gate re-checked in-step))*
- [x] Task 13: Reconciliation cron + drift report *(accounting-reconciliation.ts, cron 0 3 \* \* 1 UTC, registered. Per active connection with postingSync.enabled: pages 90 days of Completed journalEntry push ops via getSyncOperations (entityType filter; createdAt-paged with 30-day completedAt slack, 50-page cap) → presence check via per-id provider.getManualJournal — CHOSE per-id over adding listManualJournals (v1 volumes ≈ 1 batch/day; the aggregate check needs the full journals anyway); paced 50/batch ~1.1s vs Xero 60/min, capped 250 ids newest-first, RatelimitError degrades to reporting on the verified subset (unchecked ids excluded from BOTH checks — no false missing). missing/VOIDED/DELETED → {type:'missing', externalId, journalId, amount}. Aggregate check per calendar month bucketed by CARBON posting month on both sides (redate-proof): consolidated batches re-net member lines per account (netJournalLinesPerAccount reused from core/posting), individual pushes sum raw debit lines, reversals negate; |diff|>0.01 in cents → {type:'mismatch', month, carbonTotal, providerTotal}; missing journals excluded from monthly totals (no double-reporting). Report {runAt, drift(cap 100)} stored via mergePostingSyncReconciliation — read-modify-write against the RAW row metadata (getAccountingIntegration's zod parse strips unknown keys) preserving credentials/syncConfig/sibling settings (tested). Pure helpers + tests colocated in accounting-sync-operations.(test.)ts — the cron files import the Inngest client whose env-var check throws under vitest. UI: SyncActivity gains optional lastReconciliation prop (local structural types per the TS2589 lesson) rendering an amber banner + Type/Reference/Carbon/Provider drift table above the ops table; Task 11 finished before wiring time, so the route loader passes it (shape-guarded) — no TODO left. NOTE for Task 14: PostingSyncSettings' update-posting-settings action rewrites metadata.settings.postingSync wholesale, dropping lastReconciliation until the next Monday run — harmless, one-line spread if it annoys)*
- [ ] Task 14: Browser verification (/test) + full scoped gates *(PARTIAL 2026-07-09: scoped gates all green — typecheck 3/3 (ee/jobs/erp), @carbon/ee 110 tests, @carbon/jobs 72 tests, biome clean on all 37 changed code files. Post-wave seam fixes by the orchestrator: JournalEntrySyncer.pushBatchToAccounting override so the drain's batch path keeps structured failures (closes Task 12's observed gap); update-posting-settings action now spreads existing postingSync so lastReconciliation survives saves (closes Task 13's note); drain header comment updated for the INSERT-born-Posted amendment. DEFERRED per Brad's "implement only" constraint: browser verification (/test), stack boot, migration application (pnpm db:migrate) + generate:types, live-Xero round-trip incl. the LineAmount sign-convention sandbox check. Run those when a stack is up.)*

## Dependencies
- Task 2 needs Task 1 (types). Tasks 3, 4, 5 need Task 2; they are independent of each other (parallel-safe).
- Task 6 needs Tasks 3+5. Task 7 needs Tasks 5+6.
- Task 8 needs Task 2; independent of Tasks 3–7.
- Task 9 needs Tasks 5+8. Task 10 needs Task 9. Tasks 12, 13 need Tasks 9+10.
- Task 11 needs Task 8 (and copies UI patterns from Task 7).
- Task 14 is last.

---

## Task 1: Migration — syncOperationStatus enum, accountingSyncOperation table, journal event trigger

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<generated-timestamp>_accounting-sync-operations.sql`

**Steps:**
1. From the worktree root run `pnpm db:migrate:new accounting-sync-operations`. Use the file
   it creates — do NOT hand-pick the timestamp. If the generated HHMMSS is `000000`, rename
   the file with a randomized HHMMSS (e.g. `143217`). The timestamp MUST be newer than every
   migration currently in `packages/database/supabase/migrations/` (check with `ls | tail`).
2. Before writing SQL, open the migration that created `externalIntegrationMapping` (grep:
   `grep -rln "externalIntegrationMapping" packages/database/supabase/migrations/ | head -3`)
   and copy its exact RLS helper usage for the SELECT policy. If it uses something other than
   `get_companies_with_employee_role()` / `get_companies_with_employee_permission(...)`,
   prefer the helpers below anyway (they are the current convention per
   `.ai/rules/workflow-database-migration.md`; the old `has_role`/`has_company_permission`
   helpers are deprecated).
3. Write this SQL (idempotent guards included):

```sql
-- Sync operation status lifecycle (spec: Design Decisions "Status lifecycle")
DO $$ BEGIN
  CREATE TYPE "syncOperationStatus" AS ENUM
    ('Pending', 'In Flight', 'Completed', 'Failed', 'Warning', 'Skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "accountingSyncOperation" (
    "id" TEXT NOT NULL DEFAULT id('syncop'),
    "companyId" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "direction" TEXT NOT NULL CHECK ("direction" IN ('push-to-accounting','pull-from-accounting')),
    "trigger" TEXT NOT NULL CHECK ("trigger" IN ('event','webhook','backfill','manual','posting','retry')),
    "status" "syncOperationStatus" NOT NULL DEFAULT 'Pending',
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP WITH TIME ZONE,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "externalId" TEXT,
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "accountingSyncOperation_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "accountingSyncOperation_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "accountingSyncOperation_live_uq"
  ON "accountingSyncOperation" ("companyId", "integration", "entityType", "entityId", "direction")
  WHERE "status" IN ('Pending', 'In Flight');
CREATE UNIQUE INDEX IF NOT EXISTS "accountingSyncOperation_idempotency_uq"
  ON "accountingSyncOperation" ("companyId", "integration", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "accountingSyncOperation_inbox_idx"
  ON "accountingSyncOperation" ("companyId", "integration", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "accountingSyncOperation_companyId_idx"
  ON "accountingSyncOperation" ("companyId");
CREATE INDEX IF NOT EXISTS "accountingSyncOperation_createdBy_idx"
  ON "accountingSyncOperation" ("createdBy");
CREATE INDEX IF NOT EXISTS "accountingSyncOperation_updatedBy_idx"
  ON "accountingSyncOperation" ("updatedBy");

ALTER TABLE "accountingSyncOperation" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT" ON "public"."accountingSyncOperation";
CREATE POLICY "SELECT" ON "public"."accountingSyncOperation" FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);
DROP POLICY IF EXISTS "UPDATE" ON "public"."accountingSyncOperation";
CREATE POLICY "UPDATE" ON "public"."accountingSyncOperation" FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_update'))::text[]
  )
);
-- No INSERT/DELETE policies: rows are created/deleted by jobs via service role only.

-- Posting-sync trigger source: journal UPDATEs flow into the event system (PGMQ)
SELECT attach_event_trigger('journal', ARRAY[]::TEXT[]);
```

4. If `attach_event_trigger` does not exist or has a different signature, open
   `packages/database/supabase/migrations/20260119084845_event_system_register_triggers.sql`
   and copy its exact call shape. If that file contradicts the two-arg form, STOP and report —
   do not improvise the event wiring.
5. Apply locally: `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate
# Expected: applies <timestamp>_accounting-sync-operations.sql with no error, then regenerates types/swagger.
# If crbn migrate fails with a local permission error, validate instead via a rolled-back psql
# transaction (BEGIN; \i <file>; ROLLBACK;) as supabase_admin and report the crbn failure.
```

**Out of scope:** Any change to `journal`, `externalIntegrationMapping`, or
`companyIntegration` columns; seeding data; the event-system `handlerType` CHECK constraint
(we reuse the existing SYNC handler, no new handler type).

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/types.ts` (generated — never hand-edit)

**Steps:**
1. Run `pnpm run generate:types` from the worktree root.
2. Inspect the diff size: `git diff --stat packages/database/src/types.ts | tail -1`.
   The committed types are generated from the cloud DB and can include per-company tables; a
   local regeneration may produce a huge unrelated diff. If the diff is more than ~2,000
   lines or contains obviously unrelated per-company tables, DO NOT plan to commit the whole
   file — note it, keep the regenerated file locally for typechecking, and at commit time
   either isolate the `accountingSyncOperation`/`syncOperationStatus` additions or access the
   new table via typed casts in code (existing house pattern). If unsure, STOP and report.

**Verify:**
```bash
grep -n "accountingSyncOperation" packages/database/src/types.ts | head -3
# Expected: type entries for the new table (Row/Insert/Update) exist.
```

**Out of scope:** Hand-editing generated types; committing unrelated type churn.

---

## Task 3: Credentials union + providerMetadata + legacy read-shim

**Depends on:** Task 2 (parallel-safe with Tasks 4, 5)
**Files:**
- Modify: `packages/ee/src/accounting/core/models.ts` — replace single-variant `ProviderCredentialsSchema`
- Modify: `packages/ee/src/accounting/core/service.ts` — parse credentials through the shim
- Modify: `packages/ee/src/accounting/providers/xero/provider.ts` — read `tenantId` from `providerMetadata`
- Modify: `apps/erp/app/routes/api+/integrations.xero.oauth.ts` — write new credential shape
- Create: `packages/ee/src/accounting/core/__tests__/credentials.test.ts` (mirror the existing test dir layout; if tests live elsewhere in @carbon/ee, follow that layout — check `ls packages/ee/src/**/__tests__ 2>/dev/null` / `grep -rn "describe(" packages/ee/src | head -3` first)

**Steps:**
1. In `core/models.ts` (current union at ~line 23), replace with:

```typescript
export const ProviderCredentialsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("oauth2"),
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
    scope: z.array(z.string()).optional(),
    providerMetadata: z.record(z.string(), z.unknown()).optional() // xero: { tenantId, tenantName }; qbo: { realmId }
  }),
  z.object({
    type: z.literal("webConnector"),
    username: z.string(),
    passwordHash: z.string(),
    ownerId: z.string(),   // GUID in the generated .QWC
    fileId: z.string().optional(), // stamped on first connect
    qbxmlVersion: z.string().optional()
  }),
  z.object({
    type: z.literal("bridge"),
    vendor: z.string(),               // e.g. "conductor"
    externalConnectionId: z.string()  // e.g. Conductor end-user id
  })
]);
```

2. Add `parseStoredCredentials(raw: unknown): ProviderCredentials` in `core/models.ts`: if
   `raw` parses against the new union, return it; else if it looks like the legacy flat shape
   (`type === "oauth2"` with top-level `tenantId`/`tenantName`), map those two fields into
   `providerMetadata` and return the new shape. Throw only if neither parses.
3. Every read of credentials in `core/service.ts` goes through `parseStoredCredentials`. Every
   write (OAuth callback in `integrations.xero.oauth.ts`, token refresh `onTokenRefresh`
   path in the Xero provider) writes the NEW shape.
4. `providers/xero/provider.ts`: replace all `credentials.tenantId` reads with
   `credentials.providerMetadata?.tenantId` (keep a narrow local accessor
   `getXeroTenantId(credentials)` that throws a descriptive error when absent).
5. Tests: (a) legacy flat oauth2 JSON fixture parses to new shape with tenantId under
   providerMetadata; (b) new-shape round-trip; (c) webConnector + bridge variants parse;
   (d) garbage input throws.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: new credentials tests pass; zero existing test regressions.
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit 0.
```

**Out of scope:** Changing OAuth URLs/scopes; touching `packages/ee/src/xero/config.tsx`;
QBO/QBD provider implementations.

---

## Task 4: Apply per-company syncConfig

**Depends on:** Task 2 (parallel-safe with Tasks 3, 5)
**Files:**
- Modify: `packages/ee/src/accounting/core/service.ts` — merge stored config over defaults (the "currently hardcodes" site, ~line 64)
- Create: `packages/ee/src/accounting/core/__tests__/sync-config.test.ts` (same test-layout rule as Task 3)

**Steps:**
1. Add `resolveSyncConfig(metadata: unknown): GlobalSyncConfig`: start from
   `DEFAULT_SYNC_CONFIG`, deep-merge `metadata.syncConfig.entities[entityType]` per entity for
   the keys `enabled`, `direction`, `owner`, `syncFromDate` only (ignore unknown keys). Zod-
   validate the stored fragment with a partial schema; invalid fragments are ignored with a
   `console.warn` (never throw — a bad stored config must not break sync).
2. Use `resolveSyncConfig` at the site that currently returns `DEFAULT_SYNC_CONFIG`.
3. Tests: (a) no stored config → deep-equals `DEFAULT_SYNC_CONFIG`; (b) stored
   `{ item: { enabled: false } }` → item disabled, everything else default; (c) invalid stored
   direction value → ignored, default kept.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: sync-config tests pass (3 cases), no regressions.
```

**Out of scope:** The settings UI for editing the config (Task 11); changing
`DEFAULT_SYNC_CONFIG` values.

---

## Task 5: Sync-operations service (core/operations.ts)

**Depends on:** Task 2 (parallel-safe with Tasks 3, 4)
**Files:**
- Create: `packages/ee/src/accounting/core/operations.ts`
- Modify: `packages/ee/src/accounting/index.ts` — export the new module
- Modify: `packages/ee/src/accounting/core/models.ts` — zod schemas for operation rows/transitions
- Create: `packages/ee/src/accounting/core/__tests__/operations.test.ts`

**Steps:**
1. Copy the class/service style of `packages/ee/src/accounting/core/external-mapping.ts`
   (precedent). All functions take `client: SupabaseClient<Database>` first and return
   `{ data, error }`; every query scopes `.eq("companyId", companyId)`.
2. Implement:
   - `enqueueSyncOperation(client, op)` where `op = { companyId, integration, entityType,
     entityId, direction, trigger, idempotencyKey, createdBy, metadata? }`. Behavior: if a
     row with the same `(companyId, integration, idempotencyKey)` exists → return it
     (idempotent). If a `Pending`/`In Flight` row exists for the same
     `(entityType, entityId, direction)` → return it (absorbed; rely on the partial unique
     index — treat a 23505 unique violation as absorption, re-select and return). Preserve
     the current 60s cooldown: if a `Completed` row for the same tuple has
     `completedAt > now() - 60s` and `trigger` is `event`/`webhook`, return
     `{ data: null, error: null }` (skipped).
   - `claimPendingOperations(client, { companyId, integration, limit })` → set claimed rows
     `In Flight` + `lastAttemptAt = now()`, `attemptCount += 1`, return them.
   - `completeOperation(client, { id, companyId, externalId? })` → `Completed`, `completedAt`.
   - `failOperation(client, { id, companyId, errorCode?, errorMessage, warning? })` →
     `Failed` (or `Warning` when `warning: true`), store error fields.
   - `transitionOperation(client, { id, companyId, to, userId })` for UI actions with the
     guard table: `Failed|Warning → Pending` (retry), `Failed|Warning|Pending → Skipped`,
     `Completed → Pending` (re-send). Any other transition returns
     `{ data: null, error: "invalid transition <from> → <to>" }`. Stamp `updatedBy`.
   - `getSyncOperations(client, { companyId, integration, status?, limit, offset })` for the UI.
3. Tests (mock supabase client the same way existing @carbon/ee tests do — check an existing
   test for the mocking pattern first; if @carbon/ee has no service tests with a mocked
   client, test the pure parts (transition guard table, absorption decision) as extracted
   pure functions instead): all transition-guard cases, idempotency-absorption, cooldown skip.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: operations tests pass incl. every transition-guard case.
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0.
```

**Out of scope:** Calling providers (Task 6 drains); UI (Task 7); deleting operations
(no delete path in v1 — rows age out later, not in this plan).

---

## Task 6: Route Inngest sync entry points through the operations ledger

**Depends on:** Tasks 3, 5
**Files:**
- Modify: `packages/jobs/src/inngest/functions/events/sync.ts` — enqueue + drain via operations
- Modify: `packages/jobs/src/inngest/functions/integrations/sync-external-accounting.ts` — same
- Modify: `packages/jobs/src/inngest/functions/integrations/accounting-backfill.ts` — same (trigger='backfill')

**Steps:**
1. In each entry point, replace the direct `SyncFactory.getSyncer(...).push/pull...` dispatch
   with: `enqueueSyncOperation(...)` (per entity, `idempotencyKey` =
   `<entityType>:<entityId>:<direction>:<trigger==='backfill' ? backfillRunId : 'live'>`)
   then a drain step: `claimPendingOperations(...)` → for each claimed op, run the SAME
   syncer call that exists today → `completeOperation` / `failOperation` with the caught
   error's message. Behavior must be preserved: same syncers, same order (dependency JIT sync
   via `ensureDependencySynced` stays inside the syncers), same `withTriggersDisabled` usage.
2. Keep Inngest `retries: 3` semantics: a drain step that throws re-runs; because claim/
   complete are idempotent and enqueue absorbs, retries must not duplicate work — on drain
   retry, rows stuck `In Flight` with `lastAttemptAt < now() - 10 min` are re-claimable
   (add this recovery to `claimPendingOperations`).
3. The service-role Supabase client already used by these functions is the client passed to
   the operations service. Do not create new clients.
4. Preserve the existing `TABLE_TO_ENTITY_MAP` contents exactly (journal is added in Task 10,
   not here).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0.
pnpm --filter @carbon/jobs test
# Expected: existing jobs tests pass (no regressions).
```

**Out of scope:** journal/posting operations (Task 10); changing event-queue cron cadence;
new Inngest function registrations (none needed here — these functions already exist).

---

## Task 7: Sync activity tab (error inbox UI)

**Depends on:** Tasks 5, 6
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — loader returns sync operations for accounting-category integrations; action gains `intent=transition-sync-operation`
- Create: `apps/erp/app/modules/settings/ui/Integrations/SyncActivity.tsx`
- Modify: `apps/erp/app/modules/settings/ui/Integrations/index.ts(x)` — export it (check the dir's existing barrel convention first)
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/audit-logs.tsx` + `apps/erp/app/modules/settings/ui/AuditLog/` (read-heavy table with detail), and `apps/erp/app/modules/settings/ui/ApiKeys/` (settings table with row actions)

**Steps:**
1. Loader (`integrations.$id.tsx`): when the integration's config `category === "Accounting"`,
   call `getSyncOperations` (service-role not needed — RLS SELECT covers employees; use the
   `client` from `requirePermissions`) with status filter + pagination from URL search params.
2. Action: `assertIsPost`; `requirePermissions(request, { update: "settings" })`; validate a
   zod schema `{ intent: "transition-sync-operation", operationId, to }` with
   `validator(schema).validate(formData)`; call `transitionOperation`; flash
   success/error per house convention (plain objects; `throw redirect` on success is NOT
   wanted here — stay on page, return `data({}, await flash(...))`).
3. `SyncActivity.tsx`: table with columns Status (chip), Entity (type + id link where a
   `path.to.*` helper exists for the entity type — otherwise plain text), Direction, Trigger,
   Attempts, Last attempt (relative time), Error (truncated, full text in a Drawer detail on
   row click — Drawer per house convention). Row actions per status: Retry
   (Failed/Warning), Skip (Failed/Warning/Pending), Re-send (Completed). Bulk retry for the
   current filter. Status filter tabs across the top. Copy table primitives from the AuditLog
   precedent; buttons/forms from ApiKeys. Counts displayed plainly (never `(n)`).
4. Only render the tab for accounting-category integrations (check how `integrations.$id.tsx`
   currently reads the integration definition from `@carbon/ee` — reuse that).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0.
pnpm run lint
# Expected: no new Biome errors.
```

**Out of scope:** Email/digest notifications; account mapping and posting settings UI
(Task 11); MES.

---

## Task 8: Account-mapping service (core/account-mapping.ts)

**Depends on:** Task 2 (independent of Tasks 3–7)
**Files:**
- Create: `packages/ee/src/accounting/core/account-mapping.ts`
- Modify: `packages/ee/src/accounting/index.ts` — export
- Create: `packages/ee/src/accounting/core/__tests__/account-mapping.test.ts`
- Copy from (precedent): `packages/ee/src/accounting/core/external-mapping.ts`

**Steps:**
1. Thin wrappers over `ExternalIntegrationMappingService` with `entityType='account'`:
   - `getAccountMappings(client, { companyId, integration })` → rows joined with `account`
     (id, number, name) — resolve Carbon side by `account.id` ONLY (lesson: never by number).
   - `upsertAccountMapping(client, { companyId, integration, accountId, externalId, externalCode?, externalName?, userId })`
     (external code/name into mapping `metadata` for display).
   - `getUnmappedPostingAccounts(client, { companyId, integration })` → Carbon accounts that
     (a) appear in `accountDefault` columns, or (b) are referenced by `itemPostingGroup`
     account columns, or (c) have at least one `journalLine`, MINUS already-mapped ids.
     Implement as one Kysely query with unions; exclude group headers (accounts where
     `isGroup = true`).
   - `matchAccountsByCode(client, { companyId, integration, providerAccounts })` where
     `providerAccounts = [{ id, code, name }]`: propose (not write) matches where Carbon
     `account.number` equals provider `code` exactly; the UI confirms and calls upsert.
     (Matching BY number is allowed here — external-code mapping is the documented legitimate
     use.)
2. Tests: unmapped-accounts union logic (fixture rows), match-by-code exact-only, upsert
   round-trip through a mocked mapping service (same mocking pattern rule as Task 5).

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: account-mapping tests pass.
```

**Out of scope:** UI (Task 11); tax-rate mapping (not in v1 for Xero — Xero tax handling on
manual journals uses the account's default tax type; see Task 9 step 4).

---

## Task 9: journalEntry entity type + Xero JournalEntrySyncer

**Depends on:** Tasks 5, 8
**Files:**
- Modify: `packages/ee/src/accounting/core/models.ts` — add `journalEntry` to the entity-type enum + `ENTITY_DEFINITIONS` (dependsOn: none; direction: push-to-accounting only; enabled: false by default in `DEFAULT_SYNC_CONFIG` — posting sync is opt-in per company)
- Modify: `packages/ee/src/accounting/core/sync.ts` — `SyncFactory` dispatches `journalEntry`
- Create: `packages/ee/src/accounting/providers/xero/entities/journal-entry.ts`
- Modify: `packages/ee/src/accounting/providers/xero/models.ts` — `Xero.ManualJournal` zod schema
- Create: `packages/ee/src/accounting/providers/xero/entities/__tests__/journal-entry.test.ts`
- Copy from (precedent): `packages/ee/src/accounting/providers/xero/entities/bill.ts` (syncer shape) and `invoice.ts` (shouldSync gate)

**Steps:**
1. Define the pushable/excluded sourceType lists as exported constants in `core/models.ts`
   exactly per spec Phase B §2:
   - `POSTING_SYNC_DEFAULT_SOURCE_TYPES` = Purchase Receipt, Sales Shipment, Inbound
     Transfer, Outbound Transfer, Transfer Receipt (include only values that exist in the
     `journalEntrySourceType` enum — check the enum in the newest migrations and drop any
     that don't exist), Inventory Adjustment, Inventory Count, Production Order, Production
     Event, Job Consumption, Job Receipt, Job Close, Asset Depreciation, Asset Disposal.
   - `POSTING_SYNC_EXCLUDED_SOURCE_TYPES` = Sales Invoice, Purchase Invoice, Payment, Credit
     Memo, Debit Memo, Sales Return, Purchase Return, Opening Balance (if the enum has it).
   - `Manual` is neither list: pushed only when the company setting enables it.
2. `JournalEntrySyncer extends BaseEntitySyncer<CarbonJournal, Xero.ManualJournal, ...>`,
   push-only (pull methods return a descriptive not-supported error). `fetchLocal` loads the
   journal + `journalLine` rows + line accounts. `shouldSync` gate returns a skip reason
   string unless: status is `Posted`; sourceType is allowed by the company's posting-sync
   settings (from `companyIntegration.metadata.settings.postingSync`, resolved with the Task
   4 pattern); and the journal is not already mapped.
3. Pre-flight (before any Xero call) — on failure call `failOperation` with `warning: true`
   and a machine-readable `errorCode`:
   - `UNMAPPED_ACCOUNTS`: any line's `accountId` lacks an account mapping (list the ids in
     `metadata.unmappedAccountIds`).
   - `CONTROL_ACCOUNT_LINE`: any line's account equals `accountDefault.receivablesAccount`
     or `.payablesAccount`.
   - `PERIOD_LOCKED`: `postingDate` ≤ the Xero org lock date (fetch org settings via the
     provider once per drain, cache on the syncer instance) and policy is `park` (default).
     With policy `redate`, set the push date to lock date + 1 day and append
     ` | original date <postingDate>` to the narration.
4. `mapToRemote`: Xero `POST /ManualJournals` payload —
   `{ Narration: "Carbon <journalEntryId> <journal.id>", Date: <postingDate>,
   Status: "POSTED", LineItems: [{ LineAmount: <line.amount signed: positive=debit,
   negative=credit — VERIFY against one real/sandbox Xero manual journal before finishing;
   if Xero's sign convention differs, invert and document in the file header comment>,
   AccountCode: <mapped code>, Description: <line.description ?? journal.description>,
   TaxType: "NONE" }] }`. Assert the line sum is 0 before push; if not, fail (not warning)
   with `UNBALANCED_JOURNAL`.
5. Reversal: when the enqueue metadata says `reversal: true` (Task 10 sets it), push a new
   manual journal with negated LineAmounts, narration `"Carbon reversal of <original
   journalEntryId>"`, and store the mapping under idempotencyKey `<journal.id>:reversal`.
6. Register in `SyncFactory`. Add `journalEntry` to the Xero provider's `getSyncConfig`.
7. Tests: mapping fixture (3-line journal → payload, signs, balance assert), each pre-flight
   failure path returns the right errorCode, excluded sourceType skips, reversal negation.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: journal-entry syncer tests pass (mapping, pre-flights, reversal).
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0.
```

**Out of scope:** Dimensions → tracking categories (spec: out of scope v1); tax mapping;
QBO/QBD journal push; consolidation (Task 12).

---

## Task 10: Journal posting trigger through the event system

**Depends on:** Task 9
**Files:**
- Modify: `packages/jobs/src/inngest/functions/events/sync.ts` — `TABLE_TO_ENTITY_MAP` gains `journal: "journalEntry"` (line ~36); transition filter + enqueue

**Steps:**
1. In the SYNC handler, for records from table `journal`: only act on UPDATE events where the
   new row's `status` is `Posted` or `Reversed` AND the old row's status differs (the event
   payload carries old/new per the event-system envelope — check how the handler reads
   diffs for existing tables and reuse that accessor; if the envelope does not include the
   old row, STOP and report — do not enqueue on every journal UPDATE).
2. Enqueue with `trigger: 'posting'`, `idempotencyKey: <journal.id>` (or
   `<journal.id>:reversal` when status is `Reversed`, with `metadata.reversal = true`).
   Drain in the same run (Task 6 machinery).
3. Only enqueue when the company has an active accounting integration whose resolved sync
   config has `journalEntry.enabled` (reuse `getAccountingIntegration` + Task 4's resolver —
   the existing handler already resolves the integration for other tables; follow that path).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
pnpm --filter @carbon/jobs test
# Expected: exit 0 / existing tests pass; new unit test (if the handler has a test file)
# covers: Posted transition enqueues, non-status UPDATE does not, Reversed sets reversal metadata.
```

**Out of scope:** The edge posting functions (`post-*`) — they are untouched; public
webhooks (#1059).

---

## Task 11: Account mapping + posting-sync settings UI

**Depends on:** Task 8 (UI patterns from Task 7)
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — loader adds mappings + unmapped accounts + provider chart (reuse the fetch behind `apps/erp/app/routes/api+/integrations.xero.accounts.ts`); actions `intent=upsert-account-mapping`, `intent=update-posting-settings`
- Create: `apps/erp/app/modules/settings/ui/Integrations/AccountMapping.tsx`
- Create: `apps/erp/app/modules/settings/ui/Integrations/PostingSyncSettings.tsx`
- Copy from (precedent): Task 7's `SyncActivity.tsx` (tab wiring), `apps/erp/app/modules/settings/ui/ApiKeys/` (forms-in-settings), form fields from `~/components/Form` (`Select`, `Boolean`/checkbox variants — grep `apps/erp/app/components/Form/index` for exact exports before writing)

**Steps:**
1. `AccountMapping.tsx`: two sections — "Unmapped accounts" (from
   `getUnmappedPostingAccounts`, listed first) and "Mapped" — each row: Carbon account
   (number + name) → provider-account `Select` (options from the chart fetch: code + name);
   saving a row submits `intent=upsert-account-mapping` with `ValidatedForm` +
   `validator(zodSchema)`. "Match by code" button previews `matchAccountsByCode` proposals
   in a Drawer with confirm-all.
2. `PostingSyncSettings.tsx`: enable toggle; sourceType checklist seeded from
   `POSTING_SYNC_DEFAULT_SOURCE_TYPES` (+ `Manual` off-by-default row); consolidation radio
   (`Individual` / `Daily summary`); period-lock policy radio (`Park as error` /
   `Re-date to first open day`). Persists to `companyIntegration.metadata.settings.postingSync`
   via the update-posting-settings action (zod-validated; deep-merge into existing metadata —
   never clobber `credentials`).
3. Both actions: `assertIsPost` + `requirePermissions(request, { update: "settings" })` +
   flash pattern; loader gates the sections to accounting-category integrations exactly like
   Task 7.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm run lint
# Expected: exit 0 / no new Biome errors.
```

**Out of scope:** Tax mapping UI; per-entity direction editing beyond enable toggles already
in scope (keep this task to account mapping + posting settings).

---

## Task 12: Daily-consolidation cron

**Depends on:** Tasks 9, 10
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/accounting-consolidation.ts`
- Modify: `packages/jobs/src/inngest/functions/index.ts` — export + register (registration is in this spec's approved scope)

**Steps:**
1. Inngest cron (daily, `0 2 * * *` UTC): for each company+integration with posting sync
   enabled AND consolidation `Daily summary`: collect `Pending` operations with
   `trigger='posting'` and posting dates strictly before today; group by `postingDate`; for
   each date build ONE aggregated journal payload (sum signed amounts per mapped account,
   drop zero lines, narration `"Carbon daily summary <date> — <n> journals"`), push through
   the same Xero manual-journal call, then mark the member operations `Completed` with
   `metadata.consolidatedInto = <batch idempotencyKey>`; batch idempotencyKey =
   `daily:<integration>:<postingDate>` (enqueued as its own operation row so the unique index
   dedupes re-runs).
2. In individual mode this cron does nothing (drain in Task 6/10 already handled them).
   In daily mode, the Task 10 enqueue must NOT immediately drain journal operations — gate
   the drain on the company's consolidation setting.
3. Pre-flight rules from Task 9 apply per batch (any unmapped account in the batch →
   whole-batch `Warning` listing the account ids).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
pnpm --filter @carbon/jobs test
# Expected: exit 0; unit test for the aggregation (3 journals, 2 accounts → 1 payload with
# summed lines, balanced) passes.
```

**Out of scope:** Backfilling consolidation for dates before the feature was enabled;
consolidation for non-posting entity types.

---

## Task 13: Reconciliation cron + drift report

**Depends on:** Tasks 9, 10
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/accounting-reconciliation.ts`
- Modify: `packages/jobs/src/inngest/functions/index.ts` — export + register
- Modify: `packages/ee/src/accounting/providers/xero/provider.ts` — add `getManualJournal(id)` + `listManualJournals(modifiedSince)` if absent
- Modify: `apps/erp/app/modules/settings/ui/Integrations/SyncActivity.tsx` — drift section at top when drift rows exist

**Steps:**
1. Weekly cron (`0 3 * * 1`): per accounting connection with posting sync enabled:
   (a) presence check — for the last 90 days of `Completed` posting operations, fetch the
   mapped Xero manual journal ids in pages; any missing/voided remotely → write a drift row;
   (b) aggregate check — per calendar month, sum of pushed Carbon journal lines per account
   vs sum of the corresponding Xero manual-journal lines (from the fetched set); mismatch >
   0.01 → drift row. Store drift rows in `companyIntegration.metadata.settings.postingSync
   .lastReconciliation = { runAt, drift: [...] }` (bounded: keep at most 100 drift entries).
2. Surface in `SyncActivity.tsx`: banner + table of drift entries with the Xero id, type
   (missing | mismatch), and amounts.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp
pnpm --filter @carbon/jobs test
# Expected: exit 0; unit test for aggregate comparison (fixture: one matching month, one
# mismatched month → exactly one drift row) passes.
```

**Out of scope:** Full trial-balance tie-out; auto-repair of drift (report only).

---

## Task 14: Browser verification (/test) + full scoped gates

**Depends on:** all prior tasks
**Files:** none (verification only)

**Steps:**
1. Run the full scoped gates:
   `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp`,
   `pnpm --filter @carbon/ee test`, `pnpm --filter @carbon/jobs test`, `pnpm run lint`.
2. Boot the stack with plain `crbn up` (portless). Enable accounting locally if the DB was
   reset (settings → accounting, per memory: reset seeds `accountingEnabled=false`).
3. Invoke `/test` scoped to: integration settings page renders the three new sections for
   Xero; sync-activity transitions (seed a Failed row via psql if no live failure exists;
   Retry moves it to Pending); account mapping upsert round-trip; posting settings persist.
4. Live Xero round-trip (posting a receipt → manual journal in Xero) requires a connected
   Xero sandbox org. If `XERO_CLIENT_ID`/secret are not configured locally or no sandbox org
   is available, STOP the browser pass at the UI-level checks above and report exactly what
   was and wasn't verified — do not fake the round-trip. The unit-level payload tests
   (Task 9) remain the evidence for the mapping logic.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp && pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test && pnpm run lint
# Expected: all exit 0. /test playbook saved under .ai/playbooks/ with pass results for the
# UI checks; any skipped live-Xero checks explicitly listed in the run report.
```

**Out of scope:** Committing (only on explicit ask, via /check-and-commit); QBO/QBD; docs
updates (do with the PR, not this plan).

---

## Acceptance-criteria coverage map

- Phase A criteria 1–3 (ledger behavior, inbox actions, absorption) → Tasks 5, 6, 7, 14
- Phase A criterion 4 (syncConfig applied) → Task 4
- Phase A criterion 5 (credential shim) → Task 3
- Phase A criterion 6 (gates) → Tasks 2, 14
- Phase B criteria 1–2 (receipt journal push; invoice exclusion) → Tasks 9, 10, 14
- Phase B criterion 3 (unmapped → Warning → retry) → Tasks 8, 9, 7
- Phase B criterion 4 (period lock policies) → Task 9
- Phase B criterion 5 (reversal) → Tasks 9, 10
- Phase B criterion 6 (daily summary) → Task 12
- Phase B criterion 7 (idempotency) → Tasks 5, 9
- Phase B criterion 8 (reconciliation drift) → Task 13
