# Plan: Accounting Sync Engine v3 — Manufacturing Journal Sync, Dimensions, Tie-Out

> Spec: [.ai/specs/2026-08-02-accounting-sync-engine-v3.md](../specs/2026-08-02-accounting-sync-engine-v3.md)
> Branch: feat/quickbooks-enterprise-v1 (continues the v2 engine work)
> Date: 2026-08-02
> Status (2026-08-11): Phases 1–2 implemented; Phase 3 NOT executed — tie-out + close-gate
> delivery is now owned by v4 Phase 3
> ([.ai/specs/2026-08-11-accounting-sync-delivery-robustness.md](../specs/2026-08-11-accounting-sync-delivery-robustness.md),
> Pillar E); Phase 4 partial. Do not execute Phase 3 from this file alone — v4 also
> repurposes the reconciliation cron (outbound sweep, v4 Phase 1).

Read before starting any task: `.ai/lessons.md` (enum-pair, seed-reconciliation,
fork-newest-function, migration-timestamp, and rolled-back-psql-validation lessons apply),
`packages/ee/AGENTS.md`, `.claude/rules/database-migration-patterns.md`.

Standing rules for every task:
- Migrations via `pnpm db:migrate:new <name>` (never hand-name timestamps); after applying,
  run `pnpm run generate:types` BEFORE any typecheck; revert generated-file drift you didn't
  intend (`git status` on `packages/database/`).
- Scoped validation only: `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp`
  (never whole-repo tsc), `pnpm --filter @carbon/ee test`, `pnpm --filter @carbon/jobs test`.
- Commit per task through `/check-and-commit`; no auto-push.

---

## Phase 1 — Policy table + recorded dispositions

### 1.1 Migration: `Excluded` sync-operation status ✅ (9a106faf3)
- [x] `pnpm db:migrate:new sync-operation-excluded-status`
- Files: new `packages/database/supabase/migrations/*_sync-operation-excluded-status.sql`
- SQL: `ALTER TYPE "syncOperationStatus" ADD VALUE IF NOT EXISTS 'Excluded';` — follow
  `.claude/rules/database-migration-patterns.md` for enum-addition placement/transaction
  constraints; nothing else in the file.
- [ ] Apply (`pnpm db:migrate`), then `pnpm run generate:types`.
- Verify: `psql ... -c "SELECT unnest(enum_range(NULL::\"syncOperationStatus\"))"` lists
  `Excluded`; migration re-runs cleanly (idempotent); validate in a rolled-back txn first
  per the migration-validation lesson.

### 1.2 `POSTING_POLICY` total record + v3 settings schema + shim ✅ (6d1160c88, with 1.3)
- Files: `packages/ee/src/accounting/core/models.ts`
- [ ] Add `POSTING_POLICY: Record<JournalEntrySourceType, { representation; defaultEnabled; defaultGranularity }>`
      covering all 21 enum values (source the enum from generated types so growth breaks compile).
- [ ] Replace `POSTING_SYNC_DEFAULT_SOURCE_TYPES` / `POSTING_SYNC_EXCLUDED_SOURCE_TYPES`
      with derivations from `POSTING_POLICY`; keep the old exported names as deprecated
      aliases until 1.3/1.4 migrate call sites, then delete the aliases.
- [ ] v3 `PostingSyncSettingsSchema`: `families: { ar, ap }` (each `documents | journals |
      none`, default `documents`; `journals` is schema-valid from day one but UI-gated until
      Phase 4 so no settings shim is needed later), `sourceTypes: Record<sourceType,
      {enabled, granularity}>`, `dimensionSlots: []` (empty until Phase 2),
      `onUnmappedDimensionValue`, existing `periodLockPolicy`/`lockDate`/`enabled`/`syncFromDate`.
- [ ] `POSTING_POLICY` doc-represented rows carry `family: "ar" | "ap" | "per-line"`
      (Payment resolves per journal from its control-account lines).
- [ ] `parsePostingSyncSettings()` read-shim: v2 shape (`sourceTypes: string[]`,
      `consolidation: "individual"|"daily"`, `includeManual`) → v3 (consolidation maps to
      granularity on every enabled journal-represented type; `includeManual` →
      `sourceTypes.Manual.enabled`). Write-back happens only on settings save.
- [ ] Status schema: add `Excluded`; transitions: `Excluded → Pending` allowed via Re-send;
      reason codes `DOC_BACKED | SOURCE_TYPE_DISABLED | MANUAL_DISABLED`.
