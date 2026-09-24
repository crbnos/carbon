# Branch state notes — two-way sync work landed while the push-only spec was being written

**Date:** 2026-09-24
**Branch:** `rillet-ramp-accounting-provider` (41 commits ahead of `origin/main`)
**Affects:** `.ai/specs/2026-09-23-spend-management-push-only-mode.md` and all five
`.ai/plans/2026-09-23-*` plans

While the push-only spec and plans were being written, substantial two-way sync work
landed on the same branch: credit memos, vendor credits, reimbursements-as-their-own-
document, and several Ramp fixes. Some of it **invalidates specific claims** in the spec
and plans. This file records what changed and what it changes, so the updates are
traceable rather than silent.

---

## 1. `PostingSourceFamily` gained a fourth value, and `families` gained two keys

`core/models.ts:327` is now `"ar" | "ap" | "per-line" | "per-party"`, and the stored
`postingSync.families` object is now four keys, not two:

```ts
families: { ar: "documents", ap: "documents", creditMemo: "none", vendorCredit: "none" }
```

Memo families default to `"none"` deliberately — a family that has never synced has no
correct backlog, so pushing history would double-count credits the accountant already
hand-booked in the provider.

**What it breaks in the spec:** §5 types ledger ownership as
`Record<PostingSourceFamily, LedgerOwner>`. That is now wrong. `per-line` and
`per-party` are **resolution strategies**, not families a company can own — the ownable
keys are the four settings keys. Ownership must be keyed on the `families` key union.

## 2. `backingEntityType` grew, including a `"per-party"` sentinel

Now `"invoice" | "bill" | "payment" | "creditMemo" | "vendorCredit" | "reimbursement"`
on the policy, plus the literal `"per-party"` on the two memo source types, meaning
"resolved per record from the memo's party" (`posting.ts:333-356`:
customer → `creditMemo`, supplier → `vendorCredit`, null party →
`MEMO_PARTY_UNRESOLVED`).

**What it breaks:** the spec's §5 traversal says "collect each distinct non-null
`backingEntityType`". It must additionally skip the `"per-party"` sentinel, exactly as
it already skips `per-line` families — otherwise it would try to disable an entity named
`"per-party"`.

## 3. `Reimbursement` is an AP document — and this VALIDATES the derivation

`POSTING_POLICY.Reimbursement` is `{ family: "ap", backingEntityType: "reimbursement" }`.

So delegating AP now disables **both `bill` and `reimbursement`**, and that falls out of
the `POSTING_POLICY`-derived rule **with no edit**. A document type that did not exist
when the rule was written is handled automatically. This is the strongest available
evidence that deriving the suppressed entity from the policy — rather than hard-coding
`"bill"` — was the right call, and it is worth citing in the spec rather than leaving
implicit.

## 4. `AccountingEntityType` gained three members

`creditMemo`, `vendorCredit`, `reimbursement` (`core/types.ts:241-261`), each with
`ENTITY_DEFINITIONS` entries, `DEFAULT_SYNC_CONFIG` defaults (all `enabled: false`,
opt-in), and provider syncers (`entities/credit-memo.ts`, `entities/reimbursement.ts`
under both `rillet/` and `xero/`).

**What it changes:** slice 3's plan adds `itemReceipt` to this union and says the
compile errors across `build*SyncConfig` are the intended totality property. Still true,
but the union is now larger and three more providers' entity lists must decide about
`itemReceipt`.

## 5. `PostingSyncDocumentSyncFlags` grew

Now carries `creditMemoEnabled`, `vendorCreditEnabled`, `reimbursementEnabled`
alongside `invoiceEnabled` / `billEnabled` / `chargeEnabled` / `chargeCreditEnabled`.

**What it changes:** the delegation derivation must set these consistently with the
entities it disables, or a delegated family produces a `DOC_SYNC_DISABLED` Warning
instead of a clean `FAMILY_OFF` — the exact pairing bug §5 exists to prevent.

## 6. Ramp scopes gained `repayments:read`

`a4db1e4c79`, with a hard-won comment: without it Ramp answers
`403 DEVELOPER_7100 "These scopes are not allowed for this token: repayments:read"`,
the repayments family logs "drain failed" and returns nothing — every run, silently.

**What it changes:** slice 4's provider-mode scope set must include it. The **push-only**
set must not — repayments are inbound and push-only does not pull them. This is also a
concrete reminder that the push-only set is not merely "the current list minus
`accounting:write`"; it is its own list, and a scope missing from it fails silently
rather than loudly.

## 7. Charges nav is now deliberately NOT integration-gated

`85735ce2c1` moved Charges under Accounts Payable and removed the
`integrations.has("ramp")` gate, with the reasoning recorded in the code:

> Charges are a first-class Carbon document with their own posting path, so the nav
> entry is NOT gated on a spend integration being connected — an empty list is
> discoverable, a missing nav entry is not.

**What it breaks:** slice 4's plan (Task 9, step 4) says to re-gate Charges on the
resolved spend config. **That directly contradicts a decision just made and documented
on this branch.** The step must be deleted, not adapted — the whole point of the change
is that the nav entry is unconditional.

## 8. New subscriptions: `memo` and `reimbursement`

`COMMON_PUSH_TABLES` now includes both, and the memo's entity type is resolved by party
(`5eb6e52370`).

**What it changes:** nothing breaks, but slice 3's subscription-invariant test (Task 9)
now covers more tables, and the "every subscribed table has a registered syncer"
assertion is more valuable than when it was written.

## 9. Reimbursements are their own document, not Employee-supplier bills

`b17f2373e6` documents the model change. The Ramp outbound bill push still excludes
Employee-supplier invoices (`ramp-sync-outbound.ts:414-461`), which remains correct —
those are now a separate document with its own push path.

**What it changes:** the spec's answer "push-only means Carbon never sees
reimbursements" still holds, but for a different reason than when it was agreed: it is
now an entity-level opt-out, not an absence of representation.

---

## Environment at the time of writing

- **Local database is not running** (`pg_isready` fails on `PORT_DB=49921`; only the
  `carbon-redis` container is up). Migrations and browser verification are therefore
  unavailable this session.
- Consequence: **slice 2 cannot be executed** (its first two tasks are a migration and
  `generate:types`), and any browser-verification step in any plan is blocked.
- **Slice 1 (master data) is executable** — it is code plus unit tests, with no
  migration and no UI.

## Actions taken from these notes

1. Spec updated for items 1, 2, 3, 5 and 7 (see its changelog).
2. Plans updated for items 4, 6, 7 and 8.
3. Slice 1 executed — Tasks 1, 2, 3, 4 and 6 landed as five commits. Tasks 5, 7
   and 8 hit stop conditions and are recorded as BLOCKED in the plan with the
   design decision each needs; Task 9's automated gates are green and its
   browser step is blocked on the database, not skipped.
