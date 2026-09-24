# Delegated coding + GR/IR verification (spec slice 5)

**Spec:** `.ai/specs/2026-09-23-spend-management-push-only-mode.md` §4, §6
**Research:** `.ai/research/spend-management-one-way-push.md`
**Depends on:** slices 2, 3, 4

> **GATED.** Task 1 is a live sandbox verification, not code. **Tasks 2–9 must not be
> started until Task 1 reports**, because two of its five questions decide whether the
> coding half of this slice can exist at all. If Task 1 answers "Ramp silently drops an
> unrecognised option" or "a non-provider app cannot read `/accounting/field-options`",
> STOP and re-plan — do not build a best-effort version.

## What this slice adds

Everything slice 4 deliberately left out: bills coded with the accounting provider's
identifiers, vendors linked through `accounting_vendor_remote_id`, `remote_id` dropped
in favour of Ramp's own dedupe, and GR/IR verified against `BILL_SYNCED`.

## Progress
- [ ] Task 1: **GATE** — run the five sandbox verifications
- [ ] Task 2: Build the external-identity resolver
- [ ] Task 3: Declare `externalAddressing` per accounting provider
- [ ] Task 4: Read and persist the active provider's coding surface
- [ ] Task 5: Code draft-bill lines with delegated identifiers
- [ ] Task 6: Link the spend vendor to the accounting vendor
- [ ] Task 7: Drop `remote_id`; dedupe on vendor + invoice number
- [ ] Task 8: Verify GR/IR against `BILL_SYNCED`
- [ ] Task 9: Verification

## Dependencies
- Everything needs Task 1.
- Task 5 needs Tasks 2, 3, 4. Task 6 needs Task 2.
- **Tasks 5, 6, 7 and 8 are independent of each other** once their prerequisites land.

---

## Task 1: GATE — run the five sandbox verifications

**Depends on:** none
**Files:**
- Create: `.ai/runs/{today}-ramp-delegated-coding-gates.md`

**Setup prerequisite:** a Ramp demo business where a **non-Carbon** provider holds the
active accounting connection. If Rillet's sandbox cannot be connected to Ramp demo, a
manual CSV connection is an acceptable stand-in for gates 1–3 but **not** for gate 4,
which needs a real accounting vendor created by another app. **If neither can be
arranged, STOP and report** — the whole slice is unverifiable and needs a different
strategy (ship behind a flag with instrumentation, or accept uncoded permanently).

**Steps:** answer each, recording the exact request, response status and body.

1. **Does Ramp validate `field_external_id` / `field_option_external_id` on a bill
   draft against the ACTIVE connection's options?** Send a draft bill with a valid
   option id, then one with a fabricated id. Record whether the second is rejected,
   silently dropped, or accepted. *A silent drop produces uncoded bills in the GL with
   no error anywhere — if that is the behaviour, Task 5 must validate every option
   against the live read before sending, and never send an unknown one.*
2. **Can a non-provider app read the active provider's coding surface?**
   `GET /accounting/fields`, `/accounting/field-options`, `/accounting/accounts` with
   only `accounting:read`. Record the status and whether the returned `external_id`s
   are ERP-sourced. *Task 4 collapses without this.*
3. **Is `sync_status` / `BILL_SYNCED` readable with `bills:read` by a non-provider
   app?** *Task 8's trigger depends on it.*
4. **Can a caller with only `vendors:write` set `accounting_vendor_remote_id` on a
   spend vendor, pointing at an accounting vendor another app created?** And what
   happens when that accounting vendor is **already linked** to a different Ramp vendor
   — Ramp documents the constraint "must not already be linked to another Ramp vendor"
   but not the failure mode. *Task 6 needs both answers.*
5. **Does omitting `remote_id` on a draft bill change anything downstream?** Carbon's
   current behaviour is live-verified only for the Carbon-as-provider case. *Task 7.*