- Tests: `packages/ee/src/accounting/core/posting.test.ts` + a new
  `core/posting-policy.test.ts` — policy totality (runtime assertion over enum), shim
  round-trips for: v2 defaults, v2 with custom sourceTypes, v2 daily consolidation, absent
  settings.
- [ ] Default-account totality test in `core/account-mapping.test.ts`: every column of the
      generated `accountDefault` Row type except `companyId`/`updatedBy` matches
      `/Account(Id)?$/` (the pattern `collectAccountDefaultAccountIds` relies on), so a
      future differently-named default column fails tests instead of silently escaping the
      required mapping set. See the spec Appendix for the verified 50-column inventory.
- Verify: `pnpm --filter @carbon/ee test` green;
  `pnpm exec turbo run typecheck --filter=@carbon/ee` green.

### 1.3 Decision function returns a disposition ✅ (6d1160c88, with 1.2)
- Files: `packages/ee/src/accounting/core/posting.ts`
- [ ] `getJournalPostingDecision(...)` → `{ kind: "push", granularity } | { kind: "exclude", reason, backingDocument? } | { kind: "warn", code } | { kind: "none" }`
      (`none` = posting sync off / no integration → no row). Fold
      `getPostingSyncSourceTypeSkipReason` into it; delete the standalone skip-reason path.
