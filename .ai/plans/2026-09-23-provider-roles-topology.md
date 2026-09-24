# Provider roles + integration topology (spec slice 2)

**Spec:** `.ai/specs/2026-09-23-spend-management-push-only-mode.md` §1, §1b, §1c, §5
**Research:** `.ai/research/spend-management-one-way-push.md`
**Branch:** independent of slice 1; foundation for slices 3–5

## What this slice is and is not

**No behaviour change.** Every gate this introduces resolves to exactly today's answer,
because no integration declares `ownsLedgerFamilies` until slice 4. That is the point:
the ~13-call-site signature change and the four hard-coded-list removals land as a
reviewable refactor, not buried under a feature.

Two facts established by reading the code, which this slice fixes:

1. **"Which integrations are accounting providers" is answered five different ways** —
   `Object.values(ProviderID)` in three sweeps, `ACCOUNTING_SYNC_INTEGRATION_IDS`
   (`accounting.service.ts:2938`), an inline `["xero","quickbooks","rillet"]`
   (`x+/accounting+/_layout.tsx:51`), and `category === "Accounting"`
   (`integrations.$id.tsx:647`). Spend is `.eq("id","ramp")`.
2. **There is no exclusivity mechanism at all.** Nothing in `IntegrationConfig`
   expresses a domain or conflict, and the schema permits several active accounting
   integrations per company — `getPeriodExternalGlSyncReadiness` literally loops over
   "at most three".

## Progress
- [x] Task 1: Migration — `integration.providerRole` + exclusivity trigger
- [x] Task 2: Regenerate database types
- [x] Task 3: Declare `providerRole` on the descriptors
- [ ] Task 4: Unify the capability surface
- [ ] Task 5: Build `IntegrationTopology` + `resolveIntegrationTopology`
- [ ] Task 6: Thread the topology through the settings resolvers
- [~] Task 7: Replace the hard-coded provider-id lists — 2 of 3 done; third is structurally blocked
- [ ] Task 8: Block conflicting installs in the UI and the OAuth callbacks
- [ ] Task 9: Add the `no-integration-id-branching` conformance check
- [ ] Task 10: Full-suite verification

## Dependencies
- Task 2 needs Task 1. Task 3 needs Task 2 (types).
- Task 5 needs Tasks 3 and 4.
- Tasks 6 and 7 both need Task 5; **they are independent of each other** and may run as
  parallel subagents.
- Task 8 needs Task 1 (the trigger) and Task 3.
- Task 9 needs Task 7 (otherwise its baseline is enormous).

---

## Task 1: Migration — `integration.providerRole` + exclusivity trigger

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<generated>_integration-provider-role.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260919152233_ramp-integration.sql`
  (idempotent `DO $$ … IF NOT EXISTS` guards and the registry `INSERT … ON CONFLICT`)

**Steps:**
1. Create the file with `pnpm db:migrate:new integration-provider-role`. **Never
   hand-pick the timestamp and never use `000000` for HHMMSS**; never a timestamp older
   than the newest migration on `main`.
2. Write exactly the SQL in the spec's Data Model section. Points that are not
   negotiable:
   - `integration` is a **global registry** (`id` + `jsonschema`), NOT a tenant table —
     no `companyId`, no composite PK, no new RLS policies. The standard table template
     does not apply here; do not add one.
   - The trigger fires `BEFORE INSERT OR UPDATE OF "active"` and returns early when
     `NEW."active" IS NOT TRUE` or when `TG_OP = 'UPDATE' AND OLD."active" IS TRUE`, so
     a company already holding two active accounting integrations is **not**
     retroactively invalidated — it simply cannot activate a third.
   - `SECURITY DEFINER` + `SET search_path = public`, raising with
     `ERRCODE = '23505'` so callers can distinguish a conflict from a generic failure.
   - Guard every statement (`ADD COLUMN IF NOT EXISTS`, the `pg_constraint` existence
     check, `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`) — the deploy runner
     retries a failed file over committed partial state.
3. Backfill `providerRole` for `xero`/`quickbooks`/`rillet` → `'accounting'` and
   `ramp` → `'spend'`, each with `WHERE "providerRole" IS DISTINCT FROM …` so a re-run
   writes nothing.
4. Run the report query from the spec and record the result in the PR description. **If
   any company already has two active integrations of one role, STOP and report** —
   do not repair data in a migration.
5. Apply with `pnpm db:migrate`.

**Verify:**
```bash
pnpm db:migrate
# Expected: applies cleanly.
psql "$DATABASE_URL" -c "SELECT id, \"providerRole\" FROM integration WHERE \"providerRole\" IS NOT NULL ORDER BY id;"
# Expected: quickbooks|accounting, ramp|spend, rillet|accounting, xero|accounting
psql "$DATABASE_URL" -c "SELECT tgname FROM pg_trigger WHERE tgname = 'companyIntegration_single_active_role';"
# Expected: one row
pnpm db:check:datasets && pnpm db:check:backups
# Expected: both pass
```

**Out of scope:** any application code.

---

## Task 2: Regenerate database types

**Depends on:** Task 1
**Files:**
- Modify: `packages/database/src/types.ts` (generated — never hand-edited)

**Steps:**
1. `pnpm run generate:types`
2. Commit the regenerated file. Regenerating and committing types after a migration is
   normal and expected.

**Verify:**
```bash
git diff --stat packages/database/src/types.ts
# Expected: a non-empty diff adding providerRole to the integration Row/Insert/Update types
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exit 0
```

**Out of scope:** everything else.

---

## Task 3: Declare `providerRole` on the descriptors

**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/types.ts` — add `providerRole?: "accounting" | "spend"` to
  `IntegrationConfig` (near `category`, line ~167)
