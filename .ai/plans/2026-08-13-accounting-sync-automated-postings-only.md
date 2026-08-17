# Plan: Accounting sync = Carbon's automated postings only (always-on, no manual journals)

Date: 2026-08-13
Branch: feat/rillet
Status: Tasks 1-6 + 8 implemented 2026-08-13 (working tree; Task 1 was pre-existing WIP). Tasks 7 (reversal/void propagation audit) and 9 (lock families to documents) remain open.

## Goal / principle

The accounting sync mirrors **exactly** Carbon's automated GL postings — every
`journalEntrySourceType` **except `Manual`** — plus their reversals/voids, using the
mapped accounts. This is the **definition** of the sync, not a configurable option:

- **Automated postings always sync** when an accounting integration is connected. No
  master "posting sync enabled" toggle, no per-source-type on/off, no `journalEntry`
  entity gate. If an account isn't mapped the op warns `UNMAPPED_ACCOUNTS` (correct —
  the user maps it); it is never silently dropped.
- **`Manual` journals never sync**, in any engine. They are the only path to
  non-mapped/arbitrary accounts, and the external GL owns things Carbon doesn't
  (payroll, etc.). Carbon is a *subset* of the external GL.
- **AR/AP keep native-document representation** (bill → ACCPAY Bill, invoice → ACCREC
  Invoice). GR/IR clears because the coupled receipt journal now always syncs, and the
  bill's own `Purchase Invoice` journal stays `DOC_BACKED` (no double-post).
- Provider-agnostic: lands identically on Xero, QBO, Rillet.
- **No existing-company remediation / backfill** — building + testing only.

Grounded against the edit map in this branch's investigation. Verified current shapes:
`POSTING_POLICY` (models.ts:290-413), the `journalEntryPushEnabled` gate
(reconcile-executor.ts:123-124 + reconcile.ts:186-188), `DEFAULT_SYNC_CONFIG.entities.journalEntry`
(models.ts:242-246), the three `build*SyncConfig`, and `getPeriodExternalGlSyncReadiness`
(apps/erp accounting.service.ts:~2431-2444).

## Design decisions (resolved)

- **D1 — Manual marker.** `POSTING_POLICY` is `Record<JournalEntrySourceType, …>`, so
  `Manual` can't be deleted. Add `syncable: boolean` to `PostingPolicyEntry`; `Manual`
  is the only `syncable: false`. The policy resolver returns `MANUAL_DISABLED` for
  `Manual` **permanently**, regardless of stored config.
- **D2 — Config fields: keep-but-ignore, don't delete.** To avoid a stored-config parse
  break (`resolvePostingSyncSettings` swallows parse errors → silently disables sync —
  posting.ts:56-63), keep `PostingSyncStoredSchema.enabled` and per-type `enabled` in the
  schema for backward-compatible parsing, but **stop reading them** in the decision core.
  Force `enabled` default to `true`. The decision core treats every non-Manual
  journal-represented type as always-push.
- **D3 — Native docs, always.** AR/AP families default to `documents`. See Task 9
  (recommended, separable) for removing the `none`/`journals` options so the config
  can't express "don't sync AR/AP".
- **D4 — Granularity stays.** Per-type `individual` vs `daily-summary` is a real volume
  control (Production Event, Job Consumption default daily); keep it.

## Tasks

### Task 1 — `Manual` permanently non-syncable (core policy)
Files: `packages/ee/src/accounting/core/models.ts`, `packages/ee/src/accounting/core/posting.ts`
- [x] Add `syncable: boolean` to `PostingPolicyEntry` (models.ts:269-282). Set `syncable: false`
      on `Manual` (models.ts:294-298), `true` on every other entry.
- [x] In `getJournalPostingPolicyDecision` (posting.ts:186-204): replace the
      `!config.enabled` gate. If `!policy.syncable` → return
      `{ kind:"exclude", reason:"MANUAL_DISABLED", … }`. Otherwise for
      `representation:"journal"` → `{ kind:"push", granularity: POSTING_POLICY[st].defaultGranularity }`
      (no per-type enable read). Keep the null/unknown-source-type exclude (posting.ts:153-171).