- [ ] Doc-represented source types route by the journal's family (static per source type;
      `Payment` inspected from control-account lines) and the company's `families` setting:
      `documents` + entity sync enabled → `exclude/DOC_BACKED` with
      `backingDocument: { entityType }` — entityType only: document linkage lives on
      `journalLine.documentId`, not the journal header, so the concrete document is
      resolved at read time by the completeness service (1.8) via the journal's lines;
      `documents` + entity sync disabled → `warn/DOC_SYNC_DISABLED`;
      `journals` → `push` with granularity forced `individual` (`warn/DOUBLE_REPRESENTATION`
      if the family's document entity sync is somehow also enabled); `none` →
      `exclude/FAMILY_OFF`. *(Amended 2026-08-02 during implementation: the original
      "derive entityId from the journal's documentId" assumed a header column that does
      not exist.)*
- [ ] Granularity resolved per source type from settings (shimmed), falling back to policy default.
- Tests: every branch incl. reversal suffix handling; doc-backed → `exclude/DOC_BACKED`
      with backingDocument; doc sync disabled → `warn/DOC_SYNC_DISABLED`; family routing
      for every doc source type × family mode (incl. Payment line inspection both sides);
      `none` → `exclude/FAMILY_OFF`.
- Verify: `pnpm --filter @carbon/ee test` green.

### 1.4 Record dispositions in the event path ✅ (afca82fcb)
- Files: `packages/jobs/src/inngest/functions/events/sync.ts`,
  `packages/jobs/src/inngest/functions/integrations/accounting-sync-operations.ts`
- [ ] On `exclude` decisions, insert a terminal `Excluded` operation (idempotency key =
      existing journal key; absorb/no-op if any operation already exists for the journal;
      `errorCode` = reason, `metadata.policy` = snapshot of the deciding config,
      `metadata.backingDocument` when doc-backed).
- [ ] On `warn` decisions (`DOC_SYNC_DISABLED`), insert the operation directly in `Warning`
      (Retry re-decides against current config, so enabling document sync + Retry resolves it).
- [ ] `enqueueSyncOperations()` gains an `insertTerminal()` helper covering both cases
      (does not enter the Pending claim path); drain untouched.
- [ ] Backfill entry point (`accounting-backfill.ts`): journals since `syncFromDate` with no
      operation row get decided + recorded the same way (this is the missed-event repair).
- Tests: `packages/jobs/src/inngest/functions/integrations/accounting-sync-operations.test.ts` —
  excluded insert, idempotent re-delivery, backfill decides unrecorded journals.
- Verify: `pnpm --filter @carbon/jobs test` green; typecheck filter set green.

### 1.5 Per-source-type consolidation partitions ✅ (1e46cc75d)
- Files: `packages/jobs/src/inngest/functions/integrations/accounting-consolidation.ts`,
  `packages/ee/src/accounting/core/posting.ts` (`aggregateJournalEntriesForDate`)
- [ ] Claim filter selects only journals whose resolved granularity is `daily-summary`
      (individual ones drain in the normal event path — they no longer wait for the cron).
- [ ] Batches partition per (source type, posting date); grouping stays per account in this
      phase (dimension tuple arrives in 2.4); batch operation `metadata.journalIds` = members;
      provider memo carries `sourceType`, member count, batch ref.
- [ ] A member failing pre-flight is ejected to its own parked operation; the batch proceeds
      without it.
- Tests: partition math, member ejection, memo contents (pure helpers).
- Verify: `pnpm --filter @carbon/jobs test` + `pnpm --filter @carbon/ee test` green.

### 1.6 Settings UI: policy table ✅ (7eede0ad3)
- Files: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` (+ its posting-sync form
  component under `apps/erp/app/modules/settings/ui/` — follow where the v2 posting-sync
  form lives; extend, don't fork)
- [ ] Per-source-type rows: representation badge (Journal / Document / Off), enabled toggle
      (journal types only), granularity select. `ValidatedForm` + zod; action persists v3
      shape. Counts plain (no parenthesized numbers).
- [ ] Mapping-readiness strip next to the posting-sync enable toggle: "N of M posting
      accounts mapped" from the existing `getUnmappedPostingAccounts()`; the account-mapping
      section groups `accountDefault`-referenced (control) accounts first, unmapped-first
      within the group. Service already exists — UI wiring only.
- Verify: typecheck erp green; browser-verify via `/auth` + `/test` (settings page renders
  all 21 rows, toggling persists, doc-backed rows read-only) — record screenshots for the PR.

### 1.7 Inbox: Excluded + drill-back ✅ (landed with 6d1160c88)
- Files: the sync-activity table component under the integration detail route
- [x] `Excluded` status chip + reason column value; status filter includes it; batch
      drill-back via the existing operation detail Drawer, which renders errorCode,
      message, and the full metadata (journalIds/consolidatedInto/backingDocument).
      *(Amended: a dedicated expandable member list was unnecessary — the detail Drawer
      already surfaces the batch membership.)*
- Verify: typecheck green; browser-verify inbox filter + batch expansion.

### 1.8 Completeness service (foundation for tie-out) ✅ (dd741436d)
- Files: `apps/erp/app/modules/accounting/accounting.service.ts`
- [ ] `getJournalSyncCompleteness(client, { companyId, integrationId, periodId? })` — posted
      journals since posting-sync start LEFT JOIN operations; returns unaccounted journal
      ids + per-disposition sums. Doc-backed rows resolve the backing document's latest
      operation status (join via `metadata.backingDocument`): counted delivered only when
      `Completed`, otherwise reported as pending/blocked. Used by 1.6 acceptance and Phase 3.
- Tests: service-level test with seeded fixtures if harness allows; else exercised via 3.x.
- Verify: typecheck green; acceptance query on a seeded local company returns zero
  unaccounted journals after a mixed posting session (receipt + invoice + production events).

Phase 1 gate: all spec Phase-1 acceptance criteria demonstrated on the local stack
(`crbn up`), `/check-and-commit` per task, then `/self-review` the phase diff.

---

## Phase 2 — Dimension sync

### 2.1 Provider capability surface
- Files: `packages/ee/src/accounting/core/types.ts`
- [ ] `DimensionTarget { id, label, capacity? }`; optional
      `BaseProvider.journalDimensionTargets(): Promise<DimensionTarget[]>`;
      `ProviderCapabilities.maxJournalDimensionSlots`.
- Verify: typecheck @carbon/ee green.

### 2.2 `core/dimension-mapping.ts`
- Files: NEW `packages/ee/src/accounting/core/dimension-mapping.ts` (+ test)
- [ ] `getDimensionValueMappings`, `upsertDimensionValueMapping` (entityId
      `"<dimensionId>:<valueId>"`, `allowDuplicateExternalId: true`),
      `matchDimensionValuesByName` (exact-match proposals only),
      `getUnmappedSlottedDimensionValues` (values present on posted journal lines for
      slotted dimensions, minus mapped), slot-config validation against provider targets
      (capacity, duplicate targets).
- [ ] Value labels resolve per dimension entityType: Custom → `dimensionValue`; entity
      dims → their source table (mirror how `DimensionSelector.tsx` resolves labels — reuse,
      don't re-derive).
- Tests: composite-key mapping, match-by-name skips ambiguous, slot validation.
- Verify: `pnpm --filter @carbon/ee test` green.

### 2.3 Journal line dimensions through the core
- Files: `packages/ee/src/accounting/core/models.ts` (`JournalEntryLine.dimensions`),
  each provider's `entities/journal-entry.ts` `fetchLocal` (QBO, Xero, Rillet) to join
  `journalLineDimension`.
- Verify: existing journal-entry tests updated + green.

### 2.4 Pre-flight + summary grouping by dimension tuple
- Files: `packages/ee/src/accounting/core/posting.ts`
- [ ] `collectUnmappedDimensionValues(lines, slots, mappings)` → pre-flight code
      `UNMAPPED_DIMENSION_VALUES` (park) or drop-with-record per
      `onUnmappedDimensionValue`; dropped dims recorded in operation metadata.
- [ ] `aggregateJournalEntriesForDate` groups by `(accountId, dimensionTuple)`; rounding
      residue (post-2dp) books to `accountDefault.roundingAccount`, mapped like any account.
- Tests: tuple grouping (two locations → two lines), residue line, drop-mode metadata.
- Verify: `pnpm --filter @carbon/ee test` green.

### 2.5 QBO provider dimensions
- Files: `packages/ee/src/accounting/providers/quickbooks-online/provider.ts`, `models.ts`,
  `entities/journal-entry.ts`, `entities/shared.ts`, tests under `__tests__/`
- [ ] `listClasses()` / `listDepartments()` (+ graceful empty targets when the QBO plan has
      the feature off — detect via query error/empty capability, don't hard-fail);
      `journalDimensionTargets()` → `class`, `department`.
- [ ] Line mapping: slotted dims → `ClassRef` / `DepartmentRef` via value mappings;
      `autoCreate` → create Class/Department by name, store mapping, then push.
- Tests: golden-fixture mapper output incl. both refs, missing-value park, auto-create flow
  (stubbed HTTP).
- Verify: `pnpm --filter @carbon/ee test` green.

### 2.6 Xero provider dimensions
- Files: `providers/xero/provider.ts`, `models.ts`, `entities/journal-entry.ts`, test
- [ ] `listTrackingCategories()` (+ options); targets `tracking:<categoryId>` capped at 2;
      manual-journal lines gain `Tracking: [{ TrackingCategoryID, TrackingOptionID }]`;
      option `autoCreate` supported.
- Tests: fixture with 2 categories, capacity enforcement, option auto-create.
- Verify: `pnpm --filter @carbon/ee test` green.

### 2.7 Rillet Fields
Support confirmed (Brad, 2026-08-02): Rillet dimensions are called **Fields**; values are
expected to need **upsert** via the API. Remaining unknown is only the exact v4 surface.
- [ ] VERIFY the v4 endpoint/ref shape against docs.api.rillet.com + sandbox: how Fields
      and their values are listed, how journal items reference them (id vs code), and the
      upsert semantics. Record findings in the spec changelog before wiring.
- Files: `providers/rillet/provider.ts` (+ `models.ts`): `listFields()` / field-value list +
  upsert, `journalDimensionTargets()` → `field:<fieldId>`; `entities/journal-entry.ts`:
  slotted dims → journal-item field refs; `autoCreate` defaults **on** for Rillet slots
  (upsert-by-name at push). Tests: golden-fixture mapper output with fields, upsert flow
  (stubbed HTTP), value-mapping reuse after upsert.
- Verify: `pnpm --filter @carbon/ee test` green; sandbox live-fire push with one Field
  (env-gated on API keys — flag, don't fake, if unavailable).

### 2.8 Settings UI: slots + value mapping
- Files: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` + settings UI components
- [ ] Slot section: Carbon dimension picker (show value counts; warn on high-cardinality) →
      provider target select (from `journalDimensionTargets`), autoCreate toggle, capacity
      enforced; `onUnmappedDimensionValue` radio.
- [ ] Per-slot value-mapping table, unmapped first, "Match by name" bulk action (mirrors the
      account-mapping section's interaction pattern — copy that component's precedent).
- Verify: typecheck erp green; browser-verify slot config + mapping + a parked
  `UNMAPPED_DIMENSION_VALUES` journal recovering via map + Retry; screenshots for the PR.

Phase 2 gate: spec Phase-2 acceptance criteria on the local stack + sandbox where keys
exist; `/self-review` the phase diff.

---

## Phase 3 — Tie-out + period-close gate

> **Status (2026-08-11): not executed.** Implementation is now owned by v4 Phase 3
> (`.ai/specs/2026-08-11-accounting-sync-delivery-robustness.md`, Pillar E). The task
> breakdown below remains a valid starting point, but note task 3.2's host function
> (`accounting-reconciliation.ts`) is also reshaped by v4 Phase 1 (outbound reconciliation
> sweep) — plan those together.

### 3.1 Migration: `accountingSyncTieOut`
- [ ] `pnpm db:migrate:new accounting-sync-tieout` — table + indexes + RLS exactly per the
      spec's Data Model section, mirroring the *newest* RLS helper-cast style (grep the most
      recent migration touching `get_companies_with_employee_permission`).