- Modify: `packages/ee/src/{xero,quickbooks,rillet}/config.tsx` — add
  `providerRole: "accounting"`
- Modify: `packages/ee/src/ramp/config.tsx` — add `providerRole: "spend"`
- Modify: `packages/ee/src/index.ts` — export
  `getIntegrationsByRole(role): Integration[]` beside `getIntegrationConfigById`

**Steps:**
1. Add the optional field with a doc comment saying it is the behavioural role, that
   `category` remains a display string, and that integrations without a role (Slack,
   Jira, Linear, Onshape, Paperless Parts, Email, Stripe Connect) are unconstrained.
2. Declare it on the four descriptors. Do not touch `category` on any of them.
3. Add the lookup to `index.ts`:
   ```ts
   export const getIntegrationsByRole = (role: "accounting" | "spend") =>
     integrations.filter((i) => i.providerRole === role);
   ```
4. Add a test asserting the TS registry and the DB registry agree — every descriptor
   with a `providerRole` must match the value Task 1 backfilled. Put it in
   `packages/ee/src/__tests__/provider-role.test.ts`, reading the expected pairs from a
   literal (the test cannot reach the database).

**Verify:**
```bash
pnpm --filter @carbon/ee test -- provider-role
# Expected: passes
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit 0
```

**Out of scope:** using `providerRole` anywhere yet.

---

## Task 4: Unify the capability surface

**Depends on:** Task 2
**Files:**
- Create: `packages/ee/src/sync/capabilities.ts`
- Modify: `packages/ee/src/accounting/core/types.ts` — re-export
  `SyncProviderCapabilities` as `ProviderCapabilities` for compatibility
- Modify: `packages/ee/src/accounting/providers/{rillet,quickbooks-online}/provider.ts`
  — add `role: "accounting"` to the existing `capabilities` objects
- Copy from (precedent): `packages/ee/src/accounting/core/types.ts:87-107`
  (the current `ProviderCapabilities` and its "absent = legacy REST provider" doc)

**Steps:**
1. Write the discriminated union exactly as the spec's §1b defines it:
   `SharedCapabilities` (`transport`, `supportsWebhooks`, `externalAddressing`,
   `searchableCounterparts`) plus the `role: "accounting"` arm
   (`supportsJournalPush`, `maxJournalDimensionSlots`) and the `role: "spend"` arm
   (`ownsRemoteCodingSurface`, `ownsLedgerFamilies`).
2. Export `resolveCapabilities(provider)` returning a fully-defaulted object, since
   **`XeroProvider` deliberately declares no `capabilities` at all**
   (`providers/xero/provider.ts:208-222`). Documented defaults:
   `role: "accounting"`, `transport: "rest"`, `supportsWebhooks: false`,
   `supportsJournalPush: true`, `externalAddressing: { account: "code" }`,
   `searchableCounterparts: []`, `ownsLedgerFamilies: []`.
   Every read goes through this function — never `provider.capabilities?.x` at a call
   site.
3. Do NOT add `externalAddressing` values to any provider in this slice; the default
   is correct for Xero and Rillet, and QBO's `{ account: "id" }` is only consumed in
   slice 5. Leaving it absent keeps this slice behaviour-free.
4. Migrate the two existing declaration sites to add `role`, and update the three
   existing `provider.capabilities?.maxJournalDimensionSlots` reads
   (`integrations.$id.tsx:382`, `:414`) to `resolveCapabilities(provider)` — being
   careful that Xero's cap continues to come from `XERO_MAX_JOURNAL_DIMENSION_SLOTS`
   at line 436, which is deliberately off `capabilities`.