**Verify:**
```bash
cat .ai/runs/*-ramp-delegated-coding-gates.md
# Expected: all five questions answered with request/response evidence, each marked
# CONFIRMED or BLOCKED. No inference, no "probably".
```

**Out of scope:** writing any application code.

---

## Task 2: Build the external-identity resolver

**Depends on:** Task 1 (gate 2 CONFIRMED)
**Files:**
- Create: `packages/ee/src/sync/identity.ts`
- Create: `packages/ee/src/sync/identity.test.ts`
- Copy from (precedent): `packages/ee/src/accounting/core/account-mapping.ts:291-319`
  (`loadAccountCodesById` — the existing "mapping row → the identifier this provider
  addresses by" loader this generalizes)

**Steps:**
1. Implement the interface from spec §4:
   ```ts
   export interface ExternalIdentityResolver {
     resolve(kind: ExternalIdentityKind, carbonId: string): Promise<string | null>;
     resolveMany(kind: ExternalIdentityKind, carbonIds: string[]): Promise<Map<string, string>>;
   }
   ```
2. `CarbonIdentityResolver` returns the Carbon id unchanged.
3. `DelegatedIdentityResolver(delegateIntegrationId)` reads
   `externalIntegrationMapping` under the delegate's `integration`, returning
   `metadata.externalCode` or the `externalId` column according to that provider's
   declared `externalAddressing` for the kind (Task 3).
4. Selection is `topology.identityScope(targetIntegrationId)` — **coding authority, not
   ledger ownership**. They coincide for Ramp but answer different questions, and a
   partner role that pushes coding while the GL posts AP externally breaks under the
   conflated rule. Add a test pinning that a fixture with
   `ownsLedgerFamilies: ["ap"]` **and** `ownsRemoteCodingSurface: true` resolves to
   `CarbonIdentityResolver`.
5. Collapse the three sibling loaders — `loadAccountCodesById`,
   `loadRilletAccountCodesById`, `loadQboAccountRefsById` — onto `resolveMany`. They
   differ only in which field of the same row they read.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- identity
# Expected: all pass, including the independence test in step 4
pnpm --filter @carbon/ee test -- rillet quickbooks xero
# Expected: unchanged — the collapsed loaders return identical maps
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** using it in the Ramp push.

---

## Task 3: Declare `externalAddressing` per accounting provider

**Depends on:** Task 1
**Files:**
- Modify: `packages/ee/src/accounting/providers/rillet/provider.ts` — `{ account: "code", vendor: "id" }`
- Modify: `packages/ee/src/accounting/providers/xero/provider.ts` — `{ account: "code", vendor: "id" }`
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/provider.ts` — `{ account: "id", vendor: "id" }`

**Steps:**
1. Add the declarations. These are read only by the resolver; they change nothing else.
2. Xero declares no `capabilities` object today — slice 2 Task 4 added one while
   keeping every currently-absent field absent. Add `externalAddressing` to it without
   adding any other field.
3. The documented default in `resolveCapabilities` stays `{ account: "code" }`, which
   is correct for a provider that declares nothing.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- capabilities
# Expected: a test asserting each provider's declared addressing matches the field its
# existing bill mapper actually sends (rillet account_code, xero AccountCode,
# qbo AccountRef.value)
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** behaviour change.

---

## Task 4: Read and persist the active provider's coding surface

**Depends on:** Task 1 (gate 2 CONFIRMED)
**Files:**
- Create: `packages/ee/src/ramp/lib/coding-surface.ts`
- Modify: `packages/ee/src/ramp/lib/client.ts` — add the three `accounting:read` GETs if
  absent
- Copy from (precedent): `packages/ee/src/ramp/lib/cost-centers.ts` (the existing
  `GET /accounting/fields` + `field-options` diff-and-persist shape)

**Steps:**
1. `loadDelegatedCodingSurface(ctx)` drains `GET /accounting/fields`,
   `/accounting/field-options` and `/accounting/accounts`, returning the active
   provider's options with their `external_id` and `provider_name`.
2. Persist as `externalIntegrationMapping` rows with
   `entityType: "accountingFieldOption"` under the **spend** integration, recording the
   Carbon account/cost-center/project id against the option external id.
3. **Re-read on every sync run**, not only at install. Customers keep editing the chart
   of accounts, and Codat is the only unified-API vendor that names this and says to
   re-validate continuously. Surface a drift state rather than pushing a stale option.
4. Resolution is two hops and both are needed: **translate** (Carbon id → the
   delegate's identifier, from the accounting provider's mapping rows — Task 2) then
   **validate** (that identifier exists as an option here — this task). A miss on hop 1
   is an unmapped account; a miss on hop 2 is drift. Both degrade the line to uncoded,
   with different reason codes, because the fixes differ.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- coding-surface
# Expected: tests for a clean read, a deleted option producing drift, and a re-run
# updating a changed external_id without duplicating mapping rows
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** applying it to a bill.

---

## Task 5: Code draft-bill lines with delegated identifiers

**Depends on:** Tasks 2, 3, 4
**Files:**
- Modify: `packages/ee/src/ramp/lib/coding.ts` — `buildLineCodingSelections` takes
  resolved option ids instead of pushed-id sets
- Modify: `packages/ee/src/ramp/entities/bill.ts`

**Steps:**
1. Change the signature from `(line, pushed: {pushedAccountIds, …})` to
   `(line, resolved: {accountOptionId, costCenterOptionId, projectOptionId})`. In
   provider mode the resolver returns the Carbon ids, so **the emitted payload is
   byte-identical to today** — pin that with a test.
2. Emit a selection only when the id passed both hops. An unresolved account degrades
   the line to uncoded with `CODING_OPTION_MISSING` (drift) or
   `ACCOUNT_NOT_MAPPED` (no translation), recorded on the Sync Activity ledger and
   cleared on resolution.
3. **Never park a bill on an account.** An uncoded bill still carries vendor, amount
   and invoice number and a human reviews it in Ramp. The Warning copy must say the
   degrade is **permanent for that bill**: coding is a creation-time affordance —
   `POST /accounting/codings` requires `accounting:write` and its `object_type` enum
   contains only `TRANSACTION`, so it cannot code a bill at all.
4. If gate 1 reported a silent drop, additionally refuse to send any option id absent
   from the live read.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- coding
# Expected: the existing round-trip test still passes in provider mode byte-for-byte;
# new tests cover delegated ids, drift degrade, and unmapped degrade
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** vendors.

---

## Task 6: Link the spend vendor to the accounting vendor

**Depends on:** Tasks 1 (gate 4), 2
**Files:**
- Modify: `packages/ee/src/ramp/lib/spend.ts` — add `linkAccountingVendor`; leave
  `resolveOrCreateRampSpendVendor`'s `external_vendor_id` behaviour **unchanged**
- Modify: `packages/ee/src/ramp/entities/bill.ts` and `purchase-order.ts`

**Steps:**
1. **`external_vendor_id` stays as Carbon's own handle.** Ramp documents it as
   "independent of accounting system remote IDs", and Carbon uses it correctly today as
   its spend-vendor match key. Do not repurpose it.
2. Add `linkAccountingVendor(client, rampVendorId, accountingVendorRemoteId)` calling
   `PATCH /vendors/{id}` with `accounting_vendor_remote_id`. That is the field that
   lands a bill on the right GL vendor.
3. The accounting vendor's remote id comes from the resolver
   (`resolve("vendor", supplierId)`). When it is absent, **defer** per slice 4 Task 8 —
   bills wait, POs push unlinked.
4. Handle the documented uniqueness constraint per gate 4's answer: if the accounting
   vendor is already linked to a different Ramp vendor, **adopt that link** rather than
   failing, and write the mapping to it.
5. Ramp's guide calls confusing Merchant / Vendor / Accounting Vendor "the most common
   integration error" — put a comment naming all three and their id spaces at the top
   of the new function.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- spend
# Expected: tests for link-on-first-push, adopt-existing-link, and defer-when-unmapped
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** `remote_id`.

---

## Task 7: Drop `remote_id`; dedupe on vendor + invoice number

**Depends on:** Task 1 (gate 5)
**Files:**
- Modify: `packages/ee/src/ramp/entities/bill.ts` — omit `remote_id` in push-only
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-bill.ts` — the
  inbound dedupe

**Steps:**
1. In push-only mode, omit `remote_id` — Ramp documents it as the id identifying the
   bill on the **accounting-connection owner's** side, which is no longer Carbon. Keep
   sending it in provider mode.
2. Do **not** send `enable_accounting_sync: false`; its default of `true` is what makes
   the draft flow onward, and Ramp 422s the combination with `remote_id`.
3. Replace the dedupe with Ramp's own documented key — **vendor + `invoice_number`** —
   plus the Carbon-side mapping row on the returned Ramp bill id. Ramp widened
   `invoice_number` to 84 characters specifically to accommodate accounting-provider
   numbers, which is why following their key is the least surprising choice.
4. The inbound `ramp-bills` step currently dedupes on `remote_id`; it must fall back to
   the mapping row and the vendor + invoice-number match in push-only mode.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- bill
pnpm --filter @carbon/jobs test -- ramp-sync-bill
# Expected: provider mode still sends remote_id and dedupes on it; push-only sends
# none and dedupes on vendor + invoice_number
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** GR/IR.

---

## Task 8: Verify GR/IR against `BILL_SYNCED`

**Depends on:** Task 1 (gate 3)
**Files:**
- Create: `packages/jobs/src/inngest/functions/integrations/ramp-sync-bill-settled.ts`
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts` — add the step
- Modify: `packages/ee/src/ramp/lib/models.ts` — add
  `cursors.billSyncStatusCheckedAt`

**Steps:**
1. **Carbon keeps posting the purchase invoice locally, unchanged.** That is
   load-bearing twice: it clears Carbon's own GR/IR, and it is where the outbound bill
   coding comes from (`loadBillCostingLines` replays the posted journal, because
   `purchaseInvoiceLine.accountId` is null for item lines). Do not suppress it.
2. Poll `GET /bills?sync_status=BILL_SYNCED` on the cursor, and for each bill mapped to
   a Carbon invoice, compare the coding that came back against what Carbon pushed.
3. On divergence, raise `BILL_RECODED_EXTERNALLY` naming the line and both accounts.
   This is the real exposure: the GL's GR/IR clears only because Carbon coded the bill
   to the GR-IR account, and a reviewer in Ramp can move it.
4. This is **detection, not correction** — Carbon cannot recode a Ramp bill (see Task 5
   step 3).

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- bill-settled
# Expected: a matching coding raises nothing; a moved line raises
# BILL_RECODED_EXTERNALLY; an unmapped bill is ignored
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** any automated correction.

---

## Task 9: Verification

**Depends on:** Tasks 1–8
**Files:** none

**Steps:**
1. Run the gates below.
2. Against the sandbox from Task 1: post a purchase invoice for a supplier mapped in
   the accounting provider, confirm the draft bill's lines carry the **provider's**
   option ids (not Carbon `account.id`), the vendor resolves through
   `accounting_vendor_remote_id`, and no `remote_id` is sent.
3. Delete the coded account in the accounting provider, re-push, and confirm the line
   is uncoded with `CODING_OPTION_MISSING` — and that the bill still reaches Ramp.
4. Approve and sync the bill in Ramp, confirm `BILL_SYNCED` is observed and no recode
   Warning is raised; then move a line in Ramp and confirm the Warning appears.
5. Confirm provider mode is byte-identical to before this slice.
6. Write results to `.ai/runs/{today}-ramp-delegated-coding-verification.md`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp
pnpm run lint && pnpm run test
# Expected: all pass
```

**Out of scope:** nothing — this is the last slice.