- [ ] Apply + `pnpm run generate:types`.
- Verify: rolled-back psql validation; RLS: `accounting_view` employee can SELECT,
  authenticated cannot INSERT.

### 3.2 Tie-out computation
- Files: `packages/jobs/src/inngest/functions/integrations/accounting-reconciliation.ts`
  (rename intent: reconciliation = presence check + tie-out; keep function id),
  pure helpers in `integrations/accounting-sync-operations.ts`, provider fetch reuse from
  the existing presence check
- [ ] Per integration: for each period since posting-sync start (skip closed periods with an
      existing row — I4 makes them immutable), compute the six Carbon sums from
      journals × dispositions (SQL), fetch provider sums by external id (individual +
      batch), upsert `accountingSyncTieOut` cells with deltas.
- [ ] On-demand trigger: `trigger("accounting-tieout", { companyId, integrationId, periodId? })`
      wired to the same computation.
- Tests: pure math (dispositions → sums, batch attribution, sign normalization vs provider
  Dr/Cr), closed-period skip.
- Verify: `pnpm --filter @carbon/jobs test` green.

### 3.3 Tie-out UI
- Files: NEW `apps/erp/app/routes/x+/accounting+/sync-tieout.tsx` (+ Drawer child route for
  cell drill-down), `accounting.service.ts` (`getAccountingSyncTieOut`, cell drill query),
  summary card on `x+/settings+/integrations.$id.tsx`