**Verify:**
```bash
pnpm --filter @carbon/ee test
# Expected: all pass
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit 0
```
**If any existing `capabilities` read cannot be routed through `resolveCapabilities`
without changing its result, STOP and report — do not improvise a default.**

**Out of scope:** `searchableCounterparts` implementations (slice 1), spend
descriptors (slice 4).

---

## Task 5: Build `IntegrationTopology` + `resolveIntegrationTopology`

**Depends on:** Tasks 3, 4
**Files:**
- Create: `packages/ee/src/sync/topology.ts`
- Create: `packages/ee/src/sync/topology.test.ts`
- Modify: `packages/ee/package.json` — add the `./sync` export subpath
- Copy from (precedent):
  `apps/erp/app/modules/settings/settings.server.ts:154-256`
  (`getCompanyIntegrations` — the Redis-cached, secret-stripped read this must ride)

**Steps:**
1. Define `LedgerOwner`, `IdentityScope`, `IntegrationTopology` exactly as the spec's
   §1c gives them.
2. `resolveIntegrationTopology(client, companyId)` reads the company's integration rows
   **once**, picks the single active row per role (the Task 1 trigger guarantees at most
   one), and resolves:
   - `accounting` / `spend` — id plus `resolveCapabilities`.
   - `ledgerOwnership` — `{ kind: "carbon" }` for every `PostingSourceFamily` unless the
     spend integration's capabilities list that family in `ownsLedgerFamilies`. **In
     this slice nothing declares it, so every family resolves to `carbon` and behaviour
     is unchanged.** Say so in a comment.
   - `identityScope(targetIntegrationId)` — `{ kind: "delegated", toIntegrationId }`
     when the target is the spend integration AND its capabilities say
     `ownsRemoteCodingSurface === false` AND an accounting integration exists;
     `{ kind: "carbon" }` otherwise. Same note: nothing sets it in this slice.
   - `PostingSourceFamily` is already exported from
     `packages/ee/src/accounting/core/models.ts` — import it, do not redefine it.
3. Tests: no integrations → both null, all families carbon; accounting only → carbon;
   accounting + spend with `ownsRemoteCodingSurface: true` → carbon identity scope;
   a fixture spend capability with `ownsLedgerFamilies: ["ap"]` → ap external, ar carbon
   (this proves the mechanism ahead of slice 4 using it); the same fixture with
   `["ar"]` → invoice side external, proving the rule is not AP-shaped.
4. It must issue **no database query beyond the one integrations read**. Do not add a
   second lookup for capabilities — those come from the TS registry.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- topology
# Expected: all cases pass, including both fixture ownsLedgerFamilies cases
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** calling it from anywhere.

---

## Task 6: Thread the topology through the settings resolvers

**Depends on:** Task 5
**Files:**
- Modify: `packages/ee/src/accounting/core/service.ts` — `resolveSyncConfig`
- Modify: `packages/ee/src/accounting/core/models.ts` — `resolvePostingSyncSettings`
- Modify: every call site the compiler flags (expect ~13, across
  `packages/jobs/src/inngest/functions/integrations/*` and
  `apps/erp/app/routes/x+/settings+/integrations.$id.tsx`)
- Copy from (precedent): the exhaustive `Record<>` on `POSTING_POLICY`
  (`core/models.ts:317`) — the same "omission is a compile error" idiom

**Steps:**
1. Add a **required** second parameter `topology: IntegrationTopology` to both
   functions. Required, not optional — an optional parameter defeats the entire point,
   which is that the compiler finds every call site.
2. Apply the derivation inside them, using `POSTING_POLICY` to find what to suppress —
   never a hard-coded `"bill"`:
   - for each family whose `ledgerOwnership` is external, set
     `families[family] = "none"`;
   - collect the distinct `backingEntityType` of every `POSTING_POLICY` entry whose
     `family` matches, **skipping `null`, skipping entries whose family is
     `"per-line"`, and skipping the `"per-party"` sentinel**, and set
     `entities[thatEntity].enabled = false`;
   - clear the matching flag in `PostingSyncDocumentSyncFlags` for each entity disabled
     (`billEnabled`, `reimbursementEnabled`, `invoiceEnabled`, `creditMemoEnabled`,
     `vendorCreditEnabled`).
   Both sentinel skips are load-bearing. A `per-line` family (`Payment`) is shared
   between AR and AP and resolved per journal from its control-account lines; a
   `per-party` family (`Credit Memo` / `Debit Memo`) is resolved per record from the
   memo's party (`posting.ts:333-356`). Disabling either wholesale would break the side
   that is still Carbon-owned.

   **`ledgerOwnership` is keyed on the `postingSync.families` keys** — now FOUR:
   `ar`, `ap`, `creditMemo`, `vendorCredit` — **not on `PostingSourceFamily`**, whose
   `per-line` / `per-party` members are resolution strategies rather than ownable
   families. This changed on the branch; read `core/models.ts` for the current shape
   rather than trusting this plan's memory of it.

   Note `POSTING_POLICY.Reimbursement` is `{ family: "ap", backingEntityType:
   "reimbursement" }`, so an AP-delegated company correctly disables **both** `bill` and
   `reimbursement` with no special case. If your implementation needs one, it is wrong.
