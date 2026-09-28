# Spend outbound onto the event engine (spec slice 3)

**Spec:** `.ai/specs/implemented/2026-09-23-spend-management-push-only-mode.md` §10
**Research:** `.ai/research/spend-management-one-way-push.md`
**Depends on:** `.ai/plans/implemented/2026-09-23-provider-roles-topology.md` (slice 2) fully landed

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

## Outcome (2026-09-25)

Tasks 1–9 done, all gates green (ee + jobs + erp + checks typecheck, lint 37/37,
test 31/31). Task 10 is the only thing left and it is the one that matters — this
slice rewrote code that was live-verified on 2026-09-11.

Deviations from the plan, all deliberate:

- **No `raw`/fourth lifecycle hook was needed for PO archive.** `shouldSync` is
  async and can return a skip reason, so it refuses a settled PO that was never
  pushed; `mapToRemote` carries the archive intent to `upsertRemote`.
- **Task 5's status set was 2 in the plan, 3 in the code** (`Open`,
  `Partially Paid`, `Overdue`). The code won.
- **The bill syncer reads the `purchaseInvoices` VIEW, not the table.** The view
  DERIVES status — a fully settled invoice reads `Paid` there while the table
  still stores `Open`. Reading the table would have handed Ramp bills that were
  already paid. This was caught before it shipped, not after.
- **Task 7 step 2's assumption was wrong**: `purchaseOrder` routes to
  `reconcileMasterData`, not `reconcileDocument`. That is the same path Xero and
  QBO's PO push already take, so it was left alone.
- **The keyset cursor module was deleted entirely** — all four helpers were
  orphaned once the sweep went, not just the two the plan named.
- **Subscription convergence runs in three places**, matching the accounting
  providers: install hook, settings save, and a new `ramp-subscriptions` step in
  `ramp-sync` so existing installs self-heal.
- **`resolveSyncProvider`** (`jobs/.../integrations/sync-provider.ts`) is the one
  place that branches accounting vs spend; the event handler and drain call it.
  `@carbon/ee/ramp/entities` is side-effect-imported there so `SyncFactory`
  registration runs.

## Live verification (2026-09-25, Ramp SANDBOX, company `daphdosqs0g046qdc4ig`)

**Purchase orders: fully verified.** A Carbon write fired the event, which flowed
subscription → `event-handler-sync` → `resolveSyncProvider` → `RampProvider` →
`SyncFactory` → `RampPurchaseOrderSyncer` → live Ramp API, in ~10 seconds:

- **Create** — Ramp PO `01a0d96d-43cf-77e6-be12-a1f817330dda`, ledger op `Completed`,
  `externalIntegrationMapping` row written.
- **Re-push** — same remote id returned, still exactly ONE mapping. No duplicate.
- **Archive on Completed** — `Completed`, remote id preserved.

**Two real bugs this caught, both now fixed:**

1. **Dropped base-currency fallback.** The old sweep built its push payload with
   `currencyCode ?? ctx.baseCurrency`; the port used `purchaseOrder.currencyCode`
   directly, which is NULL for an order raised in the company's own currency. Ramp
   REQUIRES `currency` on create, so every base-currency PO would have failed. The
   syncer now reads `company.baseCurrencyCode` as the fallback.
2. **`archivePurchaseOrder` sent no JSON body** — Ramp answers
   `400 DEVELOPER_7011 "The request does not contain a JSON body"`. This is
   PRE-EXISTING (`lib/client.ts`, untouched by this slice): the archive path was
   simply never exercised from the old cursor sweep, so it had never surfaced.
   Now sends `{}` and archives successfully.

A third omission was caught before testing: `RampPurchaseOrderLocal` had no
`updatedAt`, so `BaseEntitySyncer`'s unchanged-since-last-sync bailout compared
against `undefined` and every event would have re-PATCHed Ramp.

**Bills: fully verified.** AP000001 was posted through the UI (creating its
"Purchase Invoice" journal and flipping it to payable), which fired the event:

- **Create** — Ramp draft bill `ba14e6fb-b8d0-4b2c-ba0d-f066e116b05d`, op `Completed`,
  mapping written. The Ramp spend vendor was created on the way
  (`28982db6-69d0-4c71-ba38-3e6b7e1c8759`).
- **Re-push** — same remote id, still exactly ONE mapping. No duplicate, which matters
  more here than for POs: a Ramp draft has no delete endpoint, so a duplicate would be
  unfixable.

Setup the dev data needed, in case it is repeated: `companySettings.accountingEnabled`
must be on (it was); the invoice's supplier needs `purchasingContactId` set to a contact
carrying an email (it was unset — the contact and its email already existed) and a
location with a country (and a state, for US); then Post the invoice.

