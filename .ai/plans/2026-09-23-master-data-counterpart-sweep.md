# Master data correctness — counterpart ladder + sweep (spec slice 1)

**Spec:** `.ai/specs/2026-09-23-spend-management-push-only-mode.md` §8
**Research:** `.ai/research/spend-management-one-way-push.md`
**Branch:** independent of push-only; ships alone

## Why this is independent

This fixes a **pre-existing correctness gap** that exists today for every Rillet, Xero
and QuickBooks customer, with no dependency on push-only mode or on the Ramp sandbox
gates. Two facts established by reading the code:

1. **Master data has no correctness sweep.** `accounting-outbound-sweep` (cron `15,45`)
   pages only `journal`, `purchaseInvoice`, `salesInvoice`, `payment`, `charge`. The
   weekly `accounting-reconciliation` is posting-sync only. So a supplier/customer/item
   reaches the provider ONLY via a row event or a JIT document dependency — a record
   predating the install, or one whose event was dropped, is never pushed and nothing
   catches up.
2. **Rillet is the only provider that creates without looking first.**
   `providers/xero/entities/contact.ts:635` ("Smart match: if no mapping exists, search
   Xero by name before creating") and
   `providers/quickbooks-online/entities/vendor.ts:346-347`
   (`findRemoteVendorByName`) both match. `RilletVendorSyncer.upsertRemote` /
   `RilletCustomerSyncer` do not — their header says so explicitly. So adding a sweep
   without fixing this would mint a duplicate Rillet vendor for every supplier a human
   already created there.

Task order is therefore load-bearing: **the ladder (Tasks 1–5) must land before the
sweep (Task 6).**

## Progress
- [x] Task 1: Add counterpart types + the `searchableCounterparts` capability
- [x] Task 2: Write the pure resolution ladder + unit tests
- [x] Task 3: Implement `findRemoteCandidates` for Rillet vendor + customer
- [x] Task 4: Route the Rillet push path through the ladder
- [x] Task 5: Migrate Xero and QuickBooks onto the shared ladder — done 2026-09-24 (the recorded blocker did not survive re-reading; see below)
- [x] Task 6: Add master data to the outbound sweep
- [x] Task 7: Unify the two one-shot jobs into `accounting-master-sync` — done 2026-09-24 via option (b)
- [x] Task 8: Expose the import action on every accounting provider — done 2026-09-24
- [~] Task 9: Full-suite verification — gates green; browser step BLOCKED (local DB down)

## Dependencies
- Task 2 needs Task 1 (types).
- Tasks 3 and 5 both need Task 2. **Tasks 3+4 and Task 5 are independent of each
  other** — may run as parallel subagents.
- Task 6 needs Task 4 (ladder live for Rillet) — see "Why this is independent".
- Task 7 is independent of Tasks 1–6; Task 8 needs Task 7.
- Task 9 needs everything.

---

## Task 1: Add counterpart types + the `searchableCounterparts` capability

**Depends on:** none
**Files:**
- Create: `packages/ee/src/accounting/core/counterpart-types.ts`
- Modify: `packages/ee/src/accounting/core/types.ts` — add `searchableCounterparts` to
  `ProviderCapabilities`; add the optional `findRemoteCandidates` method to
  `BaseProvider`
- Copy from (precedent): `packages/ee/src/accounting/core/types.ts:157-181`
  (`SupportsIncrementalPull` + `providerSupportsIncrementalPull` — the established
  optional-capability + type-guard pattern)

**Steps:**
1. In the new `counterpart-types.ts`, export:
   ```ts
   export type ExternalIdentityKind = "account" | "vendor" | "customer" | "item";

   export type CounterpartSearchKeys = {
     name?: string | null;
     taxId?: string | null;
     email?: string | null;
     /** The provider-side reference Carbon stamps on records it created. */
     carbonReference?: string | null;
   };

   export type RemoteCandidate = {
     remoteId: string;
     name?: string | null;
     taxId?: string | null;
     email?: string | null;
     carbonReference?: string | null;
   };
   ```
2. In `types.ts`, add to `ProviderCapabilities`:
   ```ts
   /**
    * Entity kinds this provider can search for an existing counterpart before
    * creating one. Absent or empty = always create (the pre-2026-09 Rillet
    * behaviour), so the capability is opt-in and nothing regresses by default.
    */
   searchableCounterparts?: ExternalIdentityKind[];
   ```
3. In `types.ts`, add to `BaseProvider` (optional method, mirroring
   `journalDimensionTargets?()` at line 201):
   ```ts
   findRemoteCandidates?(
     kind: ExternalIdentityKind,
     keys: CounterpartSearchKeys
   ): Promise<RemoteCandidate[]>;
   ```
4. Export a type guard beside it, mirroring `providerSupportsIncrementalPull`:
   ```ts
   export function providerSupportsCounterpartSearch<T extends BaseProvider>(
     provider: T,
     kind: ExternalIdentityKind
   ): provider is T & Required<Pick<BaseProvider, "findRemoteCandidates">> {
     return (
       typeof provider.findRemoteCandidates === "function" &&
       (provider.capabilities?.searchableCounterparts ?? []).includes(kind)
     );
   }
   ```
   Both conditions are required: `XeroProvider` deliberately declares no
   `capabilities` at all (`providers/xero/provider.ts:208-222`), so the `?? []`
   default must read as "no search" rather than throwing.
5. Re-export the new types from `packages/ee/src/accounting/index.ts`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0, no errors. Adding an optional field and an optional method
# must not break any existing provider.
```

**Out of scope:** implementing `findRemoteCandidates` on any provider; touching
`upsertRemote` anywhere.

---

## Task 2: Write the pure resolution ladder + unit tests

**Depends on:** Task 1
**Files:**
- Create: `packages/ee/src/accounting/core/counterpart.ts`
- Create: `packages/ee/src/accounting/core/counterpart.test.ts`
- Copy from (precedent): `packages/ee/src/ramp/lib/spend.ts:214-250`
  (`resolveOrCreateRampSpendVendor` — the existing ladder, including the
  ambiguity rule at lines 180-195)

**Steps:**
1. Export a PURE function that decides, given already-fetched candidates:
   ```ts
   export type CounterpartDecision =
     | { action: "link"; remoteId: string; via: "carbonReference" | "taxId" | "email" | "name" }
     | { action: "create"; reason: "no-candidates" | "ambiguous" };

   export function decideCounterpart(
     keys: CounterpartSearchKeys,
     candidates: readonly RemoteCandidate[]
   ): CounterpartDecision;
   ```
   Ladder order, each rung matched case-insensitively on a trimmed non-empty value:
   `carbonReference` → `taxId` → `email` → `name`. The FIRST rung with **exactly one**
   match wins. A rung with **two or more** matches does not fall through to a weaker
   rung — it returns `{ action: "create", reason: "ambiguous" }` immediately.
2. Rationale to put in the file header, verbatim from the spec: ambiguity creates and
   never guesses, because a duplicate is recoverable by merging while a wrong link
   silently posts one company's bills against another company's vendor.
3. Export the impure orchestrator, which does the I/O:
   ```ts
   export async function resolveOrCreateRemoteCounterpart(args: {
     provider: BaseProvider;
     kind: ExternalIdentityKind;
     keys: CounterpartSearchKeys;
     existingRemoteId: string | null;
   }): Promise<{ remoteId: string | null; decision: CounterpartDecision | null }>;
   ```
   It returns `{ remoteId: existingRemoteId, decision: null }` immediately when
   `existingRemoteId` is set; returns `{ remoteId: null, decision: {action:"create"} }`
   when `providerSupportsCounterpartSearch` is false; otherwise calls
   `findRemoteCandidates` and runs `decideCounterpart`. It NEVER creates — the caller
   owns creation.
4. Write `counterpart.test.ts` covering, at minimum: no candidates → create; one name
   match → link via name; two name matches → create/ambiguous; a `taxId` match beating
   a conflicting single `name` match; two `taxId` matches → create/ambiguous **without**
   falling through to name; a `carbonReference` match winning over everything; empty and
   whitespace-only keys ignored on every rung; case-insensitive name matching.
   Use optional chaining on indexed access (`candidates[0]?.remoteId`) —
   `noUncheckedIndexedAccess` is on.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- counterpart
# Expected: all counterpart tests pass, including the two ambiguity cases.
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** calling this from any syncer.

---

## Task 3: Implement `findRemoteCandidates` for Rillet vendor + customer

**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/accounting/providers/rillet/provider.ts` — add
  `findRemoteCandidates` and declare `searchableCounterparts: ["vendor", "customer"]`
  on `capabilities` (lines 375-382)
- Copy from (precedent): `packages/ee/src/accounting/providers/rillet/provider.ts`
  `listVendors` / `listCustomers` as used by
  `packages/jobs/src/inngest/functions/integrations/rillet-import-contacts.ts:134-138`

**Steps:**
1. Add `searchableCounterparts: ["vendor", "customer"]` to the existing
   `readonly capabilities: ProviderCapabilities` object.
2. Implement `findRemoteCandidates(kind, keys)`:
   - `kind === "vendor"` → `listVendors()`; `kind === "customer"` → `listCustomers()`;
     anything else → `return []`.
   - Map each remote row to a `RemoteCandidate`, reading its Carbon reference through
     the existing `readCarbonExternalReference` helper
     (`providers/rillet/entities/shared.ts`) so the `carbonReference` rung works.
   - Cache the drained list per `(kind)` on the provider instance for the lifetime of
     one sync run, the same way `rillet-import-contacts.ts:109` caches instead of
     re-scanning per batch.
3. **If `listCustomers`/`listVendors` do not exist with those exact names, STOP and
   report — do not invent an endpoint.** The lesson at `.ai/lessons.md` ("Rillet AP
   payment pull assumed an org-wide `GET /bill-payments`") is precisely this failure.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
pnpm --filter @carbon/ee test -- rillet
# Expected: existing Rillet tests still pass (no behaviour change yet — the
# capability is declared but nothing calls it until Task 4).
```

**Out of scope:** changing `upsertRemote`.

---

## Task 4: Route the Rillet push path through the ladder

**Depends on:** Task 3
**Files:**
- Modify: `packages/ee/src/accounting/providers/rillet/entities/vendor.ts` —
  `upsertRemote` (around line 533)
- Modify: `packages/ee/src/accounting/providers/rillet/entities/customer.ts` — the
  equivalent `upsertRemote`
- Modify: both files' class-header comments, which currently state "no name-matching
  lookup before create" — that statement becomes false
- Copy from (precedent):
  `packages/ee/src/accounting/providers/quickbooks-online/entities/vendor.ts:344-355`
  (the `existingRemoteId ??= match` then create-or-update shape)

**Steps:**
1. In `upsertRemote`, after `const existingRemoteId = await this.getRemoteId(localId)`
   and before the create branch, call `resolveOrCreateRemoteCounterpart` with
   `kind: "vendor"` (or `"customer"`), `existingRemoteId`, and `keys` built from the
   mapped write payload: `name`, `taxId` and `email` if the payload carries them,
   `carbonReference: carbonExternalReference(localId)`.
2. When it returns a `remoteId`, take the **update** branch (PUT the existing record)
   and write the mapping row via the syncer's existing `linkEntities` path, exactly as
   an update would. When it returns null, keep today's create-with-idempotency-key path
   unchanged.
3. Update both header comments to describe the ladder and cite
   `core/counterpart.ts`.
4. Do NOT remove the `carbon` external reference or the create `Idempotency-Key` —
   they remain the guards against Carbon double-creating, which the ladder does not
   replace.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- rillet
# Expected: all existing Rillet vendor/customer tests pass.
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```
Then add one regression test in
`packages/ee/src/accounting/providers/rillet/entities/__tests__/` asserting that a
supplier with no mapping, where `findRemoteCandidates` returns one same-named vendor,
results in an UPDATE and a mapping row — not a create.

**Out of scope:** Xero, QuickBooks, the sweep.

---

## Task 5: Migrate Xero and QuickBooks onto the shared ladder

> **UNBLOCKED and done 2026-09-24. No shared-interface change was needed.**
>
> The recorded blocker rested on a false premise. It claimed QBO's
> `findRemoteVendorByName` cached the matched entity's `SyncToken` so the follow-up
> update could skip a GET, and that the resolver therefore had to return the matched
> `RemoteCandidate` with an opaque `raw` payload. Re-reading the code:
>
> - `updateWithSyncTokenRetry` calls `fetchCurrent()` **unconditionally** before it
>   updates. The name-match's cached SyncToken was never used to avoid a GET.
> - `rememberRemoteEntity(match)` is overwritten by `rememberRemoteEntity(created)`
>   or `rememberRemoteEntity(updated)` a few lines later on every path through
>   `upsertRemote`. Its only surviving effect — seeding `linkEntities`'
>   `remoteUpdatedAt` — is re-supplied by the write's own response.
>
> So the cache was dead weight, and `{ remoteId, decision }` is sufficient.
> `RemoteCandidate` gained no `raw` field, and the resolver is unchanged.
>
> **Deliberate behaviour changes, both toward the ladder's doctrine:**
>
> 1. **Ambiguity creates instead of taking `[0]`.** Unreachable for QBO
>    (`DisplayName` is unique) and for Xero among ACTIVE contacts. If an archived
>    Xero twin ever makes it reachable, the create surfaces as Xero's own
>    duplicate-name refusal — a visible Failed op — rather than a silent link to the
>    archived record.
> 2. **A failed search now throws instead of reading as "no match".** Xero's
>    `findRemoteContactByName` swallowed the error and returned null, so a transient
>    500 created a duplicate contact permanently. QBO and Rillet already failed
>    closed; Xero now matches them. The operation parks and retries instead.
>
> **Two things found and fixed along the way, neither in the original plan:**
>
> - **Xero's batch path bypassed name matching entirely.** `upsertRemoteBatch`
>   consulted the mapping row only, so the very backfill this matching exists for
>   created duplicates whenever it ran batched. Both paths now route through one
>   private `resolveExistingContact`.
> - **`escapeQboQueryValue` had to move.** It lived in `entities/shared.ts`, which
>   imports `../provider` — so the provider could not import it. Extracted to the
>   leaf `quickbooks-online/query.ts` and re-exported from `shared.ts`, the same
>   shape as the Rillet `references.ts` extraction.
>
> **On Xero's capabilities object:** declaring one opts OUT of every default, so an
> omitted field asserts the default rather than "unknown". `maxJournalDimensionSlots`
> therefore had to be declared (omitted, it means "no cap", which is false for Xero);
> it references the existing `XERO_MAX_JOURNAL_DIMENSION_SLOTS` constant rather than
> repeating the literal. Three doc comments across `core/types.ts`,
> `sync/capabilities.ts` and `counterpart-types.ts` cited Xero as the
> capability-less provider and are now updated.
>
> **Keys passed: `name` only, for both providers.** Unlike Rillet — which has no
> search endpoint and so lists the org, making every rung live — Xero and QBO query
> by name, which bounds the candidate set to one name. An email or tax-id rung over
> a name-bounded set can only re-confirm the same record or find nothing, so passing
> those keys would change the reported rung and nothing else. Widening the ladder
> for these two means widening the query; that is a real behaviour change and was
> left out of scope.
>
> **Gates:** `@carbon/ee` + `@carbon/jobs` + `erp` typecheck, `pnpm run lint`
> (37/37), `pnpm run test` (31/31, 1654 ee tests). New HTTP-boundary tests stub
> `fetch` only and pin both providers' query shape, escaping, error behaviour and
> no-op cases — the same class of bug as the Rillet `email` vs `emails[]` shape
> mismatch this slice already hit.
>
> **Not verified in a browser** — same blocker as the rest of slice 1: no accounting
> provider is connected to the local dev company.


**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/accounting/providers/rillet/provider.ts` — add
  `findRemoteCandidates` and declare `searchableCounterparts: ["vendor", "customer"]`
  on `capabilities` (lines 375-382)
- Copy from (precedent): `packages/ee/src/accounting/providers/rillet/provider.ts`
  `listVendors` / `listCustomers` as used by
  `packages/jobs/src/inngest/functions/integrations/rillet-import-contacts.ts:134-138`

**Steps:**
1. Add `searchableCounterparts: ["vendor", "customer"]` to the existing
   `readonly capabilities: ProviderCapabilities` object.
2. Implement `findRemoteCandidates(kind, keys)`:
   - `kind === "vendor"` → `listVendors()`; `kind === "customer"` → `listCustomers()`;
     anything else → `return []`.
   - Map each remote row to a `RemoteCandidate`, reading its Carbon reference through
     the existing `readCarbonExternalReference` helper
     (`providers/rillet/entities/shared.ts`) so the `carbonReference` rung works.
   - Cache the drained list per `(kind)` on the provider instance for the lifetime of
     one sync run, the same way `rillet-import-contacts.ts:109` caches instead of
     re-scanning per batch.
3. **If `listCustomers`/`listVendors` do not exist with those exact names, STOP and
   report — do not invent an endpoint.** The lesson at `.ai/lessons.md` ("Rillet AP
   payment pull assumed an org-wide `GET /bill-payments`") is precisely this failure.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
pnpm --filter @carbon/ee test -- rillet
# Expected: existing Rillet tests still pass (no behaviour change yet — the
# capability is declared but nothing calls it until Task 4).
```

**Out of scope:** changing `upsertRemote`.

---

## Task 4: Route the Rillet push path through the ladder

**Depends on:** Task 3
**Files:**
- Modify: `packages/ee/src/accounting/providers/rillet/entities/vendor.ts` —
  `upsertRemote` (around line 533)
- Modify: `packages/ee/src/accounting/providers/rillet/entities/customer.ts` — the
  equivalent `upsertRemote`
- Modify: both files' class-header comments, which currently state "no name-matching
  lookup before create" — that statement becomes false
- Copy from (precedent):
  `packages/ee/src/accounting/providers/quickbooks-online/entities/vendor.ts:344-355`
  (the `existingRemoteId ??= match` then create-or-update shape)

**Steps:**
1. In `upsertRemote`, after `const existingRemoteId = await this.getRemoteId(localId)`
   and before the create branch, call `resolveOrCreateRemoteCounterpart` with
   `kind: "vendor"` (or `"customer"`), `existingRemoteId`, and `keys` built from the
   mapped write payload: `name`, `taxId` and `email` if the payload carries them,
   `carbonReference: carbonExternalReference(localId)`.
2. When it returns a `remoteId`, take the **update** branch (PUT the existing record)
   and write the mapping row via the syncer's existing `linkEntities` path, exactly as
   an update would. When it returns null, keep today's create-with-idempotency-key path
   unchanged.
3. Update both header comments to describe the ladder and cite
   `core/counterpart.ts`.
4. Do NOT remove the `carbon` external reference or the create `Idempotency-Key` —
   they remain the guards against Carbon double-creating, which the ladder does not
   replace.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- rillet
# Expected: all existing Rillet vendor/customer tests pass.
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```
Then add one regression test in
`packages/ee/src/accounting/providers/rillet/entities/__tests__/` asserting that a
supplier with no mapping, where `findRemoteCandidates` returns one same-named vendor,
results in an UPDATE and a mapping row — not a create.

**Out of scope:** Xero, QuickBooks, the sweep.

---

## Task 5: Migrate Xero and QuickBooks onto the shared ladder

> **BLOCKED 2026-09-24 — the shared interface cannot express what QBO needs.**
>
> Two findings from reading the code before writing any:
>
> 1. **The ambiguity change is a non-event.** Both providers take the FIRST match
>    (`Contacts[0]`, `matches[0]`) with no ambiguity check, so the ladder's
>    "ambiguity creates" rule IS a behaviour change on paper — but Xero enforces
>    unique active contact names and QBO enforces unique `DisplayName`, so it is
>    unreachable in practice. Passing only the `name` key would reduce the ladder
>    to exactly today's behaviour plus an unreachable guard. Safe.
> 2. **`findRemoteCandidates` returning ids loses QBO's entity cache.** Its
>    `findRemoteVendorByName` calls `this.rememberRemoteEntity(match)`, caching the
>    full matched entity so the follow-up update has its `SyncToken` without
>    another GET. `resolveOrCreateRemoteCounterpart` returns a `remoteId` only, so
>    adopting it as written would add a GET per matched vendor AND could reintroduce
>    the sync-token retry path `updateWithSyncTokenRetry` exists to avoid.
>
> The fix is a **shared-interface change**, not a call-site workaround: the resolver
> should return the matched `RemoteCandidate`, and `RemoteCandidate` should carry an
> optional opaque `raw` payload the provider can hand back to itself. That is a
> deliberate design decision affecting every provider, so it is not something to
> improvise unattended on two live providers this customer does not use.
>
> **Xero's capabilities object is NOT the blocker** (verified): only two
> `.capabilities` reads exist repo-wide, both `?.maxJournalDimensionSlots ?? null`,
> and neither is Xero's path (it reads `XERO_MAX_JOURNAL_DIMENSION_SLOTS` directly).
> `supportsWebhooks`/`supportsJournalPush` have no read sites at all. So declaring a
> capabilities object on Xero with `transport: "rest"` and
> `maxJournalDimensionSlots` left absent changes nothing observable. Note the
> original step 3 below asked to "keep every currently-absent field absent", which
> is impossible — those three fields are required by `ProviderCapabilities`.
>
> Nothing regresses while this is blocked: Rillet now uses the ladder, Xero and QBO
> keep their own name matching, and Task 6's sweep is safe for all three.


**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/accounting/providers/xero/entities/contact.ts:633-639` —
  replace the inline `findRemoteContactByName` call
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/vendor.ts:344-348`
  and the customer equivalent — replace the inline `findRemoteVendorByName` call
- Modify: both providers' `capabilities` to declare `searchableCounterparts`
  (QBO at `providers/quickbooks-online/provider.ts:368-374`; **Xero declares no
  `capabilities` object at all** — add one, keeping every currently-absent field absent
  so the documented "absent = legacy REST provider" default is preserved, per the
  comment at `providers/xero/provider.ts:208-222`)

**Steps:**
1. Move each provider's existing private name-lookup into `findRemoteCandidates`,
   returning candidates rather than a single id. Preserve each provider's current
   query exactly — Xero's contact-name search and QBO's
   `DisplayName = '<escaped>'` query, including `escapeQboQueryValue`.
2. Replace the inline call in `upsertRemote` with
   `resolveOrCreateRemoteCounterpart`.
3. **Behaviour must be identical.** Xero's existing comment asserts "Xero enforces
   unique contact names across all active contacts", so its ambiguity case cannot fire
   in practice; QBO's query is an equality match. If either provider's existing lookup
   silently took the first of several matches, the ladder will now CREATE instead —
   that is the intended fix, but note it in the PR description rather than hiding it.
4. Xero's `ContactSyncer` backs both `customer` and `vendor` (it reads both mapping
   types at `contact.ts:48-66`) — declare both kinds and pass the syncer's own
   `entityType` as `kind`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- xero
# Expected: all existing Xero contact tests pass unchanged.
pnpm --filter @carbon/ee test -- quickbooks
# Expected: all existing QBO vendor/customer tests pass unchanged.
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** changing what either provider searches by. This task is a refactor
onto shared code, not a behaviour change.

---

## Task 6: Add master data to the outbound sweep

**Depends on:** Task 4
**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/accounting-outbound-sweep.ts`
  — add master-data pages alongside the existing document pages (lines ~212-358)
- Copy from (precedent): the `purchaseInvoice` page block at
  `accounting-outbound-sweep.ts:238-252` (config gate → `pageIds` → map to
  `ReconcileRef[]` → `skippedReasons.push` on the else branch)

**Steps:**
1. For each of `customer` → `supplier` table, `vendor` → `supplier` table,
   `item` → `item` table, gated by the existing
   `provider.getSyncConfig(entityType)?.enabled && direction !== "pull-from-accounting"`
   (the same predicate `isEntityPushEnabled` uses), build the candidate set as the
   UNION of two bounded queries:
   - **unmapped** — `mappingService.getUnsyncedEntityIds(entityType, tableName,
     integration, limit)`, which already exists
     (`core/external-mapping.ts:301`). This set drains to zero and stays there.
   - **changed since cursor** — the existing `pageIds` keyset on `updatedAt`.
2. Cap each per run: `MASTER_DATA_PAGE_SIZE = 200` for `customer`/`vendor`,
   `MASTER_DATA_ITEM_PAGE_SIZE = 500` for `item`.
3. Gate `item` to run only on the `:15` invocation (`new Date().getUTCMinutes() < 30`)
   so a six-figure item master is swept twice an hour at most, not four times. Add a
   comment saying why.
4. `reconcileMasterData` already short-circuits a mapped-and-unchanged record
   ("unchanged since the last successful sync", `reconcile.ts:485-492`), so steady
   state enqueues nothing. Do not add a second freshness check.
5. Note `customer` and `vendor` both read the tables `customer` and `supplier`
   respectively — check `sync-tables.ts` `TABLE_TO_ENTITY_MAP` for the authoritative
   table→entity mapping rather than assuming.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- outbound-sweep
# Expected: existing sweep tests pass; new tests assert that (a) an unmapped supplier
# is enqueued, (b) a mapped-and-unchanged supplier is not, (c) `item` is skipped on
# the :45 invocation.
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** changing `reconcileMasterData`; adding deletes.

---

## Task 7: Unify the two one-shot jobs into `accounting-master-sync`

> **DONE 2026-09-24 — took option (b), and the split turned out bigger than either
> option described.**
>
> The stop condition was right that `accounting-backfill` is not a master-data job.
> Reading it fully found two more things:
>
> 1. **Its two PULL phases were unreachable.** They gated on the entity's configured
>    `direction` via `shouldPull`, and every provider's `build*SyncConfig` forces
>    `customer`/`vendor`/`item` to `push-to-accounting` / `owner: "carbon"`. So
>    `shouldPull` was always false — ~320 lines that could never run. That is also
>    exactly WHY `rillet-import-contacts` had to exist: it enqueues
>    `pull-from-accounting` operations explicitly, overriding the direction.
> 2. **The three push phases were copy-pasted per entity type**, ~135 lines each
>    differing only in the entity name and its table.
>
> **What shipped**
>
> - `accounting-journal-backfill.ts` — phase 0 extracted verbatim as its own
>   provider-agnostic job. It had only ever been reachable by clicking Xero's
>   "Run Initial Sync" button, so on QBO and Rillet journal-disposition repair
>   beyond the sweep's 7-day window did not exist at all.
> - `accounting-master-sync.ts` — one job, `direction` as a payload field, one loop
>   over entity types instead of three copies. Net ~1400 lines deleted.
> - `provider.listRemoteEntityIds(kind)` + `capabilities.importableEntities`, with
>   `providerSupportsMasterDataImport` requiring both — the same both-conditions rule
>   as the counterpart ladder. This is what keeps the job free of provider branching,
>   per the "never `if (rillet) else if (quickbooks)`" constraint. Implemented on all
>   three: Rillet reuses its memoized org lists, QBO runs an unfiltered `SELECT`, Xero
>   pages `/Contacts`.
> - `MASTER_DATA_TABLES` extracted in `master-data-targets.ts` so the `vendor` →
>   `supplier` pairing has one definition shared with Task 6's sweep.
>
> **Judgement calls worth reviewing**
>
> - **Xero's enumeration does NOT reuse `listContacts`.** That method's filter is
>   `IsCustomer==true OR IsSupplier==true`, so importing "customers" through it would
>   have created Carbon customers out of supplier-only contacts. `listRemoteEntityIds`
>   pages each kind separately. A contact that is genuinely both appears under both,
>   which is correct — the mapping row is keyed by entity type.
> - **A `withRateLimitRetry` helper was deleted, not carried over.** It awaited
>   `step.sleep` from INSIDE a `step.run` — a nested-step violation. A `RatelimitError`
>   now propagates so Inngest retries with backoff, which is what the pull path
>   already did.
> - **`XeroProvider.listContacts` / `listItems` deleted** along with their four
>   option/response interfaces: the dead pull phases were their only callers.
> - **PULL ignores the configured direction; PUSH respects it.** Asking to import is
>   deliberately overriding the automatic direction; asking to push is asking the
>   automatic direction to catch up, so a pull-only entity stays pull-only.
> - **A kind a provider cannot enumerate reports `notAttempted` with a reason**
>   rather than importing nothing and returning success.
>
> **Task 8 shipped with it.** Two provider-agnostic routes
> (`integrations.master-sync.ts`, `integrations.journal-backfill.ts`) replace the two
> per-provider ones. Parameters ride the QUERY STRING because
> `IntegrationActionButton` POSTs `action.endpoint` with no body — worth knowing
> before designing any future action. All three accounting descriptors now declare the
> same three actions: Import customers & vendors, Push customers/vendors/items,
> Backfill journal postings. Xero's existing "Entities to Sync" switches still drive
> its push selection; the other two fall through to all-three defaults. No `/translate`
> run — these descriptor strings are plain (the existing Rillet action was too), not
> Lingui macros.
>
> **Docs synced:** `.claude/rules/accounting-sync-handlers.md` (job table + the section,
> retitled from "Rillet contact import"), `packages/ee/AGENTS.md`, and two stale code
> comments in the Rillet provider/customer syncer.
>
> **Gates:** ee + jobs + lib + erp + checks typecheck, `pnpm run lint` (37/37),
> `pnpm run test` (31/31). New `fetch`-boundary tests pin Xero's per-kind filters,
> its paging and its throw-on-partial-page, and QBO's unfiltered select.
>
> **Not verified in a browser** — no accounting provider is connected locally, so no
> button has been clicked. This is the largest untested surface in the slice: three
> new actions on three providers, and two jobs that replaced working ones.


**Depends on:** none (independent of Tasks 1–6)
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/accounting-master-sync.ts`
- Modify: `packages/jobs/src/inngest/index.ts` — register it
- Modify: `packages/lib/src/trigger.ts` and `packages/lib/src/events.ts` — add
  `accounting-master-sync` → `carbon/accounting-master-sync`
- Delete: `packages/jobs/src/inngest/functions/integrations/accounting-backfill.ts`
  and `rillet-import-contacts.ts` **only after** Task 8 repoints their routes
- Copy from (precedent): `rillet-import-contacts.ts` — its `enqueueSyncOperations` +
  `drainSyncOperations` shape is the more complete of the two

**Steps:**
1. Payload: `{ companyId, provider: ProviderID, entityTypes: AccountingEntityType[],
   direction: "push-to-accounting" | "pull-from-accounting", batchSize }`.
2. For `pull-from-accounting`, reproduce `rillet-import-contacts`'s behaviour exactly:
   list the remote records, enqueue explicit pull operations, drain them. For
   `push-to-accounting`, reproduce `accounting-backfill`'s customers/vendors/items
   behaviour.
3. Keep the per-company concurrency key both jobs use today.
4. **If `accounting-backfill` turns out to do anything beyond customers/vendors/items
   (it also has `pullIntegration`/`pushIntegration` phases at lines 397, 577, 718, 855,
   988), STOP and report** — its scope may exceed master data and this task would then
   need to keep it and only absorb the contact import.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- master-sync
# Expected: new tests pass for both directions.
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** deleting the old jobs before Task 8 lands.

---

## Task 8: Expose the import action on every accounting provider

**Depends on:** Task 7
**Files:**
- Create: `apps/erp/app/routes/api+/integrations.master-sync.ts` — one route,
  provider-agnostic, replacing `integrations.rillet.import-contacts.ts` and
  `integrations.xero.backfill.ts`
- Modify: `packages/ee/src/rillet/config.tsx:91-99` — repoint the existing
  `actions` entry
- Modify: `packages/ee/src/xero/config.tsx` and
  `packages/ee/src/quickbooks/config.tsx` — add the same `actions` entry
- Copy from (precedent): `packages/ee/src/rillet/config.tsx:91-99` (the
  `IntegrationAction` shape) and
  `apps/erp/app/routes/api+/integrations.rillet.import-contacts.ts` (the route)

**Steps:**
1. The route reads the integration id from the request body, resolves the provider via
   the existing `Object.values(ProviderID)` membership check
   (`integrations.$id.tsx:343-348` is the precedent), calls
   `requirePermissions(request, { update: "settings" })`, and fires
   `trigger("accounting-master-sync", { ... })`.
2. Declare the action on all three accounting descriptors with
   `label: "Import customers & vendors"` and `endpoint: "/api/integrations/master-sync"`.
3. Delete the two old routes and the two old jobs once this is green.
4. Run `/translate` — `label`/`description` are user-facing strings.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm run lint
# Expected: exit 0
```

**Out of scope:** UI beyond the existing action button (`IntegrationForm` already
renders `actions`).

---

## Task 9: Full-suite verification

> **2026-09-24 — automated gates GREEN, browser verification BLOCKED.**
>
> `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp`,
> `pnpm run lint` and `pnpm run test` (31 tasks, all packages) all pass.
>
> Step 2's browser verification did NOT run: the local database is not up this
> session (`pg_isready` fails on `PORT_DB=49921`; only the `carbon-redis`
> container is running), so there is no stack to drive and no Rillet integration
> to exercise. **This is unproven, not disproven** — the ladder's decision logic
> is unit-tested and the sweep's table pairing is pinned, but nothing has observed
> a real Carbon supplier linking to a real same-named Rillet vendor. Run it before
> merge:
>
> 1. `crbn up`, connect Rillet.
> 2. Create a supplier whose name matches an existing Rillet vendor; confirm ONE
>    Rillet vendor and one mapping row, not two vendors.
> 3. Run the import action twice; confirm no duplicate suppliers.
> 4. Confirm the master-data sweep enqueues a pre-existing unmapped supplier.


**Depends on:** Tasks 1–8
**Files:** none

**Steps:**
1. Run the gates below.
2. Browser-verify via `/test`: with a Rillet integration connected, create a supplier
   whose name matches an existing Rillet vendor, confirm it LINKS (one Rillet vendor,
   one mapping row) rather than duplicating; then run the import action twice and
   confirm no duplicate suppliers.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp
# Expected: exit 0
pnpm run lint
# Expected: exit 0
pnpm run test
# Expected: all pass
```

**Out of scope:** anything in spec §§1-7, 9-10 — those are slice 2 and later.