- [x] Keep the Inventory-Adjustment DOC_BACKED branch (posting.ts:173-184) and
      `decideDocumentFamily` (posting.ts:236-295) unchanged.
- Verify: `pnpm --filter @carbon/ee test -t "getJournalPostingPolicyDecision"` — Manual
  excludes MANUAL_DISABLED; every other journal type pushes.

### Task 2 — Always-on: remove the master + journalEntry-entity gate
Files: `packages/ee/src/accounting/core/models.ts`,
`packages/jobs/src/inngest/functions/integrations/reconcile-executor.ts`,
`packages/jobs/src/inngest/functions/integrations/accounting-sync-operations.ts`
- [x] `DEFAULT_SYNC_CONFIG.entities.journalEntry.enabled` → `true` (models.ts:242-246);
      update the "opt-in per company" comment.
- [x] `PostingSyncStoredSchema.enabled` default → `true` (models.ts:537).
- [x] `reconcile-executor.ts:123-124`: `journalEntryPushEnabled` → drop `&& settings.enabled`;
      reduces to `isJournalEntryPostingEnabled(...)` (now always true) — or hardcode `true`
      and delete the field. Update `ReconcileContext.journalEntryPushEnabled` doc (reconcile.ts:104-105).
- [x] `isJournalEntryPostingEnabled` (accounting-sync-operations.ts:231-235) doc → always-on.
- Verify: `pnpm --filter @carbon/jobs typecheck`.

### Task 3 — Downstream consumers of the removed gate
Files: `packages/jobs/src/inngest/functions/integrations/{accounting-backfill,accounting-consolidation,accounting-outbound-sweep,accounting-reconciliation}.ts`,
`packages/ee/src/accounting/providers/{rillet,xero,quickbooks-online}/entities/journal-entry.ts`
- [x] Remove the `settings.enabled` / `isJournalEntryPostingEnabled` skip guards:
      accounting-backfill.ts:212 + 218-219; accounting-consolidation.ts:173 + 736;
      accounting-outbound-sweep.ts:197; accounting-reconciliation.ts:754.
- [x] Remove the per-provider backstop `if (!settings.enabled) return "Posting sync is not enabled"`:
      Rillet journal-entry.ts:414, Xero journal-entry.ts:544, QBO journal-entry.ts:561.
- Verify: grep shows no remaining `settings.enabled` reads in the sync engine except the
      backward-compat schema field.

### Task 4 — Providers force `journalEntry` enabled (defense-in-depth)
Files: `packages/ee/src/accounting/providers/{xero,quickbooks-online,rillet}/provider.ts`
- [x] The `DEFAULT_SYNC_CONFIG` flip (Task 2) already makes it always-on. Additionally, in
      each `build*SyncConfig`, ensure `journalEntry` is forced `enabled:true` so a stale
      stored `enabled:false` can't turn it off (Rillet already forces direction/owner at
      provider.ts:292-297 — add `enabled:true` there; add journalEntry forcing to Xero
      129-135 / QBO 334-349 loops or a dedicated line).
- Verify: provider `build*SyncConfig` tests assert `journalEntry.enabled === true`.

### Task 5 — Tie-out / period-close readiness (stop auto-passing)
File: `apps/erp/app/modules/accounting/accounting.service.ts`
- [x] `getPeriodExternalGlSyncReadiness` (~2431-2444): gate on **presence of an active
      accounting integration**, not `settings.postingSync.enabled`. Return
      `postingSyncEnabled: true` whenever an active integration exists; auto-pass only when
      **no** integration is connected. Update the "Auto-pass when posting sync is off"
      comment (~2724).
- Verify: `pnpm exec turbo run typecheck --filter=@carbon/erp` (scoped) + read the readiness test if one exists.

### Task 6 — UI: remove the toggles that no longer exist
Files: `apps/erp/app/modules/settings/ui/Integrations/PostingSyncSettings.tsx`,
`apps/erp/app/modules/settings/settings.models.ts`,
`apps/erp/app/routes/x+/settings+/integrations.$id.tsx`
- [x] Remove the master enable `<BooleanField name="enabled">` (PostingSyncSettings.tsx:205-210)
      + its defaultValue (174).