- [ ] Grid period × account, internal/external delta badges, Recompute action (fires the
      event), cell → Drawer listing journals + dispositions + operation links.
      `requirePermissions` with `view: "accounting"`.
- Verify: typecheck erp green; browser-verify with seeded data (zero deltas), then simulate
  drift (delete a sandbox provider journal or stub) → red cell + drill-down; screenshots.

### 3.4 Period-close auto-check
- Files: `packages/database/supabase/functions/lib/seed.data.ts` (new Auto task
  "External GL sync complete"), reconciling migration for existing companies
  (`pnpm db:migrate:new period-close-sync-check` — idempotent `INSERT … ON CONFLICT DO
  NOTHING`, `createdBy` = system user), `accounting.service.ts`
  (`computePeriodReadiness` gains the check via `getJournalSyncCompleteness` +
  non-terminal-operation count for the period; auto-pass when posting sync off)
- Tests: readiness fn unit tests (pending/failed blocks; excluded/completed passes; sync-off
  passes).
- Verify: rolled-back psql validation of the migration; `pnpm --filter erp typecheck` +
  targeted vitest green; browser-verify: period with a Failed op blocks close, Retry →
  close proceeds.

### 3.5 Doc + rule sync
- Files: `.claude/rules/accounting-sync-handlers.md` (rewrite to v3: three providers, policy
  table, dispositions, dimension slots/mappings, tie-out, close gate),
  `packages/ee/AGENTS.md` (key patterns + new core file), `apps/erp/app/modules/accounting/AGENTS.md`
  (tie-out table + service fns), `docs/` accounting-integration pages via the `carbon-docs`
  skill (user-facing: policy settings, dimension mapping, tie-out, close check).
- Verify: no stale claims (grep the rule for "Xero is the only live provider" → gone);
  `pnpm --filter docs build` green if docs touched.

### 3.6 Phase-3 gate
- [ ] Spec Phase 1–3 acceptance criteria walked against the running stack; env-gated items
      (provider sandboxes) flagged explicitly, never faked.

---

## Phase 4 — AR/AP journal mode (both-cases support)

> **Status (2026-08-11): partial.**

Ships the `families.* = "journals"` option: invoices/bills/payments/memos posted within
Carbon reach the external system as journal entries instead of documents.

