# Memo External-GL Representation — implementation plan

**Spec:** `.ai/specs/2026-09-23-memo-external-gl-representation.md`
**Research:** `.ai/research/2026-09-22-sap-grade-ap-ar-document-model.md` + the Xero/QBO/Rillet
API surveys and Rillet sandbox probe recorded in the spec.
**Branch:** `rillet-ramp-accounting-provider` — stacks on the charge rename commit (`92a6e812e7`), which is a prerequisite and lives on this branch.

> **Prerequisite:** the in-flight `card-transaction → charge` rename must land first. This plan
> assumes `Charge` / `chargeLine` / `post-charge` are the current names. If `POSTING_POLICY`
> still says `"Card Transaction"` when you start, STOP and report — do not rename it here.

> **After EVERY turbo command in this plan**, run `git status` and revert any unintended
> changes under `packages/database/` (`src/types.ts`, `src/swagger-docs-schema.ts`,
> `supabase/functions/lib/types.ts`). Turbo rebuilds `@carbon/database` and regenerates those
> files as ride-along churn (`.ai/lessons.md` — "Turbo typecheck/test runs can regenerate
> `@carbon/database` artifacts"). This plan contains **no migration**, so those files should
> never legitimately change.

## Progress
- [x] Task 1: Add `creditMemo` / `vendorCredit` posting-sync families
- [x] Task 2: Add `creditMemo` / `vendorCredit` accounting entity types
- [x] Task 3: Per-party policy resolution + the family-misclassification fix
- [x] Task 4: Resolve a memo journal's party at the call site
- [x] Task 5: Shared credit-reason-item resolver
- [x] Task 6: Xero client — credit notes + allocations
- [x] Task 7: Xero syncers — credit memo + vendor credit
- [x] Task 8: QBO client — CreditMemo, VendorCredit, Service item, applications
- [x] Task 9: QBO syncers — credit memo + vendor credit
- [x] Task 10: Rillet client — credit memos, vendor credits, products, applications
- [x] Task 11: Rillet syncers — credit memo + vendor credit
- [ ] Task 12: Event subscriptions + party-resolved table mapping
- [ ] Task 13: Outbound sweep picks up posted memos
- [ ] Task 14: Posting-sync settings UI — two family selectors
- [ ] Task 15: Rillet sandbox end-to-end verification
- [ ] Task 16: Browser verification of the settings UI

## Dependencies

- Tasks 1 → 2 → 3 → 4 are strictly sequential (each builds on the previous type/shape).
- Task 5 depends on Task 2 (needs the `creditReasonItem` mapping entity type convention).
- **Tasks 6+7 (Xero), 8+9 (QBO), 10+11 (Rillet) are three independent streams** once Tasks 1–5
  are done — `/execute` may run them as parallel subagents. Within a stream, client before syncer.
- Tasks 12, 13, 14 depend on Task 2 only; they may run in parallel with the provider streams.
- Tasks 15, 16 are last and depend on everything.

---

## Task 1: Add `creditMemo` / `vendorCredit` posting-sync families

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/accounting/core/models.ts` — extend `PostingSyncStoredSchema.families`

**Steps:**
1. In `PostingSyncStoredSchema`, extend the `families` object to exactly:
```ts
families: z
  .object({
    ar: PostingSyncFamilyModeSchema.default("documents"),
    ap: PostingSyncFamilyModeSchema.default("documents"),
    creditMemo: PostingSyncFamilyModeSchema.default("none"),
    vendorCredit: PostingSyncFamilyModeSchema.default("none")
  })
  .default({ ar: "documents", ap: "documents", creditMemo: "none", vendorCredit: "none" })
```
2. Do NOT change the `ar`/`ap` defaults. The two new keys default to `"none"` deliberately —
   a never-synced family has no correct backlog (spec, "Rollout default").

**Verify:**
```bash
pnpm --filter @carbon/ee test -- posting
# Expected: all existing posting/policy tests still pass (0 failures). A stored
# fragment without the new keys must resolve them to "none".
```

**Out of scope:** `PROVIDER_MEMO_REPRESENTATION` (dropped from the design — every provider uses
documents); any change to `ar`/`ap` behaviour.

---

## Task 2: Add `creditMemo` / `vendorCredit` accounting entity types

**Depends on:** Task 1
**Files:**
- Modify: `packages/ee/src/accounting/core/models.ts` — `AccountingEntityType`, `ENTITY_DEFINITIONS`, `SyncConfigSchema`, `DEFAULT_SYNC_CONFIG`
- Modify: `packages/ee/src/accounting/providers/rillet/provider.ts` — `RILLET_PUSH_ONLY_ENTITIES`
- Modify: `packages/ee/src/accounting/providers/xero/provider.ts` — `XERO_CARBON_OWNED_ENTITIES`
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/provider.ts` — `QBO_CARBON_OWNED_ENTITIES`
- Copy from (precedent): the existing `charge` entity entries in the same files

**Steps:**
1. Add `"creditMemo"` and `"vendorCredit"` to `AccountingEntityType`.
2. Add `ENTITY_DEFINITIONS` entries mirroring the `charge` entry's shape:
   - `creditMemo`: `label: "Credit Memos"`, `dependsOn: ['customer','invoice']`
   - `vendorCredit`: `label: "Vendor Credits"`, `dependsOn: ['vendor','bill']`
   - both: `supportedDirections: ["push-to-accounting"]`
3. Add both to `SyncConfigSchema.entities` and `DEFAULT_SYNC_CONFIG.entities` with
   `{ enabled: false, direction: "push-to-accounting", owner: "carbon" }`.
4. Add both to all three providers' carbon-owned / push-only entity lists.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: 0 errors. Any exhaustive switch over AccountingEntityType that now
# lacks a case will fail here — fix those cases, do not cast.
git status --short packages/database/   # Expected: empty
```

**Out of scope:** writing syncers (Tasks 7/9/11). Registering a syncer before it exists will
fail `subscriptions-mapping.test.ts` — that test is updated in Task 12.

---

## Task 3: Per-party policy resolution + the family-misclassification fix

**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/accounting/core/models.ts` — the two `POSTING_POLICY` rows
- Modify: `packages/ee/src/accounting/core/posting.ts` — `PostingSyncDocumentSyncFlags`, `getJournalPostingPolicyDecision`, `decideDocumentFamily`
- Modify: `packages/ee/src/accounting/core/posting-policy.test.ts` — add the four-combo tests
- Copy from (precedent): the `family: "per-line"` handling for `Payment` at `posting.ts:299`

**Steps:**
1. In `POSTING_POLICY`, change `"Credit Memo"` and `"Debit Memo"` to:
   `representation: "document"`, `family: "per-party"`, `backingEntityType: "per-party"`,
   `defaultEnabled: false`, `defaultGranularity: "individual"`. Both rows are identical —
   the party, not the direction, decides the family.
2. Extend `PostingSyncDocumentSyncFlags` with `creditMemoEnabled: boolean` and
   `vendorCreditEnabled: boolean`.
3. Add `memoParty?: "customer" | "supplier" | null` to `getJournalPostingPolicyDecision`'s
   args, mirroring the existing `paymentFamily` arg.
4. Resolve the family the same way `per-line` is resolved at `posting.ts:299`:
   `policy.family === "per-party"` → `memoParty === "customer" ? "creditMemo" : memoParty === "supplier" ? "vendorCredit" : null`.
   Resolve `backingEntityType` in parallel to `"creditMemo"` / `"vendorCredit"`, and read the
   matching `docSync` flag in `decideDocumentFamily`.
5. When `memoParty` is null for a memo source type, return a `warn` decision naming the memo —
   never silently pick a family.
6. Add tests to `posting-policy.test.ts` covering **all four combos**, asserting the family:
   customer+Credit → `creditMemo`; customer+Debit → `creditMemo`; supplier+Debit →
   `vendorCredit`; supplier+Credit → `vendorCredit`. **The last two are the bug** — before this
   change they resolved to `ar`/`ap` by direction.
7. Add a test asserting `ap: "none"` + `vendorCredit: "documents"` still pushes a supplier memo
   (families are decoupled from the invoice/bill gate).

**Verify:**
```bash
pnpm --filter @carbon/ee test -- posting-policy
# Expected: the four combo tests pass; specifically a supplier+Credit memo resolves
# to vendorCredit (NOT the "ar" family) and a customer+Debit memo to creditMemo.
```

**Out of scope:** the `Purchase Return` / `Sales Return` policy rows — leave them in place,
only add a comment marking them superseded by the memo path (removing a Postgres enum value
requires recreating the type).

---

## Task 4: Resolve a memo journal's party at the call site

**Depends on:** Task 3
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/accounting-sync-operations.ts` — add the resolver + pass `memoParty` and the two new `docSync` flags
- Modify: `packages/jobs/src/inngest/functions/integrations/reconcile-executor.ts` — resolve `memoParty` for memo-source journal snapshots, mirroring its existing `paymentFamily` block (~line 352)
- Copy from (precedent): `resolvePaymentJournalFamily` and `loadChargePolicyInputs`, used at lines ~432 and ~443 of the same file

> **Plan amendment (2026-09-23, during execution):** `reconcile-executor.ts` was
> missing from this task. It resolves `paymentFamily` for journalEntry snapshots and
> feeds the same policy decision, so without the parallel `memoParty` resolution every
> memo journal reaching the policy through the reconcile/sweep path would park
> `MEMO_PARTY_UNRESOLVED`. Same decision, second call site — no design change.

**Steps:**
1. Add `resolveMemoJournalParty(client, { companyId, journalId })` returning
   `"customer" | "supplier" | null`: read the `memo` row whose `journalId` matches, scoped by
   `companyId`; return `"customer"` when `customerId` is set, `"supplier"` when `supplierId`
   is set, else `null`. Follow `resolvePaymentJournalFamily`'s shape exactly.
2. In the planning function, mirror the `paymentFamily` block:
```ts
const memoParty =
  sourceType === "Credit Memo" || sourceType === "Debit Memo"
    ? await resolveMemoJournalParty(args.client, {
        companyId: args.companyId,
        journalId: args.event.recordId
      })
    : null;
```
3. Extend the `docSync` object passed to `planJournalPostingFromState` with
   `creditMemoEnabled: syncConfig.entities.creditMemo.enabled` and
   `vendorCreditEnabled: syncConfig.entities.vendorCredit.enabled`, and pass `memoParty`.
4. In `reconcile-executor.ts`, mirror the `paymentFamily` block: for a journalEntry
   snapshot whose `sourceType` is `"Credit Memo"` or `"Debit Memo"`, call
   `resolveMemoJournalParty` and put the result on the reconcile input; extend the
   `docSync` flags there the same way.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: 0 errors.
git status --short packages/database/   # Expected: empty
```

**Out of scope:** the reconcile/sweep path (Task 13).

**Escape hatch:** if `memo` has no `journalId` column linking it to its posted journal, STOP and
report — the resolver's join is the whole mechanism and must not be improvised.

---

## Task 5: Shared credit-reason-item resolver

**Depends on:** Task 2
**Files:**
- Create: `packages/ee/src/accounting/core/credit-reason-item.ts`
- Create: `packages/ee/src/accounting/core/__tests__/credit-reason-item.test.ts`
- Copy from (precedent): `packages/ee/src/accounting/core/external-mapping.ts` (mapping service usage) and `packages/ee/src/ramp/lib/chart-of-accounts.ts` (provider-side object keyed by `account.id`)

**Steps:**
1. Export `resolveCreditReasonItem({ mapping, providerId, companyId, accountId, createItem })`:
   - Look up `externalIntegrationMapping` for `entityType: "creditReasonItem"`, `accountId`.
   - On hit, return the mapped provider id. **Never query the provider to find it** — Rillet's
     `GET /products` cannot filter on `external_references`.
   - On miss, call the injected `createItem(accountId)` callback, write the mapping, return the
     new id.
2. The resolver is **provider-agnostic**; each provider injects `createItem`. It must NOT
   create any Carbon `item` row — this is a provider-side artifact only (spec, Design Decisions).
3. Unit-test: (a) mapping hit returns the mapped id and calls `createItem` zero times;
   (b) miss calls `createItem` once and writes the mapping; (c) a second call after a miss
   reuses the mapping (no duplicate creation).

**Verify:**
```bash
pnpm --filter @carbon/ee test -- credit-reason-item
# Expected: 3 tests pass, including the reuse case asserting createItem is called exactly once
# across two resolutions of the same accountId.
```

**Out of scope:** Xero (it codes lines by `AccountCode` directly and never needs an item).

---

## Task 6: Xero client — credit notes + allocations

**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/accounting/providers/xero/provider.ts`
- Copy from (precedent): the existing invoice/bill create methods in the same file

**Steps:**
1. Add `createCreditNote(payload)` → `POST /CreditNotes`. Create directly with
   `Status: "AUTHORISED"` — a credit note **must** be AUTHORISED to be allocatable.
2. Add `allocateCreditNote(creditNoteId, allocation)` → **`PUT`**
   `/CreditNotes/{id}/Allocations`. Allocation is **additive** (not a reconcile). Send `Date`
   even though the docs call it read-only (the OpenAPI spec marks it required).
3. Add `deleteCreditNoteAllocation(creditNoteId, allocationId)` → `DELETE .../Allocations/{id}`.
4. `Contact` must carry **`ContactID` only** — sending other contact fields mutates the contact
   record and deletes its `ContactPersons`.
5. Use `CreditNoteNumber` (not `Reference`) to carry the Carbon memo id: `ACCPAYCREDIT` has no
   `Reference` field.
6. Send the `Idempotency-Key` header, but do **not** treat it as durable dedupe — it expires
   after 6 minutes; the `externalIntegrationMapping` row remains job-level idempotency.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: 0 errors.
```

**Out of scope:** creating and allocating in one call — Xero explicitly forbids it; these are
always two round-trips.

---

## Task 7: Xero syncers — credit memo + vendor credit

**Depends on:** Tasks 3, 6
**Files:**
- Create: `packages/ee/src/accounting/providers/xero/entities/credit-memo.ts`
- Create: `packages/ee/src/accounting/providers/xero/entities/vendor-credit.ts`
- Create: `packages/ee/src/accounting/providers/xero/entities/__tests__/credit-memo.test.ts`
- Modify: `packages/ee/src/accounting/providers/xero/index.ts` — register both with `SyncFactory`
- Copy from (precedent): `packages/ee/src/accounting/providers/xero/entities/bill.ts`

**Steps:**
1. Both extend `BaseEntitySyncer`. `shouldSync` asserts its own party (credit-memo →
   `customerId` set; vendor-credit → `supplierId` set) and skips otherwise.
2. `mapToRemote` builds one line from the memo: `AccountCode` = the mapped reason account's
   Xero code, `Quantity: 1`, `UnitAmount` = the memo amount. **No `ItemCode`** — an
   AccountCode-only line is Xero's own canonical example.
3. `Type` is `ACCRECCREDIT` (credit-memo) or `ACCPAYCREDIT` (vendor-credit).
4. After create, push `invoiceSettlement` applications via `allocateCreditNote`, one call per
   application. Mirror `payment`'s constraints: single settlement pushes; multi-settlement and
   cross-currency **park with a reason** rather than guessing.
5. **Increasers are not supported in v1.** `shouldSync` must return a skip *with a reason*
   ("balance-increasing memos are not supported in v1") for customer+Debit and supplier+Credit
   memos, so the operation closes `Skipped` with the reason in `errorMessage` — never a silent
   drop and never a malformed push. (Truthful-ledger rule: a skip WITHOUT a remoteId closes
   `Skipped`, not `Completed`.)
6. Test: a supplier memo of 250 produces an `ACCPAYCREDIT` body with one `AccountCode` line,
   `Quantity: 1`, `Status: "AUTHORISED"`, and `Contact` containing only `ContactID`.
7. Test (canonical, covers all three providers' rule): a supplier+**Credit** memo and a
   customer+**Debit** memo each return a skip whose reason names the v1 limitation.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- xero
# Expected: the new credit-memo tests pass and existing xero tests still pass.
```

**Out of scope:** the credit-reason-item resolver — Xero does not use it.

---

## Task 8: QBO client — CreditMemo, VendorCredit, Service item, applications

**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/provider.ts`
- Copy from (precedent): the existing bill/invoice create methods in the same file

**Steps:**
1. `createVendorCredit(payload)` → `POST /vendorcredit`, line
   `DetailType: "AccountBasedExpenseLineDetail"` with `AccountBasedExpenseLineDetail.AccountRef`.
   Set `APAccountRef` explicitly (Intuit recommends it to avoid errors when relating
   transactions).
2. `createCreditMemo(payload)` → `POST /creditmemo`, line
   `DetailType: "SalesItemLineDetail"` with `SalesItemLineDetail.ItemRef`.
   **A line without an ItemRef has its `Amount` silently ignored** — never emit one.
3. `createServiceItem({ name, incomeAccountRef })` → `POST /item` with `Type: "Service"`.
   This is the `createItem` callback for Task 5's resolver on QBO.
4. `applyCreditMemo` → `POST /payment` with two `Line` entries linking the Invoice and the
   CreditMemo via `LinkedTxn`. `applyVendorCredit` → `POST /billpayment` likewise;
   `BillPayment` requires `PayType` **and a bank account even for a zero-cash application** —
   resolve it from the company's configured AP bank account and fail with a clear reason if unset.
5. All calls send `?requestid=<≤50 chars>` and `?minorversion=75`.
6. `ExchangeRate` is **home-per-foreign — the inverse of Carbon's convention**
   (`.claude/rules/numeric-precision.md`). Invert at this boundary.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: 0 errors.
```

**Out of scope:** reading/reacting to the `AutoApplyCredit` preference (surfaced as a risk in
the spec, not implemented here).

---

## Task 9: QBO syncers — credit memo + vendor credit

**Depends on:** Tasks 3, 5, 8
**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/credit-memo.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/vendor-credit.ts`
- Create: `.../entities/__tests__/credit-memo.test.ts`
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/index.ts` — register both
- Copy from (precedent): `packages/ee/src/accounting/providers/quickbooks-online/entities/bill.ts`

**Steps:**
1. `vendor-credit.ts`: account-coded line via `AccountRef` — no item resolver needed.
2. `credit-memo.ts`: call `resolveCreditReasonItem` (Task 5) with `createItem` =
   `createServiceItem({ name: "<reason account name> (Carbon)", incomeAccountRef })`, then emit
   a `SalesItemLineDetail` line referencing the returned item id.
3. Push applications after create (`applyCreditMemo` / `applyVendorCredit`).
4. `shouldSync` skips increasers with the same reason string as Task 7 step 5.
5. Test: a customer memo resolves/creates exactly one Service item and emits a `CreditMemo`
   line whose `SalesItemLineDetail.ItemRef` is that item and whose `Amount` is non-zero; a
   second memo on the same reason account creates **no** second item.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- quickbooks
# Expected: new credit-memo tests pass, including the item-reuse assertion.
```

**Out of scope:** any Carbon `item` row creation — the Service item is provider-side only.

---

## Task 10: Rillet client — credit memos, vendor credits, products, applications

**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/accounting/providers/rillet/provider.ts`
- Modify: `packages/ee/src/accounting/providers/rillet/models.ts` — request/response schemas
- Copy from (precedent): the existing `createBill` / `createReimbursement` methods in the same file

**Steps:**
1. `createVendorCredit` → `POST /vendor-credits`, `line_items[]` of
   `{ account_code, amount, description?, tax_rate?, fields? }`.
2. `createCreditMemo` → `POST /credit-memos`, `items[]` of
   `{ description, price: { product_id, quantity: 1, amount_per_unit }, revenue?, tax_rate?, fields? }`.
   Also set `revenue.account_code` to the reason account (a documented per-line GL override) in
   addition to using a reason-bound product — belt and braces.
3. `createProduct` → `POST /products`; `ProductRequest.account_code` is **required**, so the
   product is the GL binding. Use `ONE_TIME` price and `include_in_arr_mrr: false`. This is the
   `createItem` callback for Task 5 on Rillet.
4. `applyCreditMemo` → `POST /credit-memos/{id}/applications` — **full reconcile**: always send
   the COMPLETE desired application set; omitted entries are deleted.
5. `applyVendorCredit` → `POST /vendor-credits/{id}/applications`, `{bill_id, amount}` —
   **no `application_date`** on this side.
6. `fields` (dimensions) are `{field_id, field_value_id}` **UUID pairs** from `GET /fields`.
7. Keep the existing entity-scoped `buildRilletIdempotencyKey({companyId, operation, localId})`
   convention — the payload is deliberately not hashed.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- rillet
# Expected: existing rillet tests still pass; new client methods typecheck.
```

**Out of scope:** journal entries for memos — a sandbox probe proved Rillet **silently drops**
`related_entity`, so the journal path is not used. Do not add it as a fallback.

---

## Task 11: Rillet syncers — credit memo + vendor credit

**Depends on:** Tasks 3, 5, 10
**Files:**
- Create: `packages/ee/src/accounting/providers/rillet/entities/credit-memo.ts`
- Create: `packages/ee/src/accounting/providers/rillet/entities/vendor-credit.ts`
- Create: `.../entities/__tests__/credit-memo.test.ts`
- Modify: `packages/ee/src/accounting/providers/rillet/index.ts` — register both
- Copy from (precedent): `packages/ee/src/accounting/providers/rillet/entities/bill.ts`

**Steps:**
1. `vendor-credit.ts`: one `line_items[]` entry with `account_code` = the mapped reason account.
2. `credit-memo.ts`: resolve the reason product via Task 5, emit one `items[]` entry with
   `quantity: 1` and `amount_per_unit` = the memo amount.
3. Push applications after create, honouring the AR full-reconcile rule.
4. `shouldSync` skips increasers with the same reason string as Task 7 step 5.
5. Test: two applications on one credit memo produce a **single** applications POST containing
   **both** entries (proving full-reconcile semantics are respected, not an additive call).

**Verify:**
```bash
pnpm --filter @carbon/ee test -- rillet
# Expected: new credit-memo tests pass, including the two-application reconcile assertion.
```

**Out of scope:** increaser combos (supplier+Credit, customer+Debit) — deferred from v1; they
must park with an explicit reason, never push a malformed document.

---

## Task 12: Event subscriptions + party-resolved table mapping

**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/accounting/core/subscriptions.ts` — add `memo` to `REQUIRED_SYNC_SUBSCRIPTIONS` for all three providers
- Modify: `packages/jobs/src/inngest/functions/events/sync-tables.ts` — party-resolved `memo` mapping
- Modify: `packages/jobs/src/inngest/functions/events/subscriptions-mapping.test.ts`

**Steps:**
1. Add `{ table: "memo", operations: ["INSERT", "UPDATE"] }` to each provider's required set.
2. `TABLE_TO_ENTITY_MAP` maps a table to exactly ONE entity type, but `memo` serves two. Change
   the `memo` entry to resolve per row by party: customer → `creditMemo`, supplier →
   `vendorCredit`. Keep the map import-light (no Inngest/env boot) so the invariant test can
   still import it.
3. Update `subscriptions-mapping.test.ts` to accept a party-resolved mapping and to assert that
   **both** entity types are subscribed, mapped and registered for every provider.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- subscriptions-mapping
# Expected: passes with both creditMemo and vendorCredit mapped and registered for
# xero, quickbooks-online and rillet.
```

**Out of scope:** adding a `memo` DELETE subscription — a deleted memo reconciles to nothing,
matching the `journal` precedent.

---

## Task 13: Outbound sweep picks up posted memos

**Depends on:** Task 2
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/accounting-outbound-sweep.ts`
- Copy from (precedent): the existing posted-payments candidate query in the same file

**Steps:**
1. Add posted `memo` rows to the candidate refs, honouring the sweep floor
   (`getSweepFloorDate`, `SWEEP_LOOKBACK_DAYS = 7`) raised by each family's `syncFromDate`.
2. Emit each candidate as `creditMemo` or `vendorCredit` by party, matching Task 12's mapping.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: 0 errors.
git status --short packages/database/   # Expected: empty
```

**Out of scope:** backfilling history — the families default to `none` and history requires the
explicit backfill job.

---

## Task 14: Posting-sync settings UI — two family selectors

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/settings/ui/Integrations/PostingSyncSettings.tsx`
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — extend `postingSyncSettingsValidator`
- Copy from (precedent): the existing AR/AP family selectors in `PostingSyncSettings.tsx`

**Steps:**
1. Add two selectors, "Credit Memos" and "Vendor Credits", each `documents | journals | none`,
   defaulting to `none`, cloned from the existing AR/AP selectors.
2. Helper copy under each: enabling pushes credits **from the enable date forward**; history
   requires an explicit backfill.
3. Extend `postingSyncSettingsValidator` with the two keys.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm run lint
# Expected: 0 errors.
git status --short packages/database/   # Expected: empty
```

**Out of scope:** the memo authoring UI (`ui/Memo/`, `x+/credits+/`) — allocation UX is a
separate spec.

---

## Task 15: Rillet sandbox end-to-end verification

**Depends on:** Tasks 1–14
**Files:** none (verification only)

**Steps:**
1. With a Rillet sandbox connected and `vendorCredit: "documents"`, post a supplier+Debit memo
   for 100 against a mapped reason account. Confirm one `POST /vendor-credits` whose single line
   carries `account_code` = the mapped account and `amount` = 100, and that the operation closes
   `Completed` with the Rillet id in `externalId`.
2. Apply it to one open bill; confirm `POST /vendor-credits/{id}/applications` with
   `{bill_id, amount}` and that `remaining_amount` drops.
3. With `creditMemo: "documents"`, post a customer+Credit memo; confirm exactly ONE reason
   product is created and mapped as `creditReasonItem`, and that a second memo on the same
   reason account reuses it.
4. Confirm the memo's own journal is marked `DOC_BACKED` and NOT pushed (no double-post).
5. **Returns/RMAs (the reason this work is required).** Issue a supplier credit from a
   **purchase return order** and a customer credit from a **sales return / RMA**; confirm each
   produces the corresponding provider credit document through the ordinary memo path, with
   **no return-specific code path** involved (the credit is the return's `memo` via
   `purchaseReturnOrderCreditLine.memoId` / `salesReturnOrderCreditLine.memoId`).
6. **Increaser check:** post a supplier+Credit memo and confirm the operation closes `Skipped`
   with the v1-limitation reason, pushing nothing.
7. Delete any sandbox artifacts created purely for verification.

**Verify:** record the outcome in `.ai/runs/2026-09-23-memo-sync-verification.md` with the
request/response evidence for each step.

**Escape hatch:** if Rillet rejects a credit memo whose `revenue.account_code` differs from the
product's bound account, STOP and report — the spec's belt-and-braces assumption is wrong and
the AR mapping needs revisiting.

---

## Task 16: Browser verification of the settings UI

**Depends on:** Task 14
**Files:** none (verification only)

**Steps:**
1. Boot the stack (`crbn up`, portless) and authenticate via the `/auth` skill.
2. Use the `/test` skill to verify: both new selectors render on the integration's posting-sync
   settings, default to `none`, persist a change, and show the go-forward helper copy.
3. Capture screenshots for the PR.

**Verify:** `/test` reports pass with screenshots attached; UI work is not done until visually
verified (`.ai/lessons.md` / repo convention).

**Out of scope:** verifying provider pushes in the browser — that is Task 15's job via the API.