3. Fix every compile error by threading a topology through. Where a call site already
   has a `companyId` and a client, call `resolveIntegrationTopology`; where it processes
   a batch of companies, resolve once per company outside the loop, not per row.
4. Note `isPaymentSyncbackEnabled` (`core/posting.ts:77`) calls
   `resolvePostingSyncSettings` with one argument — it is one of the call sites and it
   is **per family**, so an AP-external company keeps AR syncback working. Do not
   "simplify" it to a single boolean.
5. Behaviour must be identical after this task. Add a test asserting that with a
   carbon-owned topology, `resolveSyncConfig` and `resolvePostingSyncSettings` return
   byte-identical results to the pre-change implementation for a representative stored
   metadata fixture.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp
# Expected: exit 0 — and it MUST have failed before every call site was updated.
pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test
# Expected: all pass with no assertion changes
```

**Out of scope:** changing what any resolver returns for a carbon-owned company.

---

## Task 7: Replace the hard-coded provider-id lists

> **2026-09-24 — PARTIAL. Two converted, one structurally blocked.**
>
> Done: `ramp-sweep` now sweeps every SPEND-role integration instead of
> `.eq("id","ramp")`, and the accounting layout reads
> `getIntegrationIdsByRole("accounting")`.
>
> **`ACCOUNTING_SYNC_INTEGRATION_IDS` cannot be converted as this task assumed.**
> `accounting.service.ts` is a `*.service.ts`, re-exported through the module
> barrel that client components import, so it is BROWSER-BUNDLED — and the
> `@carbon/ee` barrel reaches `@carbon/auth`, which validates the full server env
> at import time. Importing the registry there fails the build with "server-only
> module referenced by client". (The file separately already avoids
> `@carbon/ee/accounting` for a TS2589 reason it documents.)
>
> The fix is for the caller to pass the ids in — the convention this module
> already uses for `syncFromDate` — but `getPeriodExternalGlSyncReadiness`'s only
> caller is `getPeriodReadiness` in the same file, so the signature change
> cascades. Fold it into Task 6, which is already threading a resolved object
> through this layer.
>
> The `isAccountingInstalled` / `producesSyncOperations` half of this task still
> needs Task 5's topology and is untouched.


**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts:2936-2970` — delete
  `ACCOUNTING_SYNC_INTEGRATION_IDS`
- Modify: `apps/erp/app/routes/x+/accounting+/_layout.tsx:45-52` — delete the inline
  `["xero","quickbooks","rillet"]`
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx:647-656` — replace
  `category === "Accounting"` and the `|| integration.id === "ramp"`
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sweep.ts:20-25` —
  replace `.eq("id", "ramp")`

**Steps:**
1. Everywhere a query filters `companyIntegration` by a list of accounting ids, build
   the list from `getIntegrationsByRole("accounting").map(i => i.id)`.
2. `isAccountingInstalled` becomes `topology.accounting !== null`;
   `producesSyncOperations` becomes `topology.accounting !== null || topology.spend !== null`
   — which is the spec's "`providerRole != null`" rule and removes the `"ramp"` literal.
3. `ramp-sweep` filters `.in("id", getIntegrationsByRole("spend").map(i => i.id))`.
   Keep the function id and cron unchanged.
4. Leave `Object.values(ProviderID)` in the three accounting sweeps alone for now —
   `ProviderID` is a legitimate typed registry, not a hard-coded literal, and those
   sweeps construct provider instances keyed on it. Note this in the PR.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