### 4.1 Representation-aware pre-flight + settings enforcement
- Files: `packages/ee/src/accounting/core/posting.ts`, `core/models.ts`,
  `apps/erp/app/routes/x+/settings+/integrations.$id.tsx`
- [ ] AR/AP control-account pre-flight fires only for families in `documents` mode (its
      anti-double-post purpose); in `journals` mode control-account lines are expected.
- [ ] Settings action enforces mutual exclusion: `families.X = "journals"` requires that
      family's document entity syncs disabled (and vice versa), with a clear inline error.
- Tests: pre-flight matrix (family mode × control-account line), settings action rejection.
- Verify: `pnpm --filter @carbon/ee test` + typecheck erp green.

### 4.2 QBO journal mode
- Files: `providers/quickbooks-online/entities/journal-entry.ts`, `entities/shared.ts`, tests
- [ ] AR/AP lines gain `Entity` refs: resolve the backing document's customer/vendor mapping
      (JIT `ensureDependencySynced` like invoice/bill syncers do today).
- [ ] Aggregate control-account lines to one AR + one AP line per JE (sum per side; legit —
      one journal = one document = one party); reject with a structured error if a journal
      somehow spans parties.
- Tests: golden fixtures — invoice journal (AR + revenue + tax), payment journal (bank + AR
  with entity ref), multi-application payment aggregation.
- Verify: `pnpm --filter @carbon/ee test` green; QBO sandbox live-fire (env-gated).

### 4.3 Xero journal mode
- Files: `providers/xero/entities/journal-entry.ts`, `core/account-mapping.ts`, mapping UI
- [ ] Pre-flight `XERO_SYSTEM_ACCOUNT`: in `journals` mode, mapped targets for
      `receivablesAccount`/`payablesAccount`/`bankCashAccount` must not be Xero system
      AR/AP or bank-type accounts (types available from the chart pull); mapping UI surfaces
      the constraint when a family is in journal mode (hint: designate regular
      clearing-style accounts).
- Tests: account-type validation fixtures; manual-journal payload with remapped accounts.
- Verify: `pnpm --filter @carbon/ee test` green; Xero sandbox live-fire (env-gated).

### 4.4 Rillet journal mode
- [ ] Verify AR/AP account posting via journals in the sandbox (expected to pass — open GL);
      add fixture tests for an invoice journal with Fields attached.
- Verify: `pnpm --filter @carbon/ee test` green.

### 4.5 Settings UI unlock + browser verification
- [ ] Families three-way select (documents / journals / none) with per-provider caveat copy;
      journals option no longer gated.
- Verify: browser-verify both cases end-to-end on the local stack: (a) documents mode —
  invoice → provider document + `DOC_BACKED` disposition; (b) journals mode — invoice →
  journal push decision + no document operation; (c) `none` → `FAMILY_OFF`. Screenshots.

### 4.6 Final gate
- [ ] Spec Phase 4 acceptance criteria walked; docs/rule refresh from 3.5 extended with the
      family representation model.
- [ ] `/self-review` on the full branch diff; update the spec changelog with implementation
      deviations; move spec toward `implemented/` only with Brad's sign-off.

---

## Task → file quick index

| Area | Files |
|---|---|
| Policy + shim + families | `packages/ee/src/accounting/core/models.ts`, `core/posting.ts` |
| AR/AP journal mode | `core/posting.ts`, `providers/*/entities/journal-entry.ts`, `core/account-mapping.ts`, settings route |
| Dispositions | `packages/jobs/.../events/sync.ts`, `.../integrations/accounting-sync-operations.ts`, `accounting-backfill.ts` |
| Consolidation | `packages/jobs/.../integrations/accounting-consolidation.ts` |
| Dimensions core | `packages/ee/src/accounting/core/dimension-mapping.ts` (NEW), `core/types.ts`, `core/posting.ts` |
| Providers | `providers/{quickbooks-online,xero,rillet}/{provider.ts,models.ts,entities/journal-entry.ts}` |
| Tie-out | migration, `packages/jobs/.../integrations/accounting-reconciliation.ts`, `apps/erp/app/routes/x+/accounting+/sync-tieout.tsx` (NEW), `accounting.service.ts` |
| Close gate | `seed.data.ts`, reconciling migration, `accounting.service.ts` |
| Settings UI | `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` + settings UI components |
| Docs | `.claude/rules/accounting-sync-handlers.md`, AGENTS.md files, `docs/` |