- [x] Remove the per-source-type enable checkbox (255-262); keep the daily-summary control
      (271-287) but show it for all non-Manual journal types (decouple from `state.enabled`).
- [x] Exclude `Manual` from `journalRows` entirely (never render it).
- [x] Validator `postingSyncSettingsValidator` (settings.models.ts:508-525): drop `enabled`;
      `sourceTypeConfigs` carries granularity-per-non-Manual-type only.
- [x] Route action (integrations.$id.tsx): remove the dual-gate mirror block (1305-1340)
      and the `enabled` destructure (1240-1246); hard-exclude `Manual` in the sourceTypes
      build loop (1264-1273); the loader `policy` map (787-792) filters out `Manual`.
- Verify: scoped ERP typecheck; load the Posting tab in the browser — no master toggle, no
      per-type enable, no Manual row.

### Task 7 — Reversals / voids propagate (comprehensive requirement)
Files: reconcile core + provider entity syncers (investigate during execution)
- [ ] Confirm a voided/reversed automated posting propagates: (a) a reversal journal
      (`reversalOfId` set) pushes its reversing entry — the reconciler tracks `:reversal`
      twins; (b) a voided native document (ACCPAY bill / ACCREC invoice) voids/reverses the
      remote document, not just leaves it. Add coverage where missing.
- Verify: unit coverage for a reversal journal + a document void → remote void/reverse.

### Task 8 — Tests
Files: the tests the edit map flagged.
- [x] Rewrite the gating tests to the always-on model:
      `posting-policy.test.ts` (Manual→MANUAL_DISABLED always; drop SOURCE_TYPE_DISABLED for
      known types; add a `syncable` assertion + non-syncable-Manual);
      `posting.test.ts` / `journal-entry.test.ts` ("pushes Manual only when includeManual" →
      "never pushes Manual"; "defaults to disabled posting sync" → "always-on");
      `accounting-sync-operations.test.ts` `isJournalEntryPostingEnabled` (default true);
      `reconcile-golden.test.ts` (remove/repurpose the "posting sync disabled" scenario
      231-249; `journalEntryPushEnabled` stays true);
      provider `provider.test.ts` buildSyncConfig assertions (journalEntry.enabled true).
- [x] Add a golden case: PO → receipt (Purchase Receipt journal pushes) → bill (ACCPAY doc,
      PI journal DOC_BACKED) → GR/IR nets to zero; a Manual journal → excluded.
- Verify: `pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test`.

### Task 9 — (Recommended, separable) Lock AR/AP to native documents
Files: models.ts (`families`), posting.ts (`decideDocumentFamily`), PostingSyncSettings.tsx,
settings.models.ts, integrations.$id.tsx
- [ ] Remove the `none` and `journals` family options so the config can't express
      "don't sync AR/AP" or "AR/AP as manual journals". Force `families = documents`; delete
      the `familyAr`/`familyAp` selects, validator fields, and the divergent-family payment
      branch (posting.ts:207-226). Keep the read-only document-rows display.
- Rationale: "none" violates always-on; "journals" contradicts the chosen native-doc
  representation. Do NOT block Tasks 1-8 on this — documents is already the default, so the
  core fix is correct without it; this is foot-gun removal.

## Verification (whole change)
```bash
pnpm --filter @carbon/ee typecheck
pnpm --filter @carbon/jobs typecheck
pnpm exec turbo run typecheck --filter=@carbon/erp
pnpm --filter @carbon/ee test
pnpm --filter @carbon/jobs test
```
Then a live smoke test on the Carbon Xero company: post a receipt + bill with accounting on,
confirm GR/IR nets to zero in Xero and a Manual journal does not sync.

## Risks
- Stored-config parse break silently disables sync (posting.ts:56-63 swallows errors) — hence
  D2 keep-but-ignore rather than delete schema fields.
- `consolidation` derived field (models.ts:598-604) reads per-type `enabled` — retarget its
  filter to "journal-represented AND != Manual".
- Removing gates flips several tests green→red by design; Task 8 rewrites them to the new contract.