# Expected: exit 0
grep -rn '"xero", *"quickbooks"\|\[.*"quickbooks".*"rillet"' apps/erp/app packages/jobs/src
# Expected: no matches
grep -rn 'eq("id", *"ramp")' packages/jobs/src
# Expected: no matches
```

**Out of scope:** `SECRET_KEYS`, `integrationErrors`, the server-hooks registry, and
`charge.integration` defaults — all legitimately id-keyed.

---

## Task 8: Block conflicting installs in the UI and the OAuth callbacks

**Depends on:** Tasks 1, 3
**Files:**
- Modify: `apps/erp/app/modules/settings/ui/Integrations/IntegrationCard.tsx` — disable
  Install on a role conflict
- Modify: `apps/erp/app/routes/x+/settings+/integrations.tsx` — the loader supplies the
  active role map
- Modify: `apps/erp/app/modules/settings/integration-errors.ts` — add a
  `role-conflict` code for `xero`, `quickbooks`, `rillet`, `ramp`
- Modify: `apps/erp/app/routes/api+/integrations.{xero,quickbooks,ramp}.oauth.ts` —
  catch the trigger's `23505` and redirect with `role-conflict`
- Copy from (precedent): `IntegrationCard.tsx:125-135` (the `isStarterPlan` branch —
  an already-present "disabled with explanatory copy" treatment) and
  `integration-errors.ts` (the existing per-integration code map)

**Steps:**
1. The integrations loader already calls `getIntegrationsWithHealth`; derive
   `activeRoles: Record<"accounting"|"spend", string | null>` from it and return it.
2. In `IntegrationCard`, when `integration.providerRole` is set and
   `activeRoles[role]` is a different id, disable Install and render copy naming the
   incumbent: "Uninstall {incumbent} first — only one {role} integration can be active
   at a time." Match the `isStarterPlan` visual treatment.
3. In each OAuth callback, wrap the activating write and map a `23505` to
   `connectionFailed("role-conflict", …)` so the user gets the existing redirect-with-
   error UX rather than a 500.
4. Run `/translate` — all new strings are user-facing.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exit 0
pnpm run lint
# Expected: exit 0
```
Browser-verify via `/test`: with Rillet active, the QuickBooks and Xero cards show
Install disabled with copy naming Rillet; the Ramp card is unaffected.

**Out of scope:** the mode picker (slice 4).

---

## Task 9: Add the `no-integration-id-branching` conformance check

**Depends on:** Task 7
**Files:**
- Create: `packages/checks/src/conformance/no-integration-id-branching.ts`
- Create: `packages/checks/src/conformance/no-integration-id-branching.test.ts`
- Modify: `packages/checks/src/conformance/baseline.json`
- Copy from (precedent): `packages/checks/src/conformance/no-raw-rounding.ts` — the
  `ConformanceCheck` shape with `id`, `description`, `provenance`, `scan(file, contents)`

**Steps:**
1. Flag a string literal equal to a registered integration id
   (`"xero" | "quickbooks" | "rillet" | "ramp"`) used in an equality comparison
   (`=== "ramp"`, `!== "ramp"`) or inside an array/`Set` literal.
2. Exclude by path: `packages/ee/src/<id>/**` (a provider may name itself),
   `packages/ee/src/index.ts`, `packages/ee/src/hooks.server.ts`,
   `packages/ee/src/integrations/secrets.ts`,
   `apps/erp/app/modules/settings/integration-errors.ts`, and
   `packages/database/supabase/migrations/**`.
3. Baseline the remaining current hits rather than fixing them in this slice — the rule
   exists to stop NEW branching. Record the baseline count in the PR description.
4. Register the check wherever the other TypeScript-source checks are registered
   (see `packages/checks/src/sources/typescript.ts`).

**Verify:**
```bash
pnpm --filter @carbon/checks test -- no-integration-id-branching
# Expected: passes, including a fixture asserting `integrationId === "ramp"` in a jobs
# file is a violation and the same literal inside packages/ee/src/ramp/ is not
pnpm --filter @carbon/checks test
# Expected: all pass with the new baseline
```

**Out of scope:** clearing the baseline.

---

## Task 10: Full-suite verification

**Depends on:** Tasks 1–9
**Files:** none

**Steps:**
1. Run the gates below.
2. Confirm the no-behaviour-change property: with only an accounting integration
   installed, sync behaviour is identical to `main` — spot-check by posting a purchase
   invoice and confirming the Bill still pushes and the AP journal is still
   `DOC_BACKED`, not `FAMILY_OFF`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp --filter=@carbon/checks
# Expected: exit 0
pnpm run lint
# Expected: exit 0
pnpm run test
# Expected: all pass
pnpm db:check:datasets && pnpm db:check:backups
# Expected: both pass
```

**Out of scope:** install modes, scopes, identity resolution, GR/IR, item receipts —
slices 3–5.
