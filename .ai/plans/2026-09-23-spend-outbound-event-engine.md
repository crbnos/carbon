# Spend outbound onto the event engine (spec slice 3)

**Spec:** `.ai/specs/2026-09-23-spend-management-push-only-mode.md` §10
**Research:** `.ai/research/spend-management-one-way-push.md`
**Depends on:** `.ai/plans/2026-09-23-provider-roles-topology.md` (slice 2) fully landed

> **Provisional.** Tasks 1–4 rest on the exact shape slice 2 gives `SyncProviderCapabilities`
> and `resolveCapabilities`. **Before starting, re-read
> `packages/ee/src/sync/capabilities.ts` and `packages/ee/src/sync/topology.ts` as they
> actually landed** and reconcile any drift with this plan before writing code. If the
> shape differs materially from the spec, STOP and re-plan rather than adapting task by
> task.

## Scope boundary

This slice moves **purchase orders and bills** onto the event engine. It does **not**
add item receipts (slice 4) and does **not** change any coding identifier (slice 5).
Inbound families stay on `ramp-sync` permanently — they key off the platform's own
`SYNC_READY` status and batched confirm protocol, with no Carbon row event to hang them
on. That outbound-events / inbound-sweep split is already how Xero, QuickBooks and
Rillet run (`accounting-pull-sweep`, cron `*/30`).

**This touches shipped, live-verified code.** PO push and draft-bill push were verified
live on 2026-09-11. Task 10 re-runs that verification and is not optional.

## Progress
- [ ] Task 1: Widen `SyncProviderID` and the `SyncFactory` registry key
- [ ] Task 2: Widen `SyncContext.provider` to a `SyncProvider` interface
- [ ] Task 3: Add `RampProvider` + `buildSpendSyncConfig`
- [ ] Task 4: Port the purchase-order push to a syncer
- [ ] Task 5: Port the draft-bill push to a syncer
- [ ] Task 6: Register the spend subscription set
- [ ] Task 7: Teach `event-handler-sync` to resolve a sync provider
- [ ] Task 8: Delete `ramp-sync-outbound.ts` and its cursors
- [ ] Task 9: Extend the subscription-mapping invariant test
- [ ] Task 10: Re-verify the live two-way integration

## Dependencies
- Task 2 needs Task 1. Task 3 needs Task 2.
- Tasks 4 and 5 both need Task 3; **they are independent of each other**.
- Task 6 needs Tasks 4 and 5. Task 7 needs Task 6. Task 8 needs Task 7.
- Tasks 9 and 10 need Task 8.

---

## Task 1: Widen `SyncProviderID` and the `SyncFactory` registry key

**Depends on:** none (after slice 2)
**Files:**
- Modify: `packages/ee/src/accounting/core/sync.ts` — the whole file is 56 lines
- Modify: `packages/ee/src/accounting/core/models.ts` — add `SpendProviderID`
- Copy from (precedent): `packages/ee/src/accounting/core/models.ts:14-19`
  (`enum ProviderID`)

**Steps:**
1. Add beside `ProviderID`:
   ```ts
   export enum SpendProviderID {
     RAMP = "ramp"
   }
   export type SyncProviderID = ProviderID | SpendProviderID;
   ```
2. In `sync.ts`, change `registries` and both `SyncFactory` methods from
   `Partial<Record<ProviderID, SyncerRegistry>>` to
   `Partial<Record<SyncProviderID, SyncerRegistry>>`. The error messages already
   interpolate `context.provider.id` — leave them.
3. Nothing else changes. `SyncFactory` is already the one provider-agnostic dispatch
   point; only its key type widens.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