Incidentally confirms the view-vs-table fix is load-bearing: after posting, the TABLE
reads `Open` while the VIEW reads `Overdue`.

**Two more real bugs this caught:**

3. **Dates were sent as JS `Date`s.** `dateIssued`/`dateDue` are `date` columns, and
   Kysely's pg driver decodes those to JS `Date`s, which JSON-serialize as full
   timestamps — Ramp answers `422 DEVELOPER_7001 "Not a valid date"`. The old push read
   them through PostgREST, which already returned strings, so THE PORT INTRODUCED THIS.
   Now normalized through the existing `toPostingDateString`. Every draft-bill push
   would have failed.
4. **`resolveOrCreateRampSpendVendor` swallowed Ramp's rejection** (`console.error` +
   return null), so the bill failed with a generic "supplier has no Ramp spend vendor"
   and the actual cause reached only a server console — which is how bug 3 stayed
   invisible for three attempts. Swallowing is correct for a PO (its `vendor_id` is
   optional, so the PO still pushes); a bill cannot push without one. Added
   `surfaceCreateError`, which the bill syncer passes.

**Gap this surfaced (pre-existing, not introduced):** a PO that exists in Ramp but has
no Carbon mapping fails FOREVER with `400 DEVELOPER_7063 "Purchase order number
already exists"`. PO000001–4 are in this state on the sandbox (an earlier push, then
the local DB was reseeded). The old sweep had the identical hole. The fix is the same
doctrine as slice 1's counterpart ladder — look the PO up by `external_id` before
creating — and is NOT in this slice.

**Environment note:** PO000003 was finalized (Draft → To Receive and Invoice) through
the UI during this test and left that way; finalize is not reversible from the UI.

## Follow-up: extracted the provider-neutral half (2026-09-25)

Tasks 4/5 were written Ramp-first. Measured afterwards: **870 lines across the
three Ramp entity files, of which only ~38 touched the Ramp wire** — so ~80% would
have been duplicated verbatim by a second spend platform. The accounting side had
already solved this (`document-costing.ts`, `sales-invoice-source.ts`,
`card-charge-source.ts` each feed three adapters); the spend side simply had not
followed the house pattern.

Extracted to `packages/ee/src/spend/`, no behaviour change:

| Module | What it owns |
|---|---|
| `push-only-syncer.ts` | `SpendPushOnlyEntitySyncer` — pull rejections + the sequential batch |
| `parties.ts` | supplier / purchasing contact / address, incl. "prefer an address with a country" |
| `purchase-order-source.ts` | PO + lines + base-currency fallback + `supplierUnitPrice` |
| `bill-source.ts` | the `purchaseInvoices` VIEW read, employee exclusion, costed lines, pushed-coding sets |
| `gates.ts` | which documents are eligible |

Result: Ramp 870 → **413 lines**; shared core 669. `ramp/entities/shared.ts` is down
to 33 lines — just the API-client accessor.

**Deliberately NOT extracted: capability axes.** `archivesSettledPurchaseOrders`,
`billLifecycle: "create-once"`, `requiresVendorOn` are tempting flags, but inventing
them from ONE implementation encodes Ramp's shape under a generic name. They stay as
documented rules inside the adapter (the draft bill is create-once BECAUSE a Ramp
draft has no delete endpoint) until a second provider can falsify them. The loader
extraction needs no such justification — those functions are Carbon-side whether or
not a second platform ever exists.

**Re-verified live after the refactor:** bill push `Completed` with the same remote id
`ba14e6fb…` and still exactly one mapping; PO push still fails with the known
pre-existing `DEVELOPER_7063`. Identical to pre-refactor. Plus `spend/gates.test.ts`
(new), full suite 31/31, lint 37/37.

Downstream plans updated: slice 4 Task 7 (item receipts) now specifies
`spend/item-receipt-source.ts` + a wire-only `ramp/entities/item-receipt.ts`; slice 5
notes the two Ramp files are wire adapters; the spec's file-layout section describes
both halves.

## Progress
- [x] Task 1: Widen `SyncProviderID` and the `SyncFactory` registry key
- [x] Task 2: Widen `SyncContext.provider` to a `SyncProvider` interface
- [x] Task 3: Add `RampProvider` + `buildSpendSyncConfig`
- [x] Task 4: Port the purchase-order push to a syncer
- [x] Task 5: Port the draft-bill push to a syncer
- [x] Task 6: Register the spend subscription set
- [x] Task 7: Teach `event-handler-sync` to resolve a sync provider
- [x] Task 8: Delete `ramp-sync-outbound.ts` and its cursors
- [x] Task 9: Extend the subscription-mapping invariant test
- [x] Task 10: Re-verify the live two-way integration — BOTH paths verified live 2026-09-25

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