pnpm --filter @carbon/ee test
# Expected: all pass, unchanged
```

**Out of scope:** registering anything under the new id.

---

## Task 2: Widen `SyncContext.provider` to a `SyncProvider` interface

**Depends on:** Task 1
**Files:**
- Modify: `packages/ee/src/accounting/core/types.ts` — `SyncContext` (line ~297),
  `BaseEntitySyncer`'s `protected provider` (line ~380)
- Copy from (precedent): `packages/ee/src/accounting/core/types.ts:183-210`
  (`BaseProvider` — the mandatory surface is already exactly what is needed)

**Steps:**
1. Export a structural interface carrying only `BaseProvider`'s mandatory surface:
   ```ts
   export interface SyncProvider {
     readonly id: SyncProviderID;
     readonly capabilities?: SyncProviderCapabilities;
     getSyncConfig<T extends SyncEntityType>(entity: T): GlobalSyncConfig["entities"][T];
     validate(auth: ProviderCredentials): Promise<boolean>;
   }
   ```
   `authenticate` is deliberately omitted — it has an `any[]` signature and no shared
   caller.
2. Change `SyncContext.provider` and `BaseEntitySyncer.provider` from
   `AccountingProvider` to `SyncProvider`.
3. Every concrete syncer already narrows for its API client (`this.rilletProvider`,
   `this.qboProvider`, `this.xeroProvider`). Fix the compile errors by making those
   narrowing getters cast from `SyncProvider`, exactly as they cast from
   `AccountingProvider` today — do not change their bodies.
4. `AccountingProvider` stays as the closed union for the places that genuinely need
   `instanceof` dispatch (`core/remote-journal.ts:110-157`). Do not touch that file.
5. Add `export type SyncEntityType = AccountingEntityType;` as an alias, and use it in
   new code. **Do not rename `AccountingEntityType`** — that is the naming debt the spec
   explicitly defers.
6. The union grew on this branch — it now carries `creditMemo`, `vendorCredit` and
   `reimbursement`, each with `ENTITY_DEFINITIONS`, `DEFAULT_SYNC_CONFIG` and provider
   syncers. Read it as it stands rather than trusting this plan's memory; when slice 4
   adds `itemReceipt`, three more providers' entity lists must decide about it, and the
   compile errors are the intended totality property.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: exit 0
pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test
# Expected: all pass with no assertion changes
```
**If a syncer needs a provider member not on `SyncProvider` and not reachable by
narrowing, STOP and report — do not widen `SyncProvider` to accommodate it.**

**Out of scope:** `remote-journal.ts`; renaming anything.

---

## Task 3: Add `RampProvider` + `buildSpendSyncConfig`

**Depends on:** Task 2
**Files:**
- Create: `packages/ee/src/ramp/lib/provider.ts`
- Create: `packages/ee/src/spend/sync-config.ts`
- Create: `packages/ee/src/spend/sync-config.test.ts`
- Copy from (precedent): `packages/ee/src/accounting/providers/rillet/provider.ts:293-331`
  (`buildRilletSyncConfig` — constrain-a-resolved-config, preserving `enabled`)

**Steps:**
1. `RampProvider implements SyncProvider`, holding a `RampClient` and the resolved
   metadata. `id = SpendProviderID.RAMP`. `capabilities` declares
   `role: "spend"`, `transport: "rest"`, `supportsWebhooks: true`,
   `ownsRemoteCodingSurface: true`, `ownsLedgerFamilies: []` — i.e. today's
   provider-mode behaviour. **Slice 4 makes these per-mode; this slice hard-codes the
   current behaviour so nothing changes.**
2. `buildSpendSyncConfig(modeCeiling, storedToggles)` returns a `GlobalSyncConfig`:
   start from `DEFAULT_SYNC_CONFIG`, force every entity `enabled: false` except those
   the spend provider actually syncs, then apply `min(ceiling, toggle)` per entity.
   In this slice the ceiling is "everything Ramp does today", so the result is driven
   purely by the existing `metadata.sync.pushPurchaseOrders` / `pushInvoices` flags.
3. Map the existing flags: `pushPurchaseOrders` → `entities.purchaseOrder`,
   `pushInvoices` → `entities.bill`. Direction is always `push-to-accounting`,
   owner `carbon`.
4. `getSyncConfig(entity)` returns `this.syncConfig.entities[entity]`, identical to the
   three accounting providers' one-liners.
5. Tests: a toggle off yields `enabled: false`; a ceiling of false beats a toggle of
   true; an unknown entity yields `enabled: false`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- sync-config
# Expected: all cases pass
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** modes (slice 4); anything reading `ownsLedgerFamilies`.

---

## Task 4: Port the purchase-order push to a syncer

**Depends on:** Task 3
**Files:**
- Create: `packages/ee/src/ramp/entities/purchase-order.ts`
- Create: `packages/ee/src/ramp/entities/index.ts` — `rampSyncerRegistry` +
  `SyncFactory.register(SpendProviderID.RAMP, rampSyncerRegistry)`
- Read (source of the logic being moved):
  `packages/jobs/src/inngest/functions/integrations/ramp-sync-outbound.ts` lines ~189-347
- Copy from (precedent): `packages/ee/src/accounting/providers/rillet/index.ts:38-58`
  (registry + `SyncFactory.register` in the barrel) and
  `packages/ee/src/accounting/providers/quickbooks-online/entities/purchase-order.ts`
  (a PO syncer's `BaseEntitySyncer` shape)

**Steps:**
1. Implement `RampPurchaseOrderSyncer extends BaseEntitySyncer`, moving the body of
   `pushPurchaseOrder` into `mapToRemote` / `upsertRemote`:
   - `shouldSync` — released POs push; Completed/Closed mapped POs archive; everything
     else returns a reason string.
   - `mapToRemote` — resolve the Ramp spend vendor via the existing
     `resolveOrCreateRampSpendVendor`, then build the create/PATCH payload with
     `external_id: po.id`, `currency`, `entity_id`, `three_way_match_enabled: false`,
     and line items with `external_id` + `unit_quantity`.
   - `upsertRemote` — create with the entity-scoped idempotency key when unmapped,
     PATCH when mapped.
2. Preserve **exactly**: the `external_id` (not `remote_id`) choice, the required
   `currency` + `entity_id` resolution from `metadata.entityId` or the business's first
   entity, and `three_way_match_enabled: false`. These were live-verified; changing any
   of them is out of scope.
3. The batch preload (`prepareRampPurchaseOrderBatch`) has no `BaseEntitySyncer`
   equivalent. Call it from `fetchLocalBatch` so a page still does one mapping read and
   at most one paginated vendor snapshot.
4. Archive-on-Completed/Closed has no `upsertRemote` shape. Implement it in
   `shouldSync`'s companion path the way the Rillet payment syncer handles voids
   (`providers/rillet/entities/payment.ts`) — **if that pattern does not fit, STOP and
   report rather than inventing a fourth lifecycle hook.**

**Verify:**
```bash
pnpm --filter @carbon/ee test -- ramp
# Expected: existing Ramp outbound tests pass after being repointed at the syncer
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** deleting the old code path (Task 8).

---

## Task 5: Port the draft-bill push to a syncer

**Depends on:** Task 3
**Files:**
- Create: `packages/ee/src/ramp/entities/bill.ts`
- Read (source): `ramp-sync-outbound.ts` lines ~354-470 and
  `packages/jobs/src/inngest/functions/integrations/ramp-sync-outbound-lines.ts`
- Copy from (precedent):
  `packages/ee/src/accounting/providers/rillet/entities/bill.ts:550-687`
  (`shouldSync` posted-only gate → `mapToRemote` with `ensureDependencySynced("vendor")`
  → `upsertRemote` with an idempotency key)

**Steps:**
1. Implement `RampBillSyncer extends BaseEntitySyncer`:
   - `shouldSync` — Open/Partially Paid invoices from non-Employee suppliers only; a
     mapped invoice returns a skip reason.
   - `mapToRemote` — resolve the spend vendor, read the posted "Purchase Invoice"
     journal via `loadBillCostingLines` + `toTransactionCurrencyLines`, convert base
     line totals back to document currency with `toDocumentAmount`, and build the
     per-line `accounting_field_selections` with the existing
     `buildLineCodingSelections`.
   - `upsertRemote` — `POST /bills/drafts` with `remote_id: invoice.id`. **Keep
     `remote_id` in this slice.** Dropping it is slice 5, and doing it here would break
     the inbound `ramp-bills` dedupe with no replacement in place.
2. Preserve exactly: never sending `enable_accounting_sync: false` alongside
   `remote_id` (Ramp 422s), the `UNMAPPED_ACCOUNTS` failure for an invoice with no
   posted journal, and the fail-soft degrade to uncoded for an unpushed account.
3. Employee-supplier exclusion moves into `shouldSync`, keeping the existing
   `supplierType.name === "Employee"` lookup.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- draft-bill
# Expected: the existing `ramp-sync-outbound-draft-bill.test.ts` assertions pass
# against the syncer after being repointed
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** `remote_id`, `accounting_vendor_remote_id`, identifier swapping.

---

## Task 6: Register the spend subscription set

**Depends on:** Tasks 4, 5
**Files:**
- Modify: `packages/ee/src/accounting/core/subscriptions.ts` — key
  `REQUIRED_SYNC_SUBSCRIPTIONS` on `SyncProviderID`; add the Ramp entry
- Copy from (precedent): the same file's `COMMON_PUSH_TABLES` and the
  `ensureProviderSubscriptions` converge loop (lines 37-120)

**Steps:**
1. Add:
   ```ts
   [SpendProviderID.RAMP]: [
     { table: "purchaseOrder", operations: ["INSERT", "UPDATE"] },
     { table: "purchaseInvoice", operations: ["INSERT", "UPDATE"] }
   ]
   ```
   No DELETE — the handler logs and skips it, and a spend platform's document lifecycle
   is not Carbon's to retract.
2. `ensureProviderSubscriptions(client, companyId, providerId)` needs no change beyond
   its parameter type. Call it from the Ramp install/update hooks, matching how the
   accounting hooks call it.
3. Both tables already carry `attach_event_trigger`
   (`20260119084845_event_system_register_triggers.sql:7` for `purchaseOrder`;
   `purchaseInvoice` is in `COMMON_PUSH_TABLES` already). **No migration in this slice.**

**Verify:**
```bash
pnpm --filter @carbon/ee test -- subscriptions
# Expected: passes, including the existing mapping invariant
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** `receipt` (slice 4).

---

## Task 7: Teach `event-handler-sync` to resolve a sync provider

**Depends on:** Task 6
**Files:**
- Modify: `packages/jobs/src/inngest/functions/events/sync.ts` — the
  `getAccountingIntegration(client, companyId, provider as ProviderID)` call at
  line ~138 and the second at ~226
- Modify: `packages/jobs/src/inngest/functions/integrations/reconcile.ts` — the
  `computeReconcileDecision` switch at lines 168-176

**Steps:**
1. Replace the accounting-specific resolution with a branch on
   `SpendProviderID` membership: a spend provider is built from
   `getRampIntegration` + the new `RampProvider`; an accounting provider keeps
   `getAccountingIntegration` + `getProviderIntegration`. Keep the `companyId:provider`
   grouping and both `step.run` boundaries untouched.
2. `reconcileDocument` already handles `bill` and `purchaseOrder`; confirm
   `purchaseOrder` routes there and not into `reconcileMasterData`. Its checks are
   `entityPushEnabled`, `hasLiveOperation` and the mapping/unchanged pair — the posting
   policy lives on the `journalEntry` path and is not reached for a spend push.
3. The ledger key is `(companyId, integration, entityType, entityId)`, so a Carbon
   purchase invoice can carry both a `rillet`/`bill` and a `ramp`/`bill` operation
   without collision — that is already how Ramp writes its mappings. Verify with a test
   rather than assuming.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- events/sync
# Expected: passes, plus a new test asserting a purchaseInvoice event with both a
# Rillet and a Ramp integration active enqueues two distinct operations
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** inbound families.

---

## Task 8: Delete `ramp-sync-outbound.ts` and its cursors

**Depends on:** Task 7
**Files:**
- Delete: `packages/jobs/src/inngest/functions/integrations/ramp-sync-outbound.ts`,
  `ramp-sync-outbound-lines.ts`, `ramp-sync-outbound-errors.test.ts`,
  `ramp-sync-outbound-prerequisites.test.ts`,
  `ramp-sync-outbound-draft-bill.test.ts` (after repointing their assertions in
  Tasks 4–5)
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts` — drop the
  `ramp-outbound` step
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-cursor.ts` —
  remove `decodeRampKeysetCursor` / `rampKeysetFilter` if nothing else uses them
- Modify: `packages/ee/src/ramp/lib/models.ts` and `lib/state.ts` — remove
  `cursors.purchaseOrderPushUpdatedAt` / `cursors.invoicePushUpdatedAt` from the schema
  and the owned-path list

**Steps:**
1. Remove the two cursor keys from `RampIntegrationMetadataSchema` and from
   `patchRampCursor`'s allowed paths. **Stored values on existing installs are left in
   place and ignored — do not write a migration to strip metadata.**
2. Keep `cursors.repaymentsRepaidAt` (repayments are inbound and stay).
3. Confirm `ramp-sync` still runs its inbound steps and the final
   `ramp-notify-failures` step.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- ramp-sync
# Expected: inbound family tests pass; no test references ramp-sync-outbound
grep -rn "ramp-sync-outbound\|purchaseOrderPushUpdatedAt\|invoicePushUpdatedAt" packages apps
# Expected: no matches outside .ai/
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** inbound cursors.

---

## Task 9: Extend the subscription-mapping invariant test

**Depends on:** Task 8
**Files:**
- Modify: `packages/jobs/src/inngest/functions/events/subscriptions-mapping.test.ts`

**Steps:**
1. Keep the existing assertion (every table in `REQUIRED_SYNC_SUBSCRIPTIONS` has a
   `TABLE_TO_ENTITY_MAP` entry).
2. Add: every such entity must have a **registered syncer** for that provider —
   assert against the `SyncFactory` registries by importing each provider barrel so
   registration runs.
3. Add a negative fixture proving the test fails for a provider with a subscribed table
   and no syncer.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- subscriptions-mapping
# Expected: passes, including the negative fixture
```

**Out of scope:** `searchableCounterparts` coverage (slice 1 owns that half).

---

## Task 10: Re-verify the live two-way integration

**Depends on:** Task 8
**Files:** none

**Steps:**
1. Run the gates below.
2. Against the Ramp sandbox with Carbon as the accounting provider (today's shipped
   configuration), re-run the 2026-09-11 verification recorded in
   `.ai/runs/2026-09-11-ramp-draft-bill-push-verification.md`:
   - release a purchase order → it appears in Ramp with `external_id` = the Carbon PO id;
   - post a purchase invoice → a coded DRAFT bill appears in Ramp with
     `remote_id` = the Carbon invoice id and its lines coded to the pushed accounts;
   - complete/close the PO → it archives in Ramp.
3. Confirm the push now happens within seconds of the row change rather than on the
   hourly sweep, by observing the ledger operation timestamp.
4. Write the results to `.ai/runs/{today}-ramp-event-outbound-verification.md`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp
# Expected: exit 0
pnpm run lint && pnpm run test
# Expected: all pass
```

**Out of scope:** push-only mode.
